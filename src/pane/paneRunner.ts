import type { ModPaneUi, ModPaneView } from '../modApi.ts';
import { StateStore } from '../state/stateStore.ts';
import { TermRenderer } from '../render/termRenderer.ts';
import type { ClickRegion, TermFrame } from '../render/termRenderer.ts';

/**
 * Runs one mod's view in a terminal (a herdr pane): renders the last published state, sends mouse
 * clicks and hotkeys to its buttons, and exits when the opencode process that opened it exits.
 */
export class PaneRunner {
  private static readonly ELEMENTS = { Box: TermRenderer.BOX, Text: TermRenderer.TEXT, Button: TermRenderer.BUTTON, Link: TermRenderer.LINK };
  private static readonly POLL_MS = 1000;
  private static readonly QUIT_KEYS = new Set(['\u0003']);
  private static readonly ENTER_SCREEN = '\x1b[?1049h\x1b[?7l\x1b[?25l\x1b[?1000h\x1b[?1006h';
  private static readonly LEAVE_SCREEN = '\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?7h\x1b[?1049l';
  private static readonly MOUSE_PRESS = /\x1b\[<0;(\d+);(\d+)M/g;

  private readonly store = new StateStore();
  private readonly locals = new Map<string, unknown>();
  private state: unknown = null;
  private frame: TermFrame | null = null;
  private noticeText = '';
  private lastText = '';
  private lastSent = '';

  constructor(
    private readonly modId: string,
    private readonly view: ModPaneView,
    private readonly key: string,
    private readonly options: Readonly<Record<string, unknown>>,
    private readonly parentPid: number,
  ) {}

  async run(): Promise<void> {
    process.stdout.write(PaneRunner.ENTER_SCREEN);
    process.on('exit', () => process.stdout.write(PaneRunner.LEAVE_SCREEN));
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', (data) => this.onInput(data.toString('utf8')));
    process.stdout.on('resize', () => this.draw(true));
    await this.reload();
    setInterval(() => {
      if (!this.isParentAlive()) {
        process.exit(0);
      }
      void this.reload();
    }, PaneRunner.POLL_MS);
  }

  private async reload(): Promise<void> {
    const next = await this.store.read(this.store.pathFor(this.modId, this.key));
    if (next !== null) {
      this.state = next;
    }
    this.draw(false);
  }

  private draw(isForced: boolean): void {
    const columns = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    let tree: unknown;
    try {
      tree = this.view(this.state, this.ui(columns, rows));
    } catch (error) {
      void this.store.logError(this.modId, `render failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.frame = new TermRenderer(columns, (target) => this.open(target)).render(tree);
    const lines = this.noticeText ? [...this.frame.lines.slice(0, rows - 1), `\x1b[2m${this.noticeText}\x1b[0m`] : this.frame.lines.slice(0, rows);
    const text = lines.join('\n');
    if (!isForced && text === this.lastText) {
      return;
    }
    this.lastText = text;
    process.stdout.write(`\x1b[H\x1b[2J${text}`);
  }

  private ui(columns: number, rows: number): ModPaneUi {
    return {
      elements: PaneRunner.ELEMENTS,
      columns,
      rows,
      key: this.key,
      options: this.options,
      local: <Value>(name: string, initial: Value) => {
        const value = (this.locals.has(name) ? this.locals.get(name) : initial) as Value;
        const set = (next: Value): void => {
          this.locals.set(name, next);
          this.draw(true);
        };
        return [value, set] as const;
      },
      open: (target) => this.open(target),
      notice: (message) => {
        this.noticeText = message;
        this.draw(true);
      },
      redraw: () => this.draw(true),
      send: (message) => {
        const line = JSON.stringify(message);
        if (line === this.lastSent) {
          return;
        }
        this.lastSent = line;
        void this.store.send(this.store.inputPathFor(this.modId, this.key), message);
      },
      close: () => process.exit(0),
    };
  }

  private onInput(data: string): void {
    for (const match of data.matchAll(PaneRunner.MOUSE_PRESS)) {
      this.click(Number(match[1]) - 1, Number(match[2]) - 1);
    }
    const key = data.replace(PaneRunner.MOUSE_PRESS, '');
    if (PaneRunner.QUIT_KEYS.has(key)) {
      process.exit(0);
    }
    this.frame?.hotkeys.get(key)?.();
  }

  private click(column: number, row: number): void {
    const hit = this.frame?.regions.find((region: ClickRegion) => region.row === row && column >= region.start && column < region.end);
    hit?.onPress();
  }

  private open(target: string): void {
    const path = target.startsWith('file://') ? target.slice('file://'.length) : target;
    Bun.spawn([process.platform === 'darwin' ? 'open' : 'xdg-open', path], { stdout: 'ignore', stderr: 'ignore' });
  }

  private isParentAlive(): boolean {
    if (this.parentPid <= 0) {
      return true;
    }
    try {
      process.kill(this.parentPid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
