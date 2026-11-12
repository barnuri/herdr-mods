// Turns the mock orch run in demo/orch-graph/mock into the state the orch-graph pane draws. It uses the
// orch-graph mod's own toRunView, from the orch skill checkout named by ORCH_SKILL_DIR, and writes
// the same file the mod writes, under $HOME. No real run is read.
//
//   ORCH_SKILL_DIR=/path/to/orch-skill bun demo/orch-graph/publish.ts
import { join } from 'node:path';

const skill = process.env['ORCH_SKILL_DIR'];
if (!skill) throw new Error('set ORCH_SKILL_DIR to the orch skill checkout');
const { toRunView } = await import(join(skill, 'mods', 'orch-graph', 'hooks', 'graph.ts'));

const mock = join(import.meta.dir, 'mock');
const profiles = JSON.parse(await Bun.file(join(mock, 'profiles.json')).text());
const raw = JSON.parse(await Bun.file(join(mock, 'runs', 'demo-run', 'state.json')).text());
const run = toRunView(
  raw,
  Object.fromEntries(Object.entries(profiles.profiles).map(([name, spec]: [string, any]) => [name, { harness: spec.harness, model: spec.model }])),
  profiles.settings.max_attempts,
  // A fixed clock, so the picture does not change between recordings.
  new Date(raw.started).getTime() + 754_000,
);

const target = join(process.env['HOME'] ?? '', '.cache', 'herdr-mods', 'orch-graph', 'run.json');
await Bun.write(target, JSON.stringify({ view: { run, error: null, dashboard: null }, pinned: '' }));
console.log(target);
