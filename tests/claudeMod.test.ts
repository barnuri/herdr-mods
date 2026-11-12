import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeModLoader } from '../src/claude/claudeModLoader.ts';
import { ClaudeModRuntime } from '../src/claude/claudeModRuntime.ts';
import { FrameCodec } from '../src/claude/frameCodec.ts';
import type { EncodedFrame } from '../src/claude/frameCodec.ts';
import type { ModHostApi } from '../src/modApi.ts';
import { TermRenderer } from '../src/render/termRenderer.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'hello-claude-mod');
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

const fakeHost = () => {
  const listeners = new Map<string, (event: { data: { sessionID: string } }) => void>();
  const published: { key: string; state: { frame: EncodedFrame } }[] = [];
  const opened: string[] = [];
  const messageHandlers = new Map<string, (message: unknown) => void>();
  const messages = [
    { id: 'u1', type: 'user', text: 'hi', time: { created: 1000 } },
    { type: 'assistant', content: [{ type: 'tool', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'a' }] } }, { type: 'text', text: 'done' }], time: { created: 1500, completed: 2000 }, finish: 'stop' },
  ];
  const api: ModHostApi = {
    options: {},
    opencode: {
      data: {
        on: (type: string, handler: (event: { data: { sessionID: string } }) => void) => {
          listeners.set(type, handler);
          return () => undefined;
        },
        session: { message: { list: () => messages, sync: async () => undefined } },
      },
    },
    directory: () => '/repo',
    currentSessionId: () => 'ses_1',
    publish: async (key, state) => {
      published.push({ key, state: state as { frame: EncodedFrame } });
    },
    openPane: async (key) => {
      opened.push(key);
      return true;
    },
    isPaneOpen: async () => true,
    toast: () => undefined,
    logError: async (message) => {
      throw new Error(message);
    },
    onMessage: (key, handler) => {
      messageHandlers.set(key, handler);
      return () => undefined;
    },
  };
  return { api, listeners, published, opened, messageHandlers };
};

const lastFrameText = (published: { state: { frame: EncodedFrame } }[]) =>
  new TermRenderer(60, () => undefined).render(FrameCodec.decode(published.at(-1)?.state.frame ?? null, () => undefined)).lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));

describe('Claude Code mod runtime', () => {
  it('loads an unchanged Claude mod, runs its turn hook, and renders its Pane with a working button', async () => {
    const loader = new ClaudeModLoader(mkdtempSync(join(tmpdir(), 'herdr-mods-claude-')));
    const mod = await ClaudeModRuntime.definition(FIXTURE, loader);
    const host = fakeHost();
    await mod.setup?.(host.api);

    host.listeners.get('session.execution.succeeded')?.({ data: { sessionID: 'ses_1' } });
    await settle();

    expect(mod.id).toBe('claude-hello');
    expect(host.opened).toContain('hello');
    expect(lastFrameText(host.published)).toEqual(['turns: done', 'clicked 0']);

    host.messageHandlers.get('hello')?.({ action: 1 });
    await settle();

    expect(lastFrameText(host.published)).toEqual(['turns: done', 'clicked 1']);
  });

  it('turns registered Claude commands into host commands with the userConfig defaults', async () => {
    const loader = new ClaudeModLoader(mkdtempSync(join(tmpdir(), 'herdr-mods-claude-')));
    const mod = await ClaudeModRuntime.definition(FIXTURE, loader);
    const host = fakeHost();
    await mod.setup?.(host.api);

    const [command] = mod.commands?.() ?? [];

    expect(command?.name).toBe('hello');
    expect(await command?.run('world', host.api)).toBe('hello world');
  });
});
