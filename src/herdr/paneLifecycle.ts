import { HerdrPane } from './herdrPane.ts';

/** What a lifecycle remembers, so a caller that runs once per event (the `open` CLI) can keep it between runs. */
export interface PaneLifecycleSnapshot {
  readonly paneIds: Readonly<Record<string, string>>;
  readonly autoOpened: readonly string[];
}

/**
 * The herdr panes beside one agent pane, one per mod and key. A pane opens by itself at most once;
 * after the person closes it, only a forced open (the mod's command) brings it back.
 */
export class PaneLifecycle {
  private readonly paneIds: Map<string, string>;
  private readonly autoOpened: Set<string>;

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
    const known = this.paneIds.get(paneKey);
    const others = await this.livingOthers(paneKey);
    if (others.length > 0) {
      // One mod pane per agent pane: an automatic open never adds a second one, a forced open replaces it.
      if (!isForced) {
        return false;
      }
      await Promise.all(others.map(([key, paneId]) => this.closeOne(key, paneId)));
    }
    if (!isForced && this.autoOpened.has(paneKey)) {
      return known !== undefined && (await HerdrPane.exists(known));
    }
    if (known && (await HerdrPane.exists(known))) {
      return true;
    }
    const paneId = await HerdrPane.open(this.besidePaneId, env);
    if (!paneId) {
      return false;
    }
    this.paneIds.set(paneKey, paneId);
    this.autoOpened.add(paneKey);
    return true;
  }

  private async livingOthers(paneKey: string): Promise<[string, string][]> {
    const others = [...this.paneIds].filter(([key]) => key !== paneKey);
    const alive = await Promise.all(others.map(([, paneId]) => HerdrPane.exists(paneId)));
    return others.filter((_, index) => alive[index]);
  }

  private async closeOne(paneKey: string, paneId: string): Promise<void> {
    await HerdrPane.close(paneId);
    this.paneIds.delete(paneKey);
  }

  async isOpen(paneKey: string): Promise<boolean> {
    const known = this.paneIds.get(paneKey);
    return known !== undefined && (await HerdrPane.exists(known));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.paneIds.values()].map((paneId) => HerdrPane.close(paneId)));
    this.paneIds.clear();
  }
}
