import { PANEL_MOD, panelSideKey } from '../state/panelState.ts';
import type { PanelRecord, PanelTab } from '../state/panelState.ts';
import { StateStore } from '../state/stateStore.ts';
import { HerdrPane } from './herdrPane.ts';
import { withPaneLock } from './paneLock.ts';

export interface PanelOpenOptions {
  /** A forced open (the mod's command) selects the tab and reopens a closed panel; an automatic one does neither. */
  readonly isForced: boolean;
  /** Open by itself only once per agent pane: when the person closed the panel, an automatic open leaves it closed. */
  readonly isOnce?: boolean;
  /** The opencode process that owns the panel; the pane exits when it exits. */
  readonly parentPid: number;
}

/**
 * The mod panel beside one agent pane: one herdr pane per tab, holding a tab per active mod. herdr is the
 * source of truth for whether the panel lives; its tabs live in a record file that the pane process reads.
 * A mod opens by itself whenever it has a turn to show, including after the person closed the panel.
 */
export class PaneLifecycle {
  private relayouting = false;
  private pendingSide: 'right' | 'down' | undefined;

  constructor(
    private readonly besidePaneId: string,
    private readonly store: StateStore = new StateStore(),
  ) {}

  /** Adds `tab` to the mod panel beside this pane, opening the panel when there is none. Returns whether the tab is shown. */
  async open(tab: PanelTab, options: PanelOpenOptions): Promise<boolean> {
    return (await withPaneLock(this.besidePaneId, () => this.openLocked(tab, options))) ?? false;
  }

  private async openLocked(tab: PanelTab, { isForced, isOnce, parentPid }: PanelOpenOptions): Promise<boolean> {
    const panes = await HerdrPane.modPanesIn(this.besidePaneId);
    if (panes === null) {
      return false;
    }
    const [panel, ...extra] = panes;
    // A tab holds one mod panel: close any extra one (from before this guard, or from a race).
    await Promise.all(extra.map((paneId) => HerdrPane.close(paneId)));
    const saved = await this.read();
    if (panel !== undefined) {
      const shown = saved?.tabs.find((item) => item.modId === tab.modId);
      if (!isForced && shown?.key === tab.key) {
        return true;
      }
      await this.write(this.withTab(saved, tab, isForced));
      return true;
    }
    // The panel is gone but this mod already had a tab in it: the person closed it. A once-only automatic open stays out.
    if (isOnce === true && !isForced && saved?.tabs.some((item) => item.modId === tab.modId)) {
      return false;
    }
    // A new panel starts with only this tab. The record is written before the pane opens, so the pane starts on it.
    const record: PanelRecord = { tabs: [tab], focus: { modId: tab.modId, at: Date.now() } };
    await this.write(record);
    const env = { HERDR_MODS_PANEL: this.besidePaneId, HERDR_MODS_PARENT_PID: String(parentPid) };
    const paneId = await HerdrPane.open(this.besidePaneId, env, HerdrPane.title(tab.modId));
    if (paneId === null && isOnce === true) {
      await this.write(saved ?? { tabs: [], focus: null });
    }
    return paneId !== null;
  }

  /** The record with `tab` added, or replacing the tab of the same mod (one tab per mod), and focused when forced. */
  private withTab(saved: PanelRecord | null, tab: PanelTab, isForced: boolean): PanelRecord {
    const base: PanelRecord = saved ?? { tabs: [], focus: null };
    const index = base.tabs.findIndex((item) => item.modId === tab.modId);
    const tabs = index >= 0 ? base.tabs.map((item, at) => (at === index ? tab : item)) : [...base.tabs, tab];
    return {
      tabs,
      focus: isForced ? { modId: tab.modId, at: Math.max(Date.now(), (base.focus?.at ?? 0) + 1) } : base.focus,
    };
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
        const chosen = await this.chosenSide();
        const wanted = chosen ?? HerdrPane.directionForWidth(layout.areaWidth);
        const width = layout.widths.get(panel);
        const side = layout.raw === undefined ? null : HerdrPane.sideOf(layout.raw, panel, this.besidePaneId);
        if (width !== undefined) {
          const current = side === null ? (width >= layout.areaWidth ? 'down' : 'right') : side === 'left' || side === 'right' ? 'right' : 'down';
          if (current !== wanted) {
            // A side the person chose moves at once. A width change moves only once it has held for two checks,
            // so two screens taking turns don't make the panel bounce.
            if (chosen !== null || this.pendingSide === wanted) {
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

  /** Whether the tab for `paneKey` (`<mod id>:<key>`) is shown now: its panel is open and holds it. */
  async isOpen(paneKey: string): Promise<boolean> {
    const panes = await HerdrPane.modPanesIn(this.besidePaneId);
    if (!panes?.length) {
      return false;
    }
    const record = await this.read();
    return record?.tabs.some((tab) => `${tab.modId}:${tab.key}` === paneKey) ?? false;
  }

  /** Closes every mod panel in this pane's tab. */
  async closeAll(): Promise<void> {
    const panes = (await HerdrPane.modPanesIn(this.besidePaneId)) ?? [];
    await Promise.all(panes.map((paneId) => HerdrPane.close(paneId)));
  }

  private async read(): Promise<PanelRecord | null> {
    const record = (await this.store.read(this.store.pathFor(PANEL_MOD, this.besidePaneId))) as PanelRecord | null;
    return record && Array.isArray(record.tabs) ? record : null;
  }

  /** The side the person picked with the panel's move button, or null to follow the tab width. */
  private async chosenSide(): Promise<'right' | 'down' | null> {
    const saved = (await this.store.read(this.store.pathFor(PANEL_MOD, panelSideKey(this.besidePaneId)))) as { side?: unknown } | null;
    return saved?.side === 'right' || saved?.side === 'down' ? saved.side : null;
  }

  private async write(record: PanelRecord): Promise<void> {
    await this.store.write(PANEL_MOD, this.besidePaneId, record);
  }
}
