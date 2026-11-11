/** A herdr pane split beside another pane, through the `herdr` CLI. */
export class HerdrPane {
  static readonly PLUGIN_ID = 'barnuri.mods';
  static readonly ENTRYPOINT = 'mod';
  /** Narrower than this, the opencode pane keeps its full width and the new pane goes below it (phone-sized screens). */
  static readonly SIDE_BY_SIDE_MIN_COLUMNS = 140;
  /** herdr opens a split at half; the new pane then gives this share back to the opencode pane. */
  private static readonly SHRINK_AMOUNT = '0.15';
  private static readonly TIMEOUT_MS = 5000;

  /** The pane this process runs in, when it runs inside herdr. */
  static currentPaneId(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    return env['HERDR_ENV'] === '1' ? env['HERDR_PANE_ID'] : undefined;
  }

  /**
   * Opens this plugin's pane entrypoint beside `besidePaneId` (right when wide, below when narrow)
   * without moving focus, with `env` for the pane process. Returns the new pane id, or null when herdr
   * could not open it (for example, the plugin is not installed). No `--cwd`: herdr resolves the
   * manifest's relative pane command against the pane's cwd, so it must stay the plugin root.
   */
  static async open(besidePaneId: string, env: Readonly<Record<string, string>>): Promise<string | null> {
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
      await HerdrPane.herdr(['pane', 'resize', '--pane', paneId, '--direction', direction, '--amount', HerdrPane.SHRINK_AMOUNT]);
    }
    return paneId;
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
