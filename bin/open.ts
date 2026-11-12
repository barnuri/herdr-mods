import { HerdrPane } from '../src/herdr/herdrPane.ts';
import { PaneLifecycle } from '../src/herdr/paneLifecycle.ts';
import type { PaneLifecycleSnapshot } from '../src/herdr/paneLifecycle.ts';
import { StateStore } from '../src/state/stateStore.ts';

// Opens a mod pane beside the calling agent pane, for harnesses without the opencode host (for
// example a Claude Code mod). The caller writes the state to ~/.cache/herdr-mods/<mod-id>/<key>.json
// first. Prints {"open": true|false}. The lifecycle (open once, stay closed after the person closes
// it, --force reopens) is kept per agent pane between runs.
const LIFECYCLE_MOD = '_panes';

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
const store = new StateStore();
const saved = (await store.read(store.pathFor(LIFECYCLE_MOD, besidePaneId))) as PaneLifecycleSnapshot | null;
const lifecycle = new PaneLifecycle(besidePaneId, saved ?? undefined);
const isOpen = await lifecycle.open(
  `${modId}:${key}`,
  {
    HERDR_MODS_MOD_ID: modId,
    HERDR_MODS_VIEW: view,
    HERDR_MODS_KEY: key,
    HERDR_MODS_OPTIONS: argument('--options') ?? '{}',
    HERDR_MODS_PARENT_PID: argument('--parent-pid') ?? '0',
  },
  process.argv.includes('--force'),
);
await store.write(LIFECYCLE_MOD, besidePaneId, lifecycle.snapshot());
console.log(JSON.stringify({ open: isOpen }));
