import { HerdrPane } from '../src/herdr/herdrPane.ts';
import { PaneLifecycle } from '../src/herdr/paneLifecycle.ts';

// Opens a mod pane beside the calling agent pane, for harnesses without the opencode host (for
// example a Claude Code mod). The caller writes the state to ~/.cache/herdr-mods/<mod-id>/<key>.json
// first. The mod joins the agent pane's mod panel as a tab (one tab per mod). Prints {"open": true|false}.
// A mod opens by itself once per agent pane; after the person closes the panel, --force brings it back.
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const modId = argument('--mod-id');
const view = argument('--view');
const key = argument('--key');
const besidePaneId = argument('--beside') ?? HerdrPane.currentPaneId();
if (!modId || !view || !key || !besidePaneId) {
  console.error('usage: bun bin/open.ts --mod-id <id> --view <view module> --key <state key> [--beside <pane id>] [--options <json>] [--parent-pid <pid>] [--force]');
  process.exit(1);
}
const options = JSON.parse(argument('--options') ?? '{}') as Record<string, unknown>;
const isOpen = await new PaneLifecycle(besidePaneId).open(
  { modId, key, view, options },
  { isForced: process.argv.includes('--force'), parentPid: Number(argument('--parent-pid') ?? 0) },
);
console.log(JSON.stringify({ open: isOpen }));
