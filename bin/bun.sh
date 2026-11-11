#!/bin/sh
# herdr's server PATH often lacks Bun's install folder, so find bun before running it.
for candidate in "$(command -v bun 2>/dev/null)" "${BUN_INSTALL:-$HOME/.bun}/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done
echo "herdr-mods: bun not found; install it from https://bun.sh" >&2
exit 127
