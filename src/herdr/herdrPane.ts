/** A herdr pane split beside another pane, through the `herdr` CLI. */
export class HerdrPane {
  static readonly PLUGIN_ID = 'barnuri.mods';
  static readonly ENTRYPOINT = 'mod';
  /** Narrower than this, the opencode pane keeps its full width and the new pane goes below it (phone-sized screens). */
  static readonly SIDE_BY_SIDE_MIN_COLUMNS = 140;
  /** herdr opens a split at half; the new pane then gives this share back to the opencode pane. */
  private static readonly SHRINK_AMOUNT = '0.15';
  /** One in-panel grow or shrink step, as a share of the tab's width or height (`pane resize --amount`). */
  static readonly RESIZE_STEP = '0.05';
  private static readonly TIMEOUT_MS = 5000;

  /** The pane this process runs in, when it runs inside herdr. */
  static currentPaneId(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    return env['HERDR_ENV'] === '1' ? env['HERDR_PANE_ID'] : undefined;
  }

  /**
   * Opens this plugin's pane entrypoint beside `besidePaneId` (right when wide, below when narrow)
   * without moving focus, with `env` for the pane process and `title` as its label. Returns the new pane
   * id, or null when herdr could not open it (for example, the plugin is not installed). No `--cwd`: herdr
   * resolves the manifest's relative pane command against the pane's cwd, so it must stay the plugin root.
   */
  static async open(besidePaneId: string, env: Readonly<Record<string, string>>, title: string): Promise<string | null> {
    const direction = HerdrPane.direction(await HerdrPane.herdr(['pane', 'layout', '--pane', besidePaneId]), besidePaneId);
    const envFlags = Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
    const opened = await HerdrPane.herdr([
      'plugin', 'pane', 'open',
      '--plugin', HerdrPane.PLUGIN_ID,
      '--entrypoint', HerdrPane.ENTRYPOINT,
      '--target-pane', besidePaneId,
      '--direction', direction,
      '--placement', 'split',
      '--no-focus',
      ...envFlags,
    ]);
    const paneId = HerdrPane.paneIdOf(opened);
    if (paneId) {
      await HerdrPane.rename(paneId, title);
      await HerdrPane.herdr(['pane', 'resize', '--pane', paneId, '--direction', direction, '--amount', HerdrPane.SHRINK_AMOUNT]);
    }
    return paneId;
  }

  /** The mod's name as its tab and title show it: the id without the `claude-` prefix. */
  static name(modId: string): string {
    return modId.replace(/^claude-/, '');
  }

  /** The pane label: `<mod name> mod`. */
  static title(modId: string): string {
    return `${HerdrPane.name(modId)} mod`;
  }

  static async rename(paneId: string, title: string): Promise<void> {
    await HerdrPane.herdr(['pane', 'rename', paneId, title]);
  }

  static async exists(paneId: string): Promise<boolean> {
    return (await HerdrPane.herdr(['pane', 'get', paneId])) !== null;
  }

  static async close(paneId: string): Promise<void> {
    await HerdrPane.herdr(['pane', 'close', paneId]);
  }

  /** `right` when the pane is at least SIDE_BY_SIDE_MIN_COLUMNS wide, else `down`; `right` when the size is unknown. */
  static direction(layout: unknown, paneId: string): 'right' | 'down' {
    const panes = (layout as { result?: { layout?: { panes?: { pane_id?: string; rect?: { width?: number } }[] } } } | null)?.result?.layout?.panes ?? [];
    const width = panes.find((pane) => pane.pane_id === paneId)?.rect?.width;
    return typeof width === 'number' && width < HerdrPane.SIDE_BY_SIDE_MIN_COLUMNS ? 'down' : 'right';
  }

  /**
   * Every mod panel (labelled `<name> mod`) in the same tab as `besidePaneId`, as herdr reports them. Null when
   * herdr cannot list the panes: the caller must then not open one, since it cannot tell whether one exists.
   */
  static async modPanesIn(besidePaneId: string): Promise<string[] | null> {
    const list = (await HerdrPane.herdr(['pane', 'list'])) as
      | { result?: { panes?: { pane_id?: unknown; tab_id?: unknown; label?: unknown }[] } }
      | null;
    if (!list?.result?.panes) {
      return null;
    }
    const panes = list.result.panes;
    const tab = panes.find((pane) => pane.pane_id === besidePaneId)?.tab_id;
    // The case-insensitive match also finds panels that an older version labelled `<name> Mod`.
    return panes
      .filter((pane) => tab !== undefined && pane.tab_id === tab && typeof pane.label === 'string' && /\smod$/i.test(pane.label))
      .map((pane) => pane.pane_id)
      .filter((id): id is string => typeof id === 'string');
  }

  /** The side a panel should take for a tab this wide: `right` at SIDE_BY_SIDE_MIN_COLUMNS or more, else `down`. */
  static directionForWidth(areaWidth: number): 'right' | 'down' {
    return areaWidth < HerdrPane.SIDE_BY_SIDE_MIN_COLUMNS ? 'down' : 'right';
  }

  /** The tab's full width and each pane's width in it, or null when herdr cannot report the layout. */
  static async layoutOf(paneId: string): Promise<{ areaWidth: number; widths: Map<string, number> } | null> {
    const layout = (await HerdrPane.herdr(['pane', 'layout', '--pane', paneId])) as
      | { result?: { layout?: { area?: { width?: unknown }; panes?: { pane_id?: unknown; rect?: { width?: unknown } }[] } } }
      | null;
    const areaWidth = layout?.result?.layout?.area?.width;
    if (typeof areaWidth !== 'number') {
      return null;
    }
    const widths = new Map<string, number>();
    for (const pane of layout?.result?.layout?.panes ?? []) {
      if (typeof pane.pane_id === 'string' && typeof pane.rect?.width === 'number') {
        widths.set(pane.pane_id, pane.rect.width);
      }
    }
    return { areaWidth, widths };
  }

  /** Moves a pane beside `besidePaneId` on `direction`, then gives the opencode pane its share back, as `open` does. */
  static async move(paneId: string, besidePaneId: string, direction: 'right' | 'down'): Promise<void> {
    await HerdrPane.herdr(['pane', 'move', paneId, '--target-pane', besidePaneId, '--split', direction, '--no-focus']);
    await HerdrPane.herdr(['pane', 'resize', '--pane', paneId, '--direction', direction, '--amount', HerdrPane.SHRINK_AMOUNT]);
  }

  /**
   * The `pane resize` direction that grows (or shrinks) `paneId` by one step, or null when the layout is unknown.
   * herdr moves the border on that side: a panel on the right grows to the `left`, a panel below grows `up`.
   */
  static resizeDirection(layout: unknown, paneId: string, grow: boolean): 'left' | 'right' | 'up' | 'down' | null {
    const area = (layout as { result?: { layout?: { area?: { width?: number } } } } | null)?.result?.layout?.area;
    const panes = (layout as { result?: { layout?: { panes?: { pane_id?: string; rect?: { width?: number } }[] } } } | null)?.result?.layout?.panes ?? [];
    const width = panes.find((pane) => pane.pane_id === paneId)?.rect?.width;
    if (typeof width !== 'number' || typeof area?.width !== 'number') {
      return null;
    }
    const beside: 'right' | 'down' = width < area.width ? 'right' : 'down';
    if (beside === 'right') {
      return grow ? 'left' : 'right';
    }
    return grow ? 'up' : 'down';
  }

  /** Grows or shrinks `paneId` by one step (`RESIZE_STEP`) on the side that faces the opencode pane. Never throws. */
  static async resize(paneId: string, grow: boolean): Promise<void> {
    const direction = HerdrPane.resizeDirection(await HerdrPane.herdr(['pane', 'layout', '--pane', paneId]), paneId, grow);
    if (direction) {
      await HerdrPane.herdr(['pane', 'resize', '--pane', paneId, '--direction', direction, '--amount', HerdrPane.RESIZE_STEP]);
    }
  }

  static paneIdOf(output: unknown): string | null {
    if (!output || typeof output !== 'object' || !('result' in output)) {
      return null;
    }
    const result = output.result as { plugin_pane?: { pane?: { pane_id?: unknown } }; pane?: { pane_id?: unknown } } | null;
    const id = result?.plugin_pane?.pane?.pane_id ?? result?.pane?.pane_id;
    return typeof id === 'string' ? id : null;
  }

  /** The parsed JSON reply, or null when herdr is missing, fails, times out or prints no JSON. Never throws. */
  private static async herdr(args: readonly string[]): Promise<unknown> {
    try {
      const child = Bun.spawn(['herdr', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
      const timer = setTimeout(() => child.kill(), HerdrPane.TIMEOUT_MS);
      try {
        const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (exitCode !== 0) {
          return null;
        }
        return stdout.trim() === '' ? {} : JSON.parse(stdout);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }
}
