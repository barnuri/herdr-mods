/** A mod's tab in a mod panel: the view that draws it and the key of the state it shows. */
export interface PanelTab {
  readonly modId: string;
  readonly key: string;
  /** Absolute path of the view module. */
  readonly view: string;
  readonly options: Readonly<Record<string, unknown>>;
}

/** The mod panel beside one agent pane. The host writes it and the pane process reads it. */
export interface PanelRecord {
  /** One tab per mod: a mod is active at most once in a panel. */
  readonly tabs: readonly PanelTab[];
  /** The tab a forced open chose. `at` changes on every choice, so the pane follows it once. */
  readonly focus: { readonly modId: string; readonly at: number } | null;
  /** The `<mod>:<key>` panes that opened by themselves. They stay closed after the person closes the panel. */
  readonly autoOpened: readonly string[];
}

/** The state folder for panel records: one file per agent pane. */
export const PANEL_MOD = '_panels';
