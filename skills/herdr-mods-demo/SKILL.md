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
   - The pane title must read `summaries mod`, and the top right must show `x`.
   - No text outside the made-up demo text.
4. Clean up: `tmux kill-server; pkill -f demo/driver.ts`.
5. Keep the GIF under about 500 KB. The README embeds it.

## orch-graph demo (mock data)

A second demo shows the orch-graph mod (from the orch-skill repo) drawing a made-up orch run. It
needs `ORCH_SKILL_DIR` set to the orch-skill checkout. Never put that path in `demo/` or the README.

1. Run `ORCH_SKILL_DIR=<orch-skill> bun demo/orch-graph/publish.ts` to check the mock converts. It
   must print a path under a temp `HOME`.
2. Run `ORCH_SKILL_DIR=<orch-skill> vhs demo/orch-graph.tape`. It writes `demo/orch-graph.gif`.
3. Look at two frames, as above. The right pane must show `Release notes rollout`, the stage graph
   with `✓`, `●` and `✗` nodes, and the top right `x`. The pane must be wide enough that the graph
   is not cut off; `demo/orch-graph/stage.sh` uses 96 columns.
4. Clean up: `tmux kill-server; pkill -f demo/driver.ts`.
5. Edit made-up data only in `demo/orch-graph/mock/`. Do not press `o` or `r` in the tape: they start
   the real dashboard or run a real retry.

## Change the scenario

Edit `script` in `demo/driver.ts` (the made-up turns, `ses_sub` is a sub-agent) or
`demo/claude-mod/hooks/register.tsx` (the mod). Edit timings in `demo/demo.tape`.
