// Demo driver: runs the Claude Code mod in demo/claude-mod through herdr-mods' runtime with a fake
// opencode, and feeds it made-up turns. Everything lives under $HOME (the recording points it at a
// temp folder), so no real session data is ever read or shown.
import { join } from 'node:path';
import { ClaudeModRuntime } from '../src/claude/claudeModRuntime.ts';
import { ClaudeModLoader } from '../src/claude/claudeModLoader.ts';
import { MessageWatcher } from '../src/state/messageWatcher.ts';
import { StateStore } from '../src/state/stateStore.ts';
import type { ModHostApi } from '../src/modApi.ts';

const store = new StateStore();
const listeners = new Map<string, (event: { data: { sessionID: string } }) => void>();
const answers = new Map<string, string>();
const parents = new Map<string, string>([['ses_sub', 'ses_main']]);
const messagesOf = (id: string) => [
  { id: `${id}-u`, type: 'user', text: 'demo', time: { created: 1000 } },
  { type: 'assistant', content: [{ type: 'tool', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'ok' }] } }, { type: 'text', text: answers.get(id) ?? '' }], time: { created: 1500, completed: 2000 }, finish: 'stop' },
];
const fire = (type: string, sessionID: string) => listeners.get(type)?.({ data: { sessionID } });
const mod = await ClaudeModRuntime.definition(join(import.meta.dir, 'claude-mod'), new ClaudeModLoader(join(process.env['HOME'] ?? '', 'build')));
const modId = mod.id;
const api: ModHostApi = {
  options: {},
  opencode: {
    data: {
      on: (type: string, handler: (event: { data: { sessionID: string } }) => void) => (listeners.set(type, handler), () => undefined),
      session: { get: (id: string) => ({ parentID: parents.get(id) }), message: { list: (id: string) => messagesOf(id), sync: async () => undefined } },
    },
  },
  directory: () => '/demo',
  currentSessionId: () => 'ses_main',
  publish: (key, state) => store.write(modId, key, state),
  openPane: async () => true,
  isPaneOpen: async () => true,
  toast: () => undefined,
  logError: async (message) => console.error(message),
  onMessage: (key, handler) => MessageWatcher.watch(store, store.inputPathFor(modId, key), handler),
};
await mod.setup?.(api);
const script: [string, string][] = [
  ['ses_main', 'Added the login form'],
  ['ses_sub', ''],
  ['ses_main', 'Fixed the flaky retry test'],
  ['ses_sub', ''],
  ['ses_main', 'Updated the README'],
  ['ses_main', 'Opened the pull request'],
];
await Bun.sleep(3500);
for (const [session, answer] of script) {
  answers.set(session, answer);
  fire('session.execution.started', session);
  await Bun.sleep(300);
  fire('session.execution.succeeded', session);
  await Bun.sleep(1800);
}
await Bun.sleep(600000);
