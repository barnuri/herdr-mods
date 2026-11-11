# herdr-mods

Host for opencode mods that render in herdr panes. Public repo: never commit secrets, internal
hostnames, or personal paths.

- The mod contract is `src/modApi.ts`. A change to it is a breaking change for every mod: keep it
  backward compatible, and update the README's "Write a mod" section in the same change.
- Code that runs inside opencode (`tui.ts`, `src/opencode/`) must never throw into the TUI and must
  never block a render. Run git, herdr and network calls async, with a timeout.
- The pane process (`bin/pane.ts`) is the only place that loads mod view modules.
- Errors go to `~/.cache/herdr-mods/errors.jsonl` (`StateStore.logError`), never to the TUI.

## Checks

```sh
bun test
bunx tsc --noEmit -p .
```
