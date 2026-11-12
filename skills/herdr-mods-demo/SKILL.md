---
name: herdr-mods-demo
description: >
  Record the herdr-mods demo GIF: a Claude Code mod running unchanged in a herdr pane, with made-up
  data only. Use when the README GIF needs to be made or refreshed after a change to the pane, the
  Claude mod runtime or the demo mod. Triggers: "record the herdr-mods demo", "update the demo gif",
  "make a gif of the mod pane".
allowed-tools: Bash, Read
---

# herdr-mods-demo

Records `demo/demo.gif`. It shows the Claude Code mod source (left) and the herdr pane that runs
the same mod (right). No real data is read or shown.

## Rules

- Never record a real opencode or Claude session. The recording uses `demo/driver.ts`, which feeds
  made-up turns to the mod through the real runtime.
- `demo/stage.sh` sets `HOME` to a new temp folder, so the state files, build cache and error log
  of the user stay untouched.
- Do not add a real repo name, path, branch, ticket or answer text to `demo/`.

## Needs

`vhs` (with `ttyd` and `ffmpeg`), `tmux`, `bun`.

## Steps

1. Run `bun test` and `bunx tsc --noEmit -p .` from the repo root. Stop if they fail.
2. Run `vhs demo/demo.tape` from the repo root. It writes `demo/demo.gif` (about 17 seconds).
3. Look at it before you keep it. Extract frames, then read two of them:
   `ffmpeg -v error -y -i demo/demo.gif -vf "fps=1,scale=900:-1" "$TMPDIR/g%02d.png"`
   - The right pane must show `Session summary` and `✓` lines. A lone `…` means the pane did not
     get a frame: run `DEMO_DETACH=1 sh demo/stage.sh`, wait 9 seconds, then
     `tmux capture-pane -p -t demo.1`.
   - The pane title must read `summaries Mod`, and the top right must show `x`.
   - No text outside the made-up demo text.
4. Clean up: `tmux kill-server; pkill -f demo/driver.ts`.
5. Keep the GIF under about 500 KB. The README embeds it.

## Change the scenario

Edit `script` in `demo/driver.ts` (the made-up turns, `ses_sub` is a sub-agent) or
`demo/claude-mod/hooks/register.tsx` (the mod). Edit timings in `demo/demo.tape`.
