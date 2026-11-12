import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HerdrMod, ModCommand, ModHostApi } from '../modApi.ts';
import { OpencodeTurnReader } from '../opencode/opencodeTurnReader.ts';
import { TermRenderer } from '../render/termRenderer.ts';
import { ATOM_STORE } from './claudeCode.ts';
import type { AtomStore, AtomToken } from './claudeCode.ts';
import { ClaudeModLoader } from './claudeModLoader.ts';
import type { LoadedClaudeMod } from './claudeModLoader.ts';
import { FrameCodec } from './frameCodec.ts';

type Handler = ($: unknown, event: Record<string, unknown>, next: (event: Record<string, unknown>) => Promise<unknown>) => unknown;
type Registration = { readonly name: string; readonly filter: Readonly<Record<string, unknown>>; readonly handler: Handler };
type PaneView = { title: string; columns: number; rows: number; actions: ReadonlyMap<number, () => unknown>; isOpen: boolean };
type SessionEvent = { readonly data: { readonly sessionID: string } };
type OpencodeData = {
  readonly on: (type: string, handler: (event: SessionEvent) => void) => () => void;
  readonly session: { readonly message: { list(sessionID: string): readonly unknown[]; sync(sessionID: string): Promise<void> } };
};

/**
 * Runs an unchanged Claude Code mod inside opencode: the `$` engine its hooks call, its `on(...)` handler
 * chains, its atoms, and its panes, which render here and show in herdr panes (`claudeFrameView`).
 * Tool calls are reported after the turn ends, so a mod can observe them but not deny or change them.
 */
export class ClaudeModRuntime implements AtomStore {
  static readonly PANE_VIEW = join(import.meta.dir, 'claudeFrameView.ts');
  private static readonly ELEMENTS = { Box: TermRenderer.BOX, Text: TermRenderer.TEXT, Button: TermRenderer.BUTTON, Link: TermRenderer.LINK };
  private static readonly TURN_END_EVENTS = ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'];
  private static readonly CLOSE_POLL_MS = 3000;
  private static readonly DEFAULT_SIZE = { columns: 80, rows: 24 };
  private static readonly TURN_START = 'session.execution.started';
  /** herdr's own markers stay hidden, so a mod with a herdr path of its own uses its Claude pane, which is the herdr pane here. */
  private static readonly HIDDEN_ENV = new Set(['HERDR_ENV', 'HERDR_PANE_ID']);

  private readonly registrations: Registration[] = [];
  private readonly atoms = new Map<string, unknown>();
  private readonly panes = new Map<string, PaneView>();
  private readonly commands = new Map<string, { readonly description: string }>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly releases: (() => void)[] = [];
  private currentSessionId: string | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly mod: LoadedClaudeMod,
    private readonly api: ModHostApi,
  ) {}

  /** A `HerdrMod` that hosts the Claude Code mod in `root`. */
  static async definition(root: string, loader = new ClaudeModLoader()): Promise<HerdrMod> {
    const loaded = await loader.load(root);
    let runtime: ClaudeModRuntime | null = null;
    return {
      id: `claude-${loaded.name}`,
      pane: { module: ClaudeModRuntime.PANE_VIEW },
      commands: () => runtime?.commandList() ?? [],
      setup: async (api) => {
        runtime = new ClaudeModRuntime(loaded, api);
        await runtime.start();
        return () => runtime?.stop();
      },
    };
  }

  read<Value>(token: AtomToken<Value>): Value {
    return (this.atoms.has(token.key) ? this.atoms.get(token.key) : token.initial) as Value;
  }

  update<Value>(token: AtomToken<Value>, change: (current: Value) => Value): void {
    this.atoms.set(token.key, change(this.read(token)));
    this.scheduleRender();
  }

  private async start(): Promise<void> {
    const options = { ...this.mod.defaults, ...this.api.options };
    const on = (name: string, filterOrHandler: Record<string, unknown> | Handler, maybeHandler?: Handler): void => {
      const handler = typeof filterOrHandler === 'function' ? filterOrHandler : maybeHandler;
      if (handler) {
        this.registrations.push({ name, filter: typeof filterOrHandler === 'function' ? {} : filterOrHandler, handler });
      }
    };
    for (const register of this.mod.registers) {
      register(on, options);
    }
    const data = (this.api.opencode as { data: OpencodeData }).data;
    this.releases.push(
      data.on(ClaudeModRuntime.TURN_START, (event) => void this.onTurnStart(data, event.data.sessionID)),
      ...ClaudeModRuntime.TURN_END_EVENTS.map((type) => data.on(type, (event) => void this.onTurnEnd(data, event.data.sessionID))),
    );
    this.timers.push(setInterval(() => void this.detectClosedPanes(), ClaudeModRuntime.CLOSE_POLL_MS));
    await this.dispatch('session.start', {});
  }

  private stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    for (const release of this.releases) {
      release();
    }
  }

  private commandList(): ModCommand[] {
    return [...this.commands.entries()].map(([name, { description }]) => ({
      name,
      description,
      run: async (args: string) => {
        const result = (await this.dispatch('command.run', { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string } | undefined;
        return result?.text?.split('\n')[0];
      },
    }));
  }

  private async onTurnStart(data: OpencodeData, sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;
    await data.session.message.sync(sessionId).catch(() => undefined);
    const prompt = OpencodeTurnReader.latestPrompt(data.session.message.list(sessionId));
    if (!prompt) {
      return;
    }
    for (const skill of prompt.skills) {
      await this.dispatch('skill.prompt', { skill });
    }
    await this.dispatch('turn.start', { turnId: prompt.turnId, text: prompt.text });
  }

  private async onTurnEnd(data: OpencodeData, sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;
    await data.session.message.sync(sessionId).catch(() => undefined);
    const turn = OpencodeTurnReader.latestTurn(data.session.message.list(sessionId));
    if (!turn) {
      return;
    }
    for (const call of turn.calls) {
      const result = { text: call.resultText, isError: call.isError, result: {} };
      await this.dispatch('tool.call', { tool: call.tool, ...call.input }, async () => result);
    }
    await this.dispatch('turn.complete', {
      turnId: turn.turnId,
      answer: turn.answer,
      durationMs: turn.durationMs,
      reason: turn.reason,
      usage: { output_tokens: turn.outputTokens },
    });
  }

  /** Runs the handlers registered for `name` whose filter matches, as a chain; the last `next` returns `fallback`. */
  private async dispatch(name: string, event: Record<string, unknown>, fallback: (event: Record<string, unknown>) => Promise<unknown> = async () => undefined): Promise<unknown> {
    const handlers = this.registrations.filter(
      (registration) => registration.name === name && Object.entries(registration.filter).every(([key, value]) => event[key] === value),
    );
    const run = (index: number, current: Record<string, unknown>): Promise<unknown> => {
      const registration = handlers[index];
      if (!registration) {
        return fallback(current);
      }
      return Promise.resolve(registration.handler(this.engine(), current, (next) => run(index + 1, next)));
    };
    try {
      return await run(0, { ...event, type: name });
    } catch (error) {
      await this.api.logError(`${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return undefined;
    } finally {
      this.scheduleRender();
    }
  }

  private engine(): Record<string | symbol, unknown> {
    const sessionId = () => this.currentSessionId ?? this.api.currentSessionId() ?? 'opencode';
    return {
      [ATOM_STORE]: this,
      plugin: { root: this.mod.root },
      env: { get: async (name: string) => (ClaudeModRuntime.HIDDEN_ENV.has(name) ? undefined : process.env[name]) },
      clock: {
        now: async () => Date.now(),
        every: (ms: number, tick: () => void) => {
          this.timers.push(setInterval(tick, ms));
        },
      },
      session: { id: async () => sessionId(), cwd: async () => this.api.directory() },
      command: {
        register: async (spec: { name: string; description?: string }) => {
          this.commands.set(spec.name, { description: spec.description ?? spec.name });
        },
      },
      fs: {
        exists: async (path: string) => existsSync(path),
        read: async (path: string) => readFile(path, 'utf8'),
        write: async (path: string, text: string) => {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, text);
        },
        list: async (path: string) =>
          (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file' })),
      },
      process: { run: (argv: readonly string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) => ClaudeModRuntime.run(argv, options, this.api.directory()) },
      ui: {
        open: async (spec: { id: string; title?: string }) => this.openPane(spec.id, spec.title ?? spec.id),
        resolve: () => ClaudeModRuntime.ELEMENTS,
        toast: (message: string) => this.api.toast(message),
        log: (message: string) => void this.api.logError(message),
      },
    };
  }

  private async openPane(id: string, title: string): Promise<void> {
    const known = this.panes.get(id);
    if (!known) {
      this.panes.set(id, { title, ...ClaudeModRuntime.DEFAULT_SIZE, actions: new Map(), isOpen: true });
      this.releases.push(this.api.onMessage(id, (message) => void this.onPaneMessage(id, message)));
    }
    await this.renderPane(id);
    const isOpen = await this.api.openPane(id, { isForced: true });
    const pane = this.panes.get(id);
    if (pane) {
      pane.isOpen = isOpen;
    }
  }

  private async onPaneMessage(id: string, message: unknown): Promise<void> {
    const pane = this.panes.get(id);
    const payload = message as { action?: number; size?: { columns: number; rows: number } };
    if (!pane) {
      return;
    }
    if (payload.size) {
      pane.columns = payload.size.columns;
      pane.rows = payload.size.rows;
    }
    if (typeof payload.action === 'number') {
      await Promise.resolve(pane.actions.get(payload.action)?.());
    }
    await this.renderPane(id);
  }

  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      for (const id of this.panes.keys()) {
        void this.renderPane(id);
      }
    }, 50);
  }

  private async renderPane(id: string): Promise<void> {
    const pane = this.panes.get(id);
    if (!pane) {
      return;
    }
    const props = { title: pane.title, isFocused: false, bodyColumns: pane.columns, placement: 'dock', scroll: { offset: 0, bodyRows: pane.rows }, view: {} };
    const handlers = this.registrations.filter(
      (registration) => registration.name === 'ui.render' && registration.filter['component'] === 'Pane' && (registration.filter['requestId'] ?? id) === id,
    );
    const handler = handlers[0];
    if (!handler) {
      return;
    }
    try {
      const tree = await Promise.resolve(handler.handler(this.engine(), { component: 'Pane', requestId: id, props }, async () => null));
      const { frame, actions } = FrameCodec.encode(tree);
      pane.actions = actions;
      await this.api.publish(id, { frame, size: { columns: pane.columns, rows: pane.rows } });
    } catch (error) {
      await this.api.logError(`render ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async detectClosedPanes(): Promise<void> {
    for (const [id, pane] of this.panes) {
      if (!pane.isOpen || (await this.api.isPaneOpen(id))) {
        continue;
      }
      pane.isOpen = false;
      await this.dispatch('ui.close', { id, origin: { kind: 'person' } });
    }
  }

  private static async run(argv: readonly string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = Bun.spawn([...argv], { cwd: options.cwd ?? cwd, env: { ...process.env, ...options.env }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : undefined;
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }
}
