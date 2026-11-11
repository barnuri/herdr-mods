# herdr-mods

Mods for [opencode](https://opencode.ai), in [herdr](https://herdr.dev) panes. A mod puts a live
pane beside the coding agent, with buttons, links and hotkeys. It works like a Claude Code mod
pane, but it runs in its own terminal process, so it can draw anything a terminal can.

- **Smart placement.** When the opencode pane is at least 140 columns wide, the mod pane opens on
  the right. When it is narrower (a phone or a small split), the mod pane opens below.
- **Pane lifecycle.** A mod pane opens by itself once. After you close it, it stays closed until
  you run the mod's command. Each pane exits when its opencode window exits.
- **Claude Code mod views.** A pane view can return the same `Box` / `Text` / `Button` / `Link`
  tree a Claude Code mod builds, in classic JSX (`h`) or plain objects. herdr-mods draws it in the
  terminal. Buttons answer mouse clicks and their `hotkey`, and links open with the OS opener.

## Install

herdr-mods is a herdr plugin (`barnuri.mods`). Install it from the herdr marketplace (the repo
carries the `herdr-plugin` topic):

```bash
herdr plugin install barnuri/herdr-mods
```

Or link a local checkout for development:

```bash
git clone https://github.com/barnuri/herdr-mods
herdr plugin link ./herdr-mods
```

It needs [Bun](https://bun.sh) (`bin/bun.sh` finds it even when herdr's `PATH` lacks it) and opencode 2.

Then add the opencode host to `~/.config/opencode/cli.json`, with the mods to load:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/herdr-mods",
      "options": {
        "mods": [
          "/absolute/path/to/a/mod.ts",
          { "path": "/absolute/path/to/another/mod.ts", "options": { "showFilePaths": true } }
        ]
      }
    }
  ]
}
```

Start opencode inside a herdr pane. Mod panes are herdr plugin panes (`herdr plugin pane open
--plugin barnuri.mods --entrypoint mod`): herdr owns them, and they close when their opencode
window closes. Outside herdr, the mods load but open no panes.

## Write a mod

A mod is two modules. The first one runs inside opencode, and its default export is a `HerdrMod`
(`src/modApi.ts`):

```ts
import { join } from 'node:path';

export default {
  id: 'hello',
  pane: { module: join(import.meta.dir, 'view.ts') },
  command: {
    name: 'hello',
    description: 'Open the hello pane',
    run: async (args, api) => {
      await api.publish('main', { greeting: args || 'hello' });
      await api.openPane('main', { isForced: true });
    },
  },
  setup(api) {
    void api.publish('main', { greeting: 'hello' });
  },
};
```

- `setup(api)` runs once when opencode starts. `api.opencode` is opencode's TUI plugin context, so a
  mod can follow session events (`api.opencode.data.on(...)`) and read messages.
- `api.publish(key, state)` saves JSON state for the pane named `key`.
- `api.openPane(key)` opens that pane beside opencode. A mod calls it when it has something to show.
  It opens once by itself. `isForced` reopens a closed pane.
- `command` becomes a slash command. A string it returns shows as a toast.

The second module is the view. It runs in the herdr pane. Its default export draws the last state:

```ts
export default function view(state, ui) {
  const { Box, Text, Button } = ui.elements;
  const [count, setCount] = ui.local('count', 0);
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, color: '#D77757' }, state?.greeting ?? 'waiting'),
    h(Button, { hotkey: 'c', onPress: () => setCount(count + 1) }, h(Text, { underline: true }, `clicked ${count}`)),
  );
}
```

`ui` gives the pane size (`columns`, `rows`), pane-local state (`local`), `open(url or file)`,
`notice(message)`, `redraw()` and `close()`. The view module loads only in the pane process, so it
can import a Claude Code mod's `.tsx` views directly.

### Elements

| Element | Props |
|---|---|
| `Box` | `flexDirection` (`row` or `column`), `columnGap`, `flexWrap`, `paddingLeft`, `paddingRight`, `marginTop`, `minHeight`, `flexGrow` |
| `Text` | `color` (hex or name), `bold`, `dimColor`, `underline`, `wrap` (`wrap`, else truncate) |
| `Button` | `onPress`, `hotkey` |
| `Link` | `href` |

## Mods

- **summarize** ([harness-status-line](https://github.com/barnuri/harness-status-line),
  `opencode-summarize/mod.ts`): a recap of every turn, with session repos, PRs, commits, skills and
  the session Q&A. It reuses the Claude Code mod's own view and buttons.
- **orch-graph** ([orch-skill](https://github.com/barnuri/orch-skill), `mods/orch-graph/opencode/mod.ts`):
  the live DAG of the active orch run, with "open in dashboard" and "retry failed nodes".

## Files

| Path | What it is |
|---|---|
| `herdr-plugin.toml` | the herdr plugin manifest: the `mod` pane entrypoint and the build step |
| `bin/bun.sh` | runs Bun for herdr, whose `PATH` may not include it |
| `tui.ts` | the opencode TUI plugin entry |
| `src/modApi.ts` | the mod contract |
| `src/opencode/opencodeHost.ts` | loads mods, runs `setup`, registers commands, opens panes |
| `src/herdr/herdrPane.ts`, `src/herdr/paneLifecycle.ts` | herdr plugin pane calls, placement (right when 140+ columns, else below), open-once and reopen |
| `src/state/stateStore.ts` | state files in `~/.cache/herdr-mods/<mod>/<key>.json`, errors in `~/.cache/herdr-mods/errors.jsonl` |
| `bin/pane.ts`, `src/pane/paneRunner.ts` | the pane process: loads a view, draws it, routes clicks and keys |
| `src/render/termRenderer.ts` | draws a view tree as terminal lines with click regions |

## Develop

```sh
bun test
bunx tsc --noEmit -p .
```

## License

MIT
