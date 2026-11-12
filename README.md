# herdr-mods

Mods for [opencode](https://opencode.ai) and Claude Code, in [herdr](https://herdr.dev) panes. A mod
puts a live pane beside your coding agent, with buttons, links and hotkeys, like a Claude Code mod
pane. Because it runs in its own terminal process, it can draw anything a terminal can.

- **Runs Claude Code mods unchanged.** Drop an existing Claude Code mod folder into the mods folder
  and it runs inside opencode. Its `on(...)` hooks, `$` engine, atoms, commands and `Pane` view all
  work, and the pane opens in herdr. See [Claude Code mods](#claude-code-mods).
- **Native mods are easy to write.** `bun bin/new.ts <name>` scaffolds one, and any folder in
  `~/.config/herdr-mods/mods` is loaded. No config needed.
- **Smart placement.** When the agent pane is at least 140 columns wide, the mod pane opens on the
  right. When it is narrower (a phone or a small split), the mod pane opens below. The agent keeps
  about two thirds of the space.
- **herdr-owned panes.** Panes open through `herdr plugin pane open`. A pane opens by itself once.
  After you close it, it stays closed until you run the mod's command.

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

It needs [Bun](https://bun.sh). `bin/bun.sh` finds Bun even when herdr's `PATH` doesn't include it.

### opencode

Add the plugin folder to `~/.config/opencode/cli.json`:

```json
{ "plugins": ["/absolute/path/to/herdr-mods"] }
```

Optional settings go in the object form: `mods` lists extra mod paths, and `modOptions` sets options
per mod id.

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/herdr-mods",
      "options": {
        "mods": ["/somewhere/else/mod.ts"],
        "modOptions": { "claude-summarize": { "showFilePaths": true } }
      }
    }
  ]
}
```

Start opencode inside a herdr pane. Outside herdr, the mods load but open no panes.

### Claude Code

A Claude Code mod can open its pane in herdr instead of the Claude pane. It writes its state to
`~/.cache/herdr-mods/<mod id>/<key>.json`, then runs the `open` CLI (see
[Open a pane from any harness](#open-a-pane-from-any-harness)). The
[summarize](https://github.com/barnuri/harness-status-line) and
[orch-graph](https://github.com/barnuri/orch-skill) Claude mods do this. Each finds herdr-mods
through `herdr plugin list --json`.

## The mods folder

Every sub-folder of `~/.config/herdr-mods/mods` (or `$HERDR_MODS_DIR`) is a mod:

- a folder with `mod.ts` is a herdr mod;
- a folder with `.claude-plugin/plugin.json` and `hooks/hooks.json` is a Claude Code mod.

Register a mod by creating its folder there, or by symlinking an existing one:

```bash
ln -s ~/code/my-claude-mod ~/.config/herdr-mods/mods/my-claude-mod
```

Restart opencode to load new mods.

## Write a mod

Create a working mod in the mods folder:

```bash
bun bin/new.ts hello      # creates ~/.config/herdr-mods/mods/hello/{mod.ts,view.ts}
```

Restart opencode and run `/hello`. A mod is two modules.

`mod.ts` runs inside opencode. Its default export is a `HerdrMod` (`src/modApi.ts`):

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
    api.onMessage('main', (message) => api.toast(`pane says ${JSON.stringify(message)}`));
  },
};
```

| `api` member | What it does |
|---|---|
| `opencode` | opencode's TUI plugin context. Use it for session events (`data.on(...)`) and messages |
| `publish(key, state)` | Saves JSON state for the pane named `key` |
| `openPane(key, { isForced? })` | Opens that pane beside the agent. It opens once by itself; `isForced` reopens a closed pane |
| `isPaneOpen(key)` | Whether that pane is open now |
| `onMessage(key, handler)` | Receives what the pane sends with `ui.send` |
| `toast`, `logError`, `directory`, `currentSessionId`, `options` | The usual helpers |

`command` (or `commands()`, for a list) becomes a slash command. A string it returns shows as a
toast. `setup` may be async; the host waits for it before it registers commands.

`view.ts` runs in the herdr pane. Its default export draws the last published state:

```ts
const node = (type, props, ...children) => ({ type, props, children });

export default function view(state, ui) {
  const { Box, Text, Button } = ui.elements;
  const [count, setCount] = ui.local('count', 0);
  return node(Box, { flexDirection: 'column' },
    node(Text, { bold: true, color: '#D77757' }, state?.greeting ?? 'waiting'),
    node(Button, { hotkey: 'c', onPress: () => { setCount(count + 1); ui.send({ clicked: count + 1 }); } },
      node(Text, { underline: true }, `clicked ${count}`)),
  );
}
```

A view can also be classic JSX: `.tsx` files in the pane process compile with an `h` factory.

| `ui` member | What it does |
|---|---|
| `elements` | `Box`, `Text`, `Button`, `Link` |
| `columns`, `rows` | The pane size |
| `local(name, initial)` | Pane-local state: the value and a setter that redraws |
| `send(message)` | Sends JSON to the mod inside opencode |
| `open(target)`, `notice(message)`, `redraw()`, `close()` | Open a URL or file, show a notice line, redraw, close |

### Elements

| Element | Props |
|---|---|
| `Box` | `flexDirection` (`row` or `column`), `columnGap`, `flexWrap`, `paddingLeft`, `paddingRight`, `marginTop`, `minHeight`, `flexGrow` |
| `Text` | `color` (hex or name), `bold`, `dimColor`, `underline`, `wrap` (`wrap`, else truncate) |
| `Button` | `onPress`, `hotkey` (a click or the key presses it) |
| `Link` | `href` (opens with the OS opener) |

## Claude Code mods

herdr-mods runs an unchanged Claude Code mod inside opencode:

1. The loader compiles the mod's `.ts` and `.tsx` files to plain JS in
   `~/.cache/herdr-mods/claude-build/`. Classic JSX compiles to a private factory, and
   `import ... from 'claude-code'` points at herdr-mods' own `atom` / `read` / `update`.
2. The runtime calls each module's `register(on, options)`. The options are the mod's
   `userConfig` defaults, merged with `modOptions["claude-<name>"]`.
3. opencode events become the mod's events, and `$` is a herdr-mods engine.
4. `$.ui.open` renders the mod's `Pane` inside opencode. The frame goes to a herdr pane, and
   button presses and the pane size come back to the mod.

The mod id is `claude-<name>`, where `<name>` comes from its `plugin.json`.

| Claude Code mod API | Support |
|---|---|
| `session.start` | Once, when opencode starts |
| `turn.start` | When a turn starts, with the prompt text |
| `skill.prompt` | For each skill attached to the prompt |
| `tool.call` | Each finished tool call, after the turn ends. Tool names are Claude's (`Bash`, `Edit`, `Write`, `Skill`, `Agent`, ...), and `next(e)` returns the real result. A mod can observe a call, but cannot deny or change it |
| `turn.complete` | With `answer`, `durationMs`, `reason` and `usage.output_tokens` |
| `command.run` | From the slash commands the mod registers with `$.command.register`. The first line of the returned `text` shows as a toast |
| `ui.render` (`Pane`) | Renders into a herdr pane, with `bodyColumns` and `scroll.bodyRows` from the pane size |
| `ui.close` | When the person closes the pane |
| `ui.render` (`AbovePrompt`, bands) | Not supported (opencode has no slot for it here) |
| `$.ui.open`, `$.ui.resolve`, `$.ui.toast`, `$.ui.log` | Supported |
| `$.command.register` | Supported |
| `$.fs.exists`, `read`, `write`, `list` | Supported |
| `$.process.run` (`cwd`, `env`, `timeoutMs`) | Supported |
| `$.clock.now`, `$.clock.every` | Supported |
| `$.env.get` | Supported. It hides `HERDR_ENV` and `HERDR_PANE_ID`, so a mod with its own herdr path uses its Claude pane, which is the herdr pane here |
| `$.session.id`, `$.session.cwd`, `$.plugin.root` | Supported |
| `atom`, `read`, `update` from `claude-code` | Supported, per mod, in memory |
| `claude-code/testing` | Not supported (test Claude mods with Claude's own runner) |

## Open a pane from any harness

`bin/open.ts` opens a mod pane beside any herdr pane. A harness without the opencode host can use
it, a Claude Code mod for example:

```bash
# write ~/.cache/herdr-mods/<mod id>/<key>.json first
sh <herdr-mods>/bin/bun.sh <herdr-mods>/bin/open.ts \
  --mod-id summarize --view /path/to/view.ts --key <session id> --beside "$HERDR_PANE_ID" [--force]
# prints {"open": true}
```

It keeps the same lifecycle between runs, per agent pane: a pane opens once by itself, and stays
closed after the person closes it until `--force`.

## Mods

- **summarize** ([harness-status-line](https://github.com/barnuri/harness-status-line)): a recap of
  every turn, with session repos, PRs, commits, skills and the session Q&A. It comes as a herdr mod
  (`opencode-summarize/`) and as a Claude Code mod (`claude-mods/summarize`).
- **orch-graph** ([orch-skill](https://github.com/barnuri/orch-skill)): the live DAG of the active
  orch run, with "open in dashboard" and "retry failed nodes".

## Files

| Path | What it is |
|---|---|
| `herdr-plugin.toml` | The herdr plugin manifest: the `mod` pane entrypoint and the build step |
| `tui.ts` | The opencode TUI plugin entry |
| `src/modApi.ts` | The mod contract |
| `src/opencode/opencodeHost.ts` | Loads mods, runs `setup`, registers commands, opens panes |
| `src/mods/modFolder.ts` | The mods folder |
| `src/claude/` | Claude Code mod support: the loader, the `claude-code` shim, the runtime, and the frame bridge |
| `src/herdr/` | herdr plugin pane calls, placement, and the pane lifecycle |
| `src/state/` | State files, pane messages, and the error log (`~/.cache/herdr-mods/errors.jsonl`) |
| `src/pane/paneRunner.ts`, `bin/pane.ts` | The pane process: loads a view, draws it, routes clicks and keys |
| `src/render/termRenderer.ts` | Draws a view tree as terminal lines with click regions |
| `bin/new.ts`, `bin/open.ts`, `bin/bun.sh` | Scaffold a mod, open a pane from any harness, find Bun |

## Develop

```sh
bun test
bunx tsc --noEmit -p .
```

## License

MIT
