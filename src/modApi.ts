/**
 * The contract between herdr-mods and a mod. A mod is a module whose default export is a `HerdrMod`;
 * its `setup` and `command` run inside opencode. Its view is a second module (`pane.module`) whose
 * default export is a `ModPaneView`; only the herdr pane process loads it, so it may use classic JSX.
 */

/** Element names a pane view builds its tree from, the same set Claude Code mods use. */
export interface ModElements {
  readonly Box: string;
  readonly Text: string;
  readonly Button: string;
  readonly Link: string;
}

export interface ModCommand {
  /** The slash command name, without the `/`. */
  readonly name: string;
  readonly description: string;
  /** Runs on `/<name> <args>`; a returned string shows as a toast. */
  readonly run: (args: string, api: ModHostApi) => Promise<string | void> | string | void;
}

/** What a mod gets inside opencode. */
export interface ModHostApi {
  /** This mod's options from the host config. */
  readonly options: Readonly<Record<string, unknown>>;
  /** opencode's TUI plugin context (`data`, `ui`, `client`, ...), as opencode passes it. */
  readonly opencode: unknown;
  /** The working folder of the opencode session. */
  directory(): string;
  /** The session the TUI shows, when it shows one. */
  currentSessionId(): string | undefined;
  /** Saves the state the pane for `key` renders. JSON only. */
  publish(key: string, state: unknown): Promise<void>;
  /**
   * Opens the herdr pane for `key` beside opencode. Without `isForced` it opens at most once and
   * stays closed after the person closes it; `isForced` reopens it. Returns whether a pane is open.
   */
  openPane(key: string, options?: { readonly isForced?: boolean }): Promise<boolean>;
  toast(message: string): void;
  /** Appends an error to `~/.cache/herdr-mods/errors.jsonl`; never shown in the TUI. */
  logError(message: string): Promise<void>;
}

/** What a mod's view gets inside its herdr pane. */
export interface ModPaneUi {
  readonly elements: ModElements;
  readonly columns: number;
  readonly rows: number;
  /** The `key` the pane was opened for. */
  readonly key: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** Pane-local state that survives redraws: the current value and a setter that redraws. */
  local<Value>(name: string, initial: Value): readonly [Value, (next: Value) => void];
  /** Opens a URL or a file with the OS default app. */
  open(target: string): void;
  /** Shows a one-line notice at the bottom of the pane. */
  notice(message: string): void;
  redraw(): void;
  /** Closes the pane. */
  close(): void;
}

export interface HerdrMod<State = unknown> {
  readonly id: string;
  readonly command?: ModCommand;
  /** Runs once when opencode starts; returns a cleanup. */
  readonly setup?: (api: ModHostApi) => (() => void) | void;
  readonly pane: {
    /** Absolute path of the view module. */
    readonly module: string;
  };
}

/** A pane view: builds the tree to draw from the last published state (null before the first publish). */
export type ModPaneView<State = unknown> = (state: State | null, ui: ModPaneUi) => unknown;
