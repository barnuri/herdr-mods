import { HerdrPane } from './herdrPane.ts';
import { withPaneLock } from './paneLock.ts';

/** What a lifecycle remembers, so a caller that runs once per event (the `open` CLI) can keep it between runs. */
export interface PaneLifecycleSnapshot {
  readonly paneIds: Readonly<Record<string, string>>;
  readonly autoOpened: readonly string[];
}

/**
 * The herdr panes beside one agent pane. At most one mod panel lives in the agent pane's tab: herdr is the
 * source of truth, so the opencode host and the `open` CLI never add a second one. A pane opens by itself at
 * most once; after the person closes it, only a forced open (the mod's command) brings it back.
 */
export class PaneLifecycle {
  private readonly paneIds: Map<string, string>;
  private readonly autoOpened: Set<string>;
  private relayouting = false;
  private pendingSide: 'right' | 'down' | undefined;

  constructor(
    private readonly besidePaneId: string,
    snapshot: PaneLifecycleSnapshot = { paneIds: {}, autoOpened: [] },
  ) {
    this.paneIds = new Map(Object.entries(snapshot.paneIds));
    this.autoOpened = new Set(snapshot.autoOpened);
  }

  snapshot(): PaneLifecycleSnapshot {
    return { paneIds: Object.fromEntries(this.paneIds), autoOpened: [...this.autoOpened] };
  }

  async open(paneKey: string, env: Readonly<Record<string, string>>, isForced: boolean): Promise<boolean> {
    return (await withPaneLock(this.besidePaneId, () => this.openLocked(paneKey, env, isForced))) ?? false;
  }

  private async openLocked(paneKey: string, env: Readonly<Record<string, string>>, isForced: boolean): Promise<boolean> {
    const panes = await HerdrPane.modPanesIn(this.besidePaneId);
    if (panes === null) {
      return false;
    }
    const known = this.paneIds.get(paneKey);
    const own = known !== undefined && panes.includes(known) ? known : undefined;
    const others = panes.filter((paneId) => paneId !== own);
    if (others.length > 0 && !isForced) {
      return false;
    }
    if (others.length > 0) {
      // A forced open replaces the mod panel that is there.
      await Promise.all(others.map((paneId) => HerdrPane.close(paneId)));
      for (const [key, paneId] of [...this.paneIds]) {
        if (paneId !== own) {
          this.paneIds.delete(key);
        }
      }
    }
    if (own !== undefined) {
      return true;
    }
    if (!isForced && this.autoOpened.has(paneKey)) {
      return false;
    }
    const paneId = await HerdrPane.open(this.besidePaneId, env);
    if (!paneId) {
      return false;
    }
    this.paneIds.set(paneKey, paneId);
    this.autoOpened.add(paneKey);
    return true;
  }

  /** Moves the mod panel to the side its tab's width calls for. Never throws; a move keeps the pane's process running. */
  async relayout(): Promise<void> {
    if (this.relayouting) {
      return;
    }
    this.relayouting = true;
    try {
      await withPaneLock(this.besidePaneId, async () => {
        const panes = await HerdrPane.modPanesIn(this.besidePaneId);
        const [panel, ...extra] = panes ?? [];
        if (panel === undefined) {
          return;
        }
        // Heals a tab that somehow has more than one mod panel (for example one opened before this guard existed).
        await Promise.all(extra.map((paneId) => HerdrPane.close(paneId)));
        const layout = await HerdrPane.layoutOf(this.besidePaneId);
        if (!layout) {
          return;
        }
        const wanted = HerdrPane.directionForWidth(layout.areaWidth);
        const width = layout.widths.get(panel);
        if (width !== undefined) {
          const current = width >= layout.areaWidth ? 'down' : 'right';
          if (current !== wanted) {
            // Move only once the new width has held for two checks, so two screens taking turns don't make the panel bounce.
            if (this.pendingSide === wanted) {
              this.pendingSide = undefined;
              await HerdrPane.move(panel, this.besidePaneId, wanted);
            } else {
              this.pendingSide = wanted;
            }
          } else {
            this.pendingSide = undefined;
          }
        }
      });
    } catch {
      /* a failed relayout leaves the panel where it is; the next tick tries again */
    } finally {
      this.relayouting = false;
    }
  }

  async isOpen(paneKey: string): Promise<boolean> {
    const known = this.paneIds.get(paneKey);
    const panes = await HerdrPane.modPanesIn(this.besidePaneId);
    return known !== undefined && panes !== null && panes.includes(known);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.paneIds.values()].map((paneId) => HerdrPane.close(paneId)));
    this.paneIds.clear();
  }
}
