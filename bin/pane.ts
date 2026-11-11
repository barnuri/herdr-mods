import { TermRenderer } from '../src/render/termRenderer.ts';
import { PaneRunner } from '../src/pane/paneRunner.ts';
import { StateStore } from '../src/state/stateStore.ts';
import type { ModPaneView } from '../src/modApi.ts';

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

const modId = argument('--mod-id');
const viewPath = argument('--view');
const key = argument('--key');
if (!modId || !viewPath || !key) {
  console.error('usage: bun bin/pane.ts --mod-id <id> --view <view module> --key <state key> [--options <json>] [--parent-pid <pid>]');
  process.exit(1);
}
const store = new StateStore();
const fail = async (error: unknown): Promise<never> => {
  await store.logError(modId, `pane failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
};
process.on('uncaughtException', (error) => void fail(error));
process.on('unhandledRejection', (error) => void fail(error));
try {
  const view = (await import(viewPath)).default as ModPaneView;
  const options = JSON.parse(argument('--options') ?? '{}') as Record<string, unknown>;
  await new PaneRunner(modId, view, key, options, Number(argument('--parent-pid') ?? 0)).run();
} catch (error) {
  await fail(error);
}
