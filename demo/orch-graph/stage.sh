#!/bin/sh
# Builds the orch-graph demo in tmux: the mock orch run on the left, the orch-graph pane on the right.
# Needs ORCH_SKILL_DIR, the orch skill checkout that owns the orch-graph mod.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${ORCH_SKILL_DIR:?set ORCH_SKILL_DIR to the orch skill checkout}"
export HOME="$(mktemp -d)"
export ORCH_SKILL_DIR
bun "$ROOT/demo/orch-graph/publish.ts" >/dev/null
tmux kill-session -t demo 2>/dev/null || true
tmux new-session -d -s demo -x 150 -y 32 "clear; printf '\033[1m Orch run, mock data\033[0m\n\n'; cat '$ROOT/demo/orch-graph/mock/runs/demo-run/state.json'; sleep 600"
tmux set -t demo status off
tmux set -t demo pane-border-status top
tmux set -t demo pane-border-format ' #{pane_title} '
tmux select-pane -t demo -T 'orch run (mock data)'
tmux split-window -h -t demo -l 96 "HERDR_MODS_MOD_ID=orch-graph HERDR_MODS_VIEW='$ORCH_SKILL_DIR/mods/orch-graph/opencode/view.ts' HERDR_MODS_KEY=run bun '$ROOT/bin/pane.ts'"
tmux select-pane -t demo.1 -T 'orch-graph mod'
[ -n "$DEMO_DETACH" ] || tmux attach -t demo
