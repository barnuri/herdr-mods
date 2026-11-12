import { TermRenderer } from '../src/render/termRenderer.ts';
import { PaneRunner } from '../src/pane/paneRunner.ts';
import { PANEL_MOD } from '../src/state/panelState.ts';
import type { PanelRecord } from '../src/state/panelState.ts';
import { StateStore } from '../src/state/stateStore.ts';

// Mod views may be classic JSX (`h`, `Fragment`), as Claude Code mods are; every .tsx outside
// node_modules is compiled with that factory, and `h` builds the tree TermRenderer draws.
const globals = globalThis as Record<string, unknown>;
globals['h'] = TermRenderer.h;
globals['Fragment'] = TermRenderer.Fragment;
const transpiler = new Bun.Transpiler({
  loader: 'tsx',
  tsconfig: { compilerOptions: { jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' } },
});
Bun.plugin({
  name: 'herdr-mods-classic-jsx',
  setup(build) {
    build.onLoad({ filter: /^(?!.*node_modules).*\.tsx$/ }, async (args) => ({
      contents: transpiler.transformSync(await Bun.file(args.path).text()),
      loader: 'js',
    }));
  },
});

// herdr passes the pane parameters as HERDR_MODS_* env vars (`herdr plugin pane open --env`);
// the same values work as flags when the pane runs by hand.
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }
  return process.env[`HERDR_MODS_${name.slice(2).toUpperCase().replaceAll('-', '_')}`];
};

// `--panel <agent pane id>` runs the mod panel the opencode host and the `open` CLI keep as a record: a tab per
// mod. Without it, `--mod-id`, `--view` and `--key` run one mod alone (the demo scripts do this).
const store = new StateStore();
let logId = PANEL_MOD;
const fail = async (error: unknown): Promise<never> => {
  await store.logError(logId, `pane failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
};
process.on('uncaughtException', (error) => void fail(error));
process.on('unhandledRejection', (error) => void fail(error));
try {
  const panel = argument('--panel');
  const modId = argument('--mod-id');
  const viewPath = argument('--view');
  const key = argument('--key');
  let loadRecord: () => Promise<PanelRecord | null>;
  if (panel) {
    loadRecord = async () => (await store.read(store.pathFor(PANEL_MOD, panel))) as PanelRecord | null;
  } else if (modId && viewPath && key) {
    logId = modId;
    const options = JSON.parse(argument('--options') ?? '{}') as Record<string, unknown>;
    const record: PanelRecord = { tabs: [{ modId, key, view: viewPath, options }], focus: null, autoOpened: [] };
    loadRecord = async () => record;
  } else {
    console.error(
      'usage: bun bin/pane.ts --panel <agent pane id> [--parent-pid <pid>]\n' +
        '       bun bin/pane.ts --mod-id <id> --view <view module> --key <state key> [--options <json>] [--parent-pid <pid>]',
    );
    process.exit(1);
  }
  await new PaneRunner(loadRecord, Number(argument('--parent-pid') ?? 0)).run();
} catch (error) {
  await fail(error);
}
