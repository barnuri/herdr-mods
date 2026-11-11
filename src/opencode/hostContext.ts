/** A configured mod: the module path, or the path with options for that mod. */
export type ModEntry = string | { readonly path: string; readonly options?: Readonly<Record<string, unknown>> };

interface HostCommand {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly description: string;
  readonly palette: true;
  readonly slash: { readonly name: string; readonly arguments: true };
  readonly run: (input?: string) => void;
}

/** The narrow slice of opencode 2's TUI plugin `Context` the host uses. */
export interface HostContext {
  readonly options?: Readonly<Record<string, unknown>>;
  readonly data: {
    readonly location: { default(): { readonly directory: string } | undefined };
  };
  readonly keymap: { layer(factory: () => { readonly mode: 'global'; readonly commands: readonly HostCommand[] }): void };
  readonly ui: {
    readonly slot: (claim: { readonly append: 'app'; readonly render: () => null }) => () => void;
    readonly router: { current(): { readonly type: string; readonly sessionID?: string } };
    readonly toast: { show(toast: { readonly title?: string; readonly message: string; readonly variant: 'info' }): void };
  };
}
