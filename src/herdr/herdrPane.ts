/** A herdr pane split beside another pane, through the `herdr` CLI. */
export class HerdrPane {
  // herdr's ratio is the share the existing (opencode) pane keeps.
  private static readonly SPLIT_RATIO = '0.65';
  /** Narrower than this, the opencode pane keeps its full width and the new pane goes below it (phone-sized screens). */
  static readonly SIDE_BY_SIDE_MIN_COLUMNS = 140;
  private static readonly TIMEOUT_MS = 5000;

  /** The pane this process runs in, when it runs inside herdr. */
  static currentPaneId(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    return env['HERDR_ENV'] === '1' ? env['HERDR_PANE_ID'] : undefined;
  }

  /** Splits `besidePaneId` (right when wide, below when narrow) without moving focus, runs `command`, and returns the new pane id. */
  static async open(besidePaneId: string, cwd: string, command: string): Promise<string | null> {
    const direction = HerdrPane.direction(await HerdrPane.herdr(['pane', 'layout', '--pane', besidePaneId]), besidePaneId);
    const split = await HerdrPane.herdr(['pane', 'split', besidePaneId, '--direction', direction, '--ratio', HerdrPane.SPLIT_RATIO, '--cwd', cwd, '--no-focus']);
    const paneId = HerdrPane.paneIdOf(split);
    if (!paneId) {
      return null;
    }
    await HerdrPane.herdr(['pane', 'run', paneId, command]);
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
    const result = output.result as { pane?: { pane_id?: unknown }; pane_id?: unknown } | null;
    const id = result?.pane?.pane_id ?? result?.pane_id;
    return typeof id === 'string' ? id : null;
  }

  private static async herdr(args: readonly string[]): Promise<unknown> {
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
  }
}
