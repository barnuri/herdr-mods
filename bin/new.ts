import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModFolder } from '../src/mods/modFolder.ts';

// `bun bin/new.ts <name>`: creates a working herdr mod in the mods folder, ready to edit. The opencode
// host loads it the next time opencode starts; `/<name>` opens its pane.
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: bun bin/new.ts <name>   (lowercase letters, digits and dashes)');
  process.exit(1);
}
const folder = join(new ModFolder().path, name);
if (existsSync(folder)) {
  console.error(`herdr-mods: ${folder} already exists`);
  process.exit(1);
}
await mkdir(folder, { recursive: true });
await writeFile(
  join(folder, 'mod.ts'),
  `import { join } from 'node:path';

// Runs inside opencode. Publish state for the pane, and open the pane when there is something to show.
export default {
  id: '${name}',
  pane: { module: join(import.meta.dir, 'view.ts') },
  command: {
    name: '${name}',
    description: 'Open the ${name} pane',
    run: async (args: string, api: { publish(key: string, state: unknown): Promise<void>; openPane(key: string, options?: { isForced?: boolean }): Promise<boolean> }) => {
      await api.publish('main', { message: args || 'hello from ${name}', at: new Date().toISOString() });
      await api.openPane('main', { isForced: true });
    },
  },
};
`,
);
await writeFile(
  join(folder, 'view.ts'),
  `// Runs in the herdr pane. Builds the view from the last published state; buttons answer clicks and hotkeys.
type Ui = {
  elements: { Box: string; Text: string; Button: string; Link: string };
  local<Value>(name: string, initial: Value): readonly [Value, (next: Value) => void];
};

const node = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children });

export default function view(state: { message: string; at: string } | null, ui: Ui): unknown {
  const { Box, Text, Button } = ui.elements;
  const [count, setCount] = ui.local('count', 0);
  return node(
    Box,
    { flexDirection: 'column' },
    node(Text, { bold: true, color: '#D77757' }, state?.message ?? 'waiting for /${name}'),
    node(Text, { dimColor: true }, state?.at ?? ''),
    node(Button, { hotkey: 'c', onPress: () => setCount(count + 1) }, node(Text, { underline: true }, \`clicked \${count} (c)\`)),
  );
}
`,
);
console.log(`created ${folder}: edit mod.ts and view.ts, then restart opencode and run /${name}`);
