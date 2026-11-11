import { HerdrPane } from './herdrPane.ts';

/**
 * The herdr panes of one opencode window, one per mod and key. A pane opens by itself at most once;
 * after the person closes it, only a forced open (the mod's command) brings it back.
 */
export class PaneLifecycle {
  private readonly paneIds = new Map<string, string>();
  private readonly autoOpened = new Set<string>();

  constructor(
    private readonly besidePaneId: string,
    private readonly cwdOf: () => string,
  ) {}

  async open(paneKey: string, command: string, isForced: boolean): Promise<boolean> {
    const known = this.paneIds.get(paneKey);
    if (!isForced && this.autoOpened.has(paneKey)) {
      return known !== undefined && (await HerdrPane.exists(known));
    }
    this.autoOpened.add(paneKey);
    if (known && (await HerdrPane.exists(known))) {
      return true;
    }
    const paneId = await HerdrPane.open(this.besidePaneId, this.cwdOf(), command);
    if (paneId) {
      this.paneIds.set(paneKey, paneId);
    }
    return paneId !== null;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.paneIds.values()].map((paneId) => HerdrPane.close(paneId)));
    this.paneIds.clear();
  }
}
