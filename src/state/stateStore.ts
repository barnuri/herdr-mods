import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/** Mod state handed from opencode to a pane: one JSON file per mod and key, under `~/.cache/herdr-mods`. */
export class StateStore {
  private static readonly DIRECTORY = join('.cache', 'herdr-mods');
  private static readonly ERROR_LOG = 'errors.jsonl';
  private static readonly MAX_ERROR_LINES = 500;
  private static readonly SAFE_PART = /[^A-Za-z0-9._-]/g;

  constructor(private readonly home: string = process.env['HOME'] ?? '') {}

  pathFor(modId: string, key: string): string {
    return join(this.home, StateStore.DIRECTORY, StateStore.safe(modId), `${StateStore.safe(key)}.json`);
  }

  /** Writes through a temp file and a rename, so a pane never reads a half-written file; each write gets its own temp file. */
  async write(modId: string, key: string, state: unknown): Promise<void> {
    const path = this.pathFor(modId, key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state));
    await rename(temp, path);
  }

  /** The messages a pane sends back, one JSON line each, beside its state file. */
  inputPathFor(modId: string, key: string): string {
    return `${this.pathFor(modId, key)}.input.jsonl`;
  }

  async send(path: string, message: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(message)}\n`);
  }

  /** The messages after byte `offset`, and the offset to read from next time. */
  async readMessages(path: string, offset: number): Promise<{ readonly messages: unknown[]; readonly offset: number }> {
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text.length <= offset) {
      return { messages: [], offset: Math.min(offset, text.length) };
    }
    const fresh = text.slice(offset);
    const complete = fresh.slice(0, fresh.lastIndexOf('\n') + 1);
    const messages = complete
      .split('\n')
      .filter((line) => line !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
    return { messages, offset: offset + complete.length };
  }

  async read(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Appends `{ts, mod, error}` to `errors.jsonl`, keeping the newest lines. Never throws. */
  async logError(modId: string, error: string): Promise<void> {
    try {
      const path = join(this.home, StateStore.DIRECTORY, StateStore.ERROR_LOG);
      await mkdir(dirname(path), { recursive: true });
      const previous = await readFile(path, 'utf8').catch(() => '');
      const lines = previous.split('\n').filter((line) => line !== '');
      const line = JSON.stringify({ ts: new Date().toISOString(), mod: modId, error });
      if (lines.length < StateStore.MAX_ERROR_LINES) {
        await appendFile(path, `${line}\n`);
        return;
      }
      await writeFile(path, `${[...lines.slice(-(StateStore.MAX_ERROR_LINES - 1)), line].join('\n')}\n`);
    } catch {
      // Logging must never break a mod.
    }
  }

  private static safe(part: string): string {
    return part.replace(StateStore.SAFE_PART, '-');
  }
}
