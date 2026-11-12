import type { HerdrMod, ModCommand, ModHostApi } from '../modApi.ts';
import { HerdrPane } from '../herdr/herdrPane.ts';
import { PaneLifecycle } from '../herdr/paneLifecycle.ts';
import { ClaudeModRuntime } from '../claude/claudeModRuntime.ts';
import { ModFolder } from '../mods/modFolder.ts';
import { MessageWatcher } from '../state/messageWatcher.ts';
import { StateStore } from '../state/stateStore.ts';
import type { HostContext, ModEntry } from './hostContext.ts';

type LoadedMod = { readonly mod: HerdrMod; readonly options: Readonly<Record<string, unknown>> };

/** The herdr-mods plugin inside opencode: loads the configured mods and runs their panes in herdr. */
export class OpencodeHost {
  private static readonly NOT_OPENED = `the herdr pane did not open; install the plugin: herdr plugin install barnuri/herdr-mods`;
  /** How often the panel checks whether the screen width now calls for another side. */
  private static readonly RELAYOUT_MS = 2000;

  private readonly store = new StateStore();
  private readonly lifecycle: PaneLifecycle | null;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly context: HostContext) {
    const besidePaneId = HerdrPane.currentPaneId();
    this.lifecycle = besidePaneId ? new PaneLifecycle(besidePaneId) : null;
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      const timer = setInterval(() => void lifecycle.relayout(), OpencodeHost.RELAYOUT_MS);
      this.cleanups.push(() => clearInterval(timer));
    }
  }

  /** Loads the configured mods, every herdr mod in the mods folder, and every Claude Code mod there. */
  async register(entries: readonly ModEntry[]): Promise<() => void> {
    const found = await new ModFolder().list();
    const folderMods = found.filter((mod) => mod.kind === 'herdr').map((mod) => mod.path);
    const configured = new Set(entries.map((entry) => (typeof entry === 'string' ? entry : entry.path)));
    const all = [...entries, ...folderMods.filter((path) => !configured.has(path))];
    const herdrMods = await Promise.all(all.map((entry) => this.load(entry)));
    const claudeMods = await Promise.all(found.filter((mod) => mod.kind === 'claude').map((mod) => this.loadClaudeMod(mod.path)));
    const mods = [...herdrMods, ...claudeMods].filter((item): item is LoadedMod => item !== null);
    for (const { mod, options } of mods) {
      try {
        const cleanup = await mod.setup?.(this.api(mod, options));
        if (cleanup) {
          this.cleanups.push(cleanup);
        }
      } catch (error) {
        void this.store.logError(mod.id, `setup failed: ${OpencodeHost.describe(error)}`);
      }
    }
    const release = this.context.ui.slot({ append: 'app', render: () => this.registerCommands(mods) });
    return () => {
      release();
      for (const cleanup of this.cleanups) {
        cleanup();
      }
      void this.lifecycle?.closeAll();
    };
  }

  private async loadClaudeMod(root: string): Promise<LoadedMod | null> {
    try {
      const mod = await ClaudeModRuntime.definition(root);
      return { mod, options: this.optionsFor(mod.id) };
    } catch (error) {
      await this.store.logError(root, `Claude mod load failed: ${OpencodeHost.describe(error)}`);
      return null;
    }
  }

  /** Per-mod options from the host config: `modOptions: { "<mod id>": { ... } }`. */
  private optionsFor(modId: string): Readonly<Record<string, unknown>> {
    const all = (this.context.options?.['modOptions'] ?? {}) as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    return all[modId] ?? {};
  }

  private async load(entry: ModEntry): Promise<LoadedMod | null> {
    const path = typeof entry === 'string' ? entry : entry.path;
    try {
      const mod = (await import(path)).default as HerdrMod;
      const options = typeof entry === 'string' ? this.optionsFor(mod.id) : (entry.options ?? this.optionsFor(mod.id));
      return { mod, options };
    } catch (error) {
      await this.store.logError(path, `load failed: ${OpencodeHost.describe(error)}`);
      return null;
    }
  }

  // A keymap layer lives as long as the reactive owner that created it, so it is created inside a slot render.
  private registerCommands(mods: readonly LoadedMod[]): null {
    const commands = mods.flatMap(({ mod, options }) =>
      [...(mod.command ? [mod.command] : []), ...(mod.commands?.() ?? [])].map((command) => ({
        id: `herdr-mods.${mod.id}.${command.name}`,
        title: command.name,
        group: 'Session',
        description: command.description,
        palette: true as const,
        slash: { name: command.name, arguments: true as const },
        run: (input?: string) => void this.runCommand(command, mod, options, input ?? ''),
      })),
    );
    this.context.keymap.layer(() => ({ mode: 'global', commands }));
    return null;
  }

  private async runCommand(command: ModCommand, mod: HerdrMod, options: Readonly<Record<string, unknown>>, input: string): Promise<void> {
    try {
      const message = await command.run(input.trim(), this.api(mod, options));
      if (message) {
        this.toast(message);
      }
    } catch (error) {
      await this.store.logError(mod.id, `command failed: ${OpencodeHost.describe(error)}`);
    }
  }

  private api(mod: HerdrMod, options: Readonly<Record<string, unknown>>): ModHostApi {
    return {
      options,
      opencode: this.context,
      directory: () => this.directory(),
      currentSessionId: () => {
        const route = this.context.ui.router.current();
        return route.type === 'session' ? route.sessionID : undefined;
      },
      publish: (key, state) =>
        this.store.write(mod.id, key, state).catch((error: unknown) => this.store.logError(mod.id, `publish failed: ${OpencodeHost.describe(error)}`)),
      openPane: (key, openOptions) =>
        this.openPane(mod, options, key, openOptions?.isForced === true).catch(async (error: unknown) => {
          await this.store.logError(mod.id, `open pane failed: ${OpencodeHost.describe(error)}`);
          return false;
        }),
      toast: (message) => this.toast(message),
      logError: (message) => this.store.logError(mod.id, message),
      isPaneOpen: (key) => this.lifecycle?.isOpen(`${mod.id}:${key}`) ?? Promise.resolve(false),
      onMessage: (key, handler) => {
        const stop = MessageWatcher.watch(this.store, this.store.inputPathFor(mod.id, key), handler);
        this.cleanups.push(stop);
        return stop;
      },
    };
  }

  private async openPane(mod: HerdrMod, options: Readonly<Record<string, unknown>>, key: string, isForced: boolean): Promise<boolean> {
    if (!this.lifecycle) {
      if (isForced) {
        this.toast(`${mod.id} runs in a herdr pane: start opencode inside herdr.`);
      }
      return false;
    }
    const tab = { modId: mod.id, key, view: mod.pane.module, options };
    const isOpen = await this.lifecycle.open(tab, { isForced, parentPid: process.pid });
    if (!isOpen && isForced) {
      this.toast(`${mod.id}: ${OpencodeHost.NOT_OPENED}`);
    }
    return isOpen;
  }

  private toast(message: string): void {
    this.context.ui.toast.show({ title: 'herdr-mods', message, variant: 'info' });
  }

  private directory(): string {
    return this.context.data.location.default()?.directory ?? process.cwd();
  }

  private static describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
