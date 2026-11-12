import type { ModPaneUi, ModPaneView } from '../modApi.ts';
import type { PanelRecord, PanelTab } from '../state/panelState.ts';
import { StateStore } from '../state/stateStore.ts';
import { TermRenderer } from '../render/termRenderer.ts';
import type { ClickRegion, TermFrame } from '../render/termRenderer.ts';
import { HerdrPane } from '../herdr/herdrPane.ts';

interface TabRegion {
  readonly modId: string;
  readonly start: number;
  readonly end: number;
}

const tabId = (tab: PanelTab): string => `${tab.modId}:${tab.key}`;

/**
 * Runs the mod panel in a terminal (a herdr pane). The top row holds a tab per active mod and the rest
 * shows the selected tab's view. It renders that view's last published state, sends clicks and hotkeys to its
 * buttons, and exits when the opencode process that opened it exits.
 */
export class PaneRunner {
  private static readonly ELEMENTS = { Box: TermRenderer.BOX, Text: TermRenderer.TEXT, Button: TermRenderer.BUTTON, Link: TermRenderer.LINK };
  private static readonly POLL_MS = 1000;
  private static readonly QUIT_KEYS = new Set(['\u0003']);
  /** Moves to the next tab, when the panel has more than one. */
  private static readonly NEXT_TAB_KEY = '\t';
  private static readonly ENTER_SCREEN = '\x1b[?1049h\x1b[?7l\x1b[?25l\x1b[?1000h\x1b[?1006h';
  private static readonly LEAVE_SCREEN = '\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?7h\x1b[?1049l';
  /** The exit button drawn over the top right corner. */
  private static readonly CLOSE_LABEL = ' x ';
  /** The grow and shrink buttons, drawn just left of the exit button; the strip is shrink, grow, exit. */
  private static readonly SHRINK_LABEL = ' - ';
  private static readonly GROW_LABEL = ' + ';
  private static readonly MOUSE_PRESS = /\x1b\[<0;(\d+);(\d+)M/g;

  private readonly store = new StateStore();
  /** This pane's herdr id, when herdr runs it; the tab titles and the grow and shrink buttons need it. */
  private readonly paneId = process.env['HERDR_PANE_ID'] || undefined;
  /** Each mod's pane-local values, kept while its tab is not selected. */
  private readonly locals = new Map<string, Map<string, unknown>>();
  /** The views loaded so far, by path; null when a view failed to load. */
  private readonly views = new Map<string, ModPaneView | null>();
  /** The last published state of each tab, by `<mod id>:<key>`. */
  private readonly states = new Map<string, unknown>();
  /** The last message sent per input file, so identical messages go once. */
  private readonly lastSent = new Map<string, string>();
  private record: PanelRecord | null = null;
  private selectedId: string | undefined;
  /** The `focus.at` already applied, so a forced open selects its tab once. */
  private focusSeen = 0;
  private tabRegions: TabRegion[] = [];
  private frame: TermFrame | null = null;
  private noticeText = '';
  private lastText = '';
  /** True while `takeover` has handed the terminal to another program: no drawing, no input. */
  private isTakenOver = false;

  /** `loadRecord` gives the panel's record each poll; `parentPid` is the opencode process that owns the panel. */
  constructor(
    private readonly loadRecord: () => Promise<PanelRecord | null>,
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
    const next = await this.loadRecord();
    if (next) {
      this.record = next;
      for (const tab of next.tabs) {
        await this.loadView(tab);
      }
      for (const tab of next.tabs) {
        const state = await this.store.read(this.store.pathFor(tab.modId, tab.key));
        if (state !== null) {
          this.states.set(tabId(tab), state);
        }
      }
      this.follow(next);
    }
    this.draw(false);
  }

  /** Applies a forced open's choice once; a selection that no tab holds falls back to the first tab. */
  private follow(record: PanelRecord): void {
    const focus = record.focus && record.focus.at !== this.focusSeen ? record.focus : null;
    if (focus) {
      this.focusSeen = focus.at;
    }
    const modIds = record.tabs.map((tab) => tab.modId);
    const wanted = focus?.modId ?? this.selectedId;
    this.setSelected(wanted !== undefined && modIds.includes(wanted) ? wanted : modIds[0]);
  }

  private async loadView(tab: PanelTab): Promise<void> {
    if (this.views.has(tab.view)) {
      return;
    }
    try {
      this.views.set(tab.view, (await import(tab.view)).default as ModPaneView);
    } catch (error) {
      this.views.set(tab.view, null);
      void this.store.logError(tab.modId, `view failed to load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private draw(isForced: boolean): void {
    if (this.isTakenOver) {
      return;
    }
    const columns = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    const bar = this.tabBar(columns);
    this.tabRegions = bar.regions;
    const selected = this.record?.tabs.find((tab) => tab.modId === this.selectedId);
    const view = selected ? this.views.get(selected.view) : undefined;
    let body: string[] = [];
    if (selected && view) {
      let tree: unknown;
      try {
        tree = view(this.states.get(tabId(selected)) ?? null, this.ui(selected, columns, rows - 1));
      } catch (error) {
        void this.store.logError(selected.modId, `render failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.frame = new TermRenderer(columns, (target) => this.open(target)).render(tree);
      body = this.frame.lines.slice(0, rows - 1);
    } else {
      this.frame = null;
    }
    const all = [bar.text, ...body];
    const lines = this.noticeText ? [...all.slice(0, rows - 1), `\x1b[2m${this.noticeText}\x1b[0m`] : all.slice(0, rows);
    const text = lines.join('\n');
    if (!isForced && text === this.lastText) {
      return;
    }
    this.lastText = text;
    const controlsColumn = this.controlsColumn(columns) + 1;
    process.stdout.write(`\x1b[H\x1b[2J${text}\x1b[0m\x1b[1;${controlsColumn}H\x1b[0;1m${this.controlsLabel()}\x1b[0m`);
  }

  /** The top row: one tab per mod, the selected one inverted. Tabs stop before the top right buttons. */
  private tabBar(columns: number): { readonly text: string; readonly regions: TabRegion[] } {
    const limit = this.controlsColumn(columns);
    const regions: TabRegion[] = [];
    let text = '';
    let start = 0;
    for (const tab of this.record?.tabs ?? []) {
      const label = ` ${HerdrPane.name(tab.modId)} `;
      if (start + label.length > limit) {
        break;
      }
      regions.push({ modId: tab.modId, start, end: start + label.length });
      text += tab.modId === this.selectedId ? `\x1b[1;7m${label}\x1b[0m` : `\x1b[2m${label}\x1b[0m`;
      start += label.length;
    }
    return { text, regions };
  }

  /** The top right buttons: shrink, grow (only when herdr can resize this pane), then exit. */
  private controlsLabel(): string {
    return this.paneId ? PaneRunner.SHRINK_LABEL + PaneRunner.GROW_LABEL + PaneRunner.CLOSE_LABEL : PaneRunner.CLOSE_LABEL;
  }

  /** The 0-based column the top right buttons start at. */
  private controlsColumn(columns: number): number {
    return Math.max(0, columns - this.controlsLabel().length);
  }

  /** The view's API for one tab. `rows` leaves out the tab row. */
  private ui(tab: PanelTab, columns: number, rows: number): ModPaneUi {
    return {
      elements: PaneRunner.ELEMENTS,
      columns,
      rows,
      key: tab.key,
      options: tab.options,
      local: <Value>(name: string, initial: Value) => {
        const locals = this.localsOf(tab.modId);
        const value = (locals.has(name) ? locals.get(name) : initial) as Value;
        const set = (next: Value): void => {
          locals.set(name, next);
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
        const path = this.store.inputPathFor(tab.modId, tab.key);
        const line = JSON.stringify(message);
        if (line === this.lastSent.get(path)) {
          return;
        }
        this.lastSent.set(path, line);
        void this.store.send(path, message);
      },
      takeover: (argv) => this.takeover(argv),
      close: () => process.exit(0),
    };
  }

  private localsOf(modId: string): Map<string, unknown> {
    let locals = this.locals.get(modId);
    if (!locals) {
      locals = new Map();
      this.locals.set(modId, locals);
    }
    return locals;
  }

  private async takeover(argv: readonly string[]): Promise<number> {
    if (this.isTakenOver) {
      return -1;
    }
    this.isTakenOver = true;
    process.stdout.write(PaneRunner.LEAVE_SCREEN);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    try {
      return await Bun.spawn([...argv], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).exited;
    } catch (error) {
      void this.store.logError(this.selectedId ?? 'panel', `takeover failed for ${argv[0]}: ${error instanceof Error ? error.message : String(error)}`);
      return -1;
    } finally {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdout.write(PaneRunner.ENTER_SCREEN);
      this.isTakenOver = false;
      this.draw(true);
    }
  }

  private onInput(data: string): void {
    if (this.isTakenOver) {
      return;
    }
    for (const match of data.matchAll(PaneRunner.MOUSE_PRESS)) {
      this.click(Number(match[1]) - 1, Number(match[2]) - 1);
    }
    const key = data.replace(PaneRunner.MOUSE_PRESS, '');
    if (PaneRunner.QUIT_KEYS.has(key)) {
      process.exit(0);
    }
    const hotkey = this.frame?.hotkeys.get(key);
    if (hotkey) {
      hotkey();
    } else if (key === PaneRunner.NEXT_TAB_KEY) {
      this.selectNext();
    } else if (key === '+') {
      this.resize(true);
    } else if (key === '-') {
      this.resize(false);
    }
  }

  private click(column: number, row: number): void {
    const columns = process.stdout.columns ?? 80;
    if (row === 0 && column >= columns - PaneRunner.CLOSE_LABEL.length) {
      process.exit(0);
    }
    if (row === 0 && this.paneId) {
      const start = this.controlsColumn(columns);
      const shrinkEnd = start + PaneRunner.SHRINK_LABEL.length;
      if (column >= start && column < shrinkEnd) {
        this.resize(false);
        return;
      }
      if (column >= shrinkEnd && column < shrinkEnd + PaneRunner.GROW_LABEL.length) {
        this.resize(true);
        return;
      }
    }
    if (row === 0) {
      const tab = this.tabRegions.find((region) => column >= region.start && column < region.end);
      if (tab) {
        this.select(tab.modId);
      }
      return;
    }
    const hit = this.frame?.regions.find((region: ClickRegion) => region.row === row - 1 && column >= region.start && column < region.end);
    hit?.onPress();
  }

  private select(modId: string): void {
    this.setSelected(modId);
    this.draw(true);
  }

  private selectNext(): void {
    const tabs = this.record?.tabs ?? [];
    if (tabs.length < 2) {
      return;
    }
    const index = tabs.findIndex((tab) => tab.modId === this.selectedId);
    const next = tabs[(index + 1) % tabs.length];
    if (next) {
      this.select(next.modId);
    }
  }

  /** Shows `modId`'s tab and gives the pane that mod's title. */
  private setSelected(modId: string | undefined): void {
    if (modId === undefined || modId === this.selectedId) {
      return;
    }
    this.selectedId = modId;
    this.noticeText = '';
    if (this.paneId) {
      void HerdrPane.rename(this.paneId, HerdrPane.title(modId));
    }
  }

  /** Grows or shrinks this pane in herdr; herdr redraws the pane when its size changes. */
  private resize(grow: boolean): void {
    if (this.paneId) {
      void HerdrPane.resize(this.paneId, grow);
    }
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
