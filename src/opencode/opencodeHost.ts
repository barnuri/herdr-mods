import type { HerdrMod, ModHostApi } from '../modApi.ts';
import { HerdrPane } from '../herdr/herdrPane.ts';
import { PaneLifecycle } from '../herdr/paneLifecycle.ts';
import { StateStore } from '../state/stateStore.ts';
import type { HostContext, ModEntry } from './hostContext.ts';

type LoadedMod = { readonly mod: HerdrMod; readonly options: Readonly<Record<string, unknown>> };

/** The herdr-mods plugin inside opencode: loads the configured mods and runs their panes in herdr. */
export class OpencodeHost {
  private static readonly NOT_OPENED = `the herdr pane did not open; install the plugin: herdr plugin install barnuri/herdr-mods`;

  private readonly store = new StateStore();
  private readonly lifecycle: PaneLifecycle | null;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly context: HostContext) {
    const besidePaneId = HerdrPane.currentPaneId();
    this.lifecycle = besidePaneId ? new PaneLifecycle(besidePaneId) : null;
  }

  async register(entries: readonly ModEntry[]): Promise<() => void> {
    const loaded = await Promise.all(entries.map((entry) => this.load(entry)));
    const mods = loaded.filter((item): item is LoadedMod => item !== null);
    for (const { mod, options } of mods) {
      try {
        const cleanup = mod.setup?.(this.api(mod, options));
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

  private async load(entry: ModEntry): Promise<LoadedMod | null> {
    const path = typeof entry === 'string' ? entry : entry.path;
    const options = typeof entry === 'string' ? {} : (entry.options ?? {});
    try {
      const mod = (await import(path)).default as HerdrMod;
      return { mod, options };
    } catch (error) {
      await this.store.logError(path, `load failed: ${OpencodeHost.describe(error)}`);
      return null;
    }
  }

  // A keymap layer lives as long as the reactive owner that created it, so it is created inside a slot render.
  private registerCommands(mods: readonly LoadedMod[]): null {
    const commands = mods.flatMap(({ mod, options }) => {
      const command = mod.command;
      if (!command) {
        return [];
      }
      return [
        {
          id: `herdr-mods.${mod.id}`,
          title: command.name,
          group: 'Session',
          description: command.description,
          palette: true as const,
          slash: { name: command.name, arguments: true as const },
          run: (input?: string) => void this.runCommand(mod, options, input ?? ''),
        },
      ];
    });
    this.context.keymap.layer(() => ({ mode: 'global', commands }));
    return null;
  }

  private async runCommand(mod: HerdrMod, options: Readonly<Record<string, unknown>>, input: string): Promise<void> {
    try {
      const message = await mod.command?.run(input.trim(), this.api(mod, options));
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
    };
  }

  private async openPane(mod: HerdrMod, options: Readonly<Record<string, unknown>>, key: string, isForced: boolean): Promise<boolean> {
    if (!this.lifecycle) {
      if (isForced) {
        this.toast(`${mod.id} runs in a herdr pane: start opencode inside herdr.`);
      }
      return false;
    }
    const env = {
      HERDR_MODS_MOD_ID: mod.id,
      HERDR_MODS_VIEW: mod.pane.module,
      HERDR_MODS_KEY: key,
      HERDR_MODS_OPTIONS: JSON.stringify(options),
      HERDR_MODS_PARENT_PID: String(process.pid),
    };
    const isOpen = await this.lifecycle.open(`${mod.id}:${key}`, env, isForced);
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
