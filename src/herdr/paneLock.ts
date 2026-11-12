import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A lock held by a process that died is taken over after this long. */
const STALE_MS = 10_000;
const WAIT_MS = 5_000;
const STEP_MS = 50;

/**
 * Runs `work` while holding the lock for one agent pane, across processes (the opencode host and the `open`
 * CLI). Returns null when the lock cannot be taken in time or the lock folder cannot be used; never throws
 * for the lock itself.
 */
export async function withPaneLock<T>(besidePaneId: string, work: () => Promise<T>): Promise<T | null> {
  const root = join(tmpdir(), 'herdr-mods-locks');
  const dir = join(root, besidePaneId.replace(/[^A-Za-z0-9_-]/g, '_'));
  const deadline = Date.now() + WAIT_MS;
  try {
    await mkdir(root, { recursive: true });
    while (!(await take(dir))) {
      if (Date.now() > deadline) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, STEP_MS));
    }
  } catch {
    return null;
  }
  try {
    return await work();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** True when the lock folder was created. A stale one (its holder died) is removed first. */
async function take(dir: string): Promise<boolean> {
  try {
    await mkdir(dir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    const age = Date.now() - (await stat(dir).then((info) => info.mtimeMs, () => Date.now()));
    if (age > STALE_MS) {
      await rm(dir, { recursive: true, force: true });
    }
    return false;
  }
}
