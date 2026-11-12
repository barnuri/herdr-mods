#!/bin/sh
# Builds the demo scene in tmux: the Claude Code mod source on the left, the herdr pane on the right.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HOME="$(mktemp -d)"
tmux kill-session -t demo 2>/dev/null || true
tmux new-session -d -s demo -x 150 -y 32 "clear; printf '\033[1m Claude Code mod, unchanged\033[0m\n\n'; cat '$ROOT/demo/claude-mod/hooks/register.tsx'; sleep 600"
tmux set -t demo status off
tmux set -t demo pane-border-status top
tmux set -t demo pane-border-format ' #{pane_title} '
tmux select-pane -t demo -T 'summaries (Claude Code mod)'
tmux split-window -h -t demo -l 52 "HERDR_MODS_MOD_ID=claude-summaries HERDR_MODS_VIEW='$ROOT/src/claude/claudeFrameView.ts' HERDR_MODS_KEY=summary bun '$ROOT/bin/pane.ts'"
tmux select-pane -t demo.1 -T 'summaries mod'
(cd "$ROOT" && HOME="$HOME" nohup bun demo/driver.ts >"$HOME/driver.log" 2>&1 &)
[ -n "$DEMO_DETACH" ] || tmux attach -t demo
