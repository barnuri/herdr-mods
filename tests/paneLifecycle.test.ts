import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { HerdrPane } from '../src/herdr/herdrPane.ts';
import { PaneLifecycle } from '../src/herdr/paneLifecycle.ts';
import { StateStore } from '../src/state/stateStore.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = { HERDR_MODS_MOD_ID: 'm' };

const stubHerdr = (openResults: (string | null)[]) => {
  const live = new Set<string>();
  const open = spyOn(HerdrPane, 'open').mockImplementation(async () => {
    const paneId = openResults.shift() ?? null;
    if (paneId) {
      live.add(paneId);
    }
    return paneId;
  });
  spyOn(HerdrPane, 'exists').mockImplementation(async (paneId: string) => live.has(paneId));
  return { open, live };
};

afterEach(() => {
  (HerdrPane.open as unknown as { mockRestore(): void }).mockRestore?.();
  (HerdrPane.exists as unknown as { mockRestore(): void }).mockRestore?.();
});

describe('PaneLifecycle', () => {
  it('opens a pane by itself once, and keeps it while it lives', async () => {
    const { open } = stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');

    expect(await lifecycle.open('m:k', ENV, false)).toBe(true);
    expect(await lifecycle.open('m:k', ENV, false)).toBe(true);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stays closed after the person closes it, until a forced open', async () => {
    const { open, live } = stubHerdr(['w1:p2', 'w1:p3']);
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('m:k', ENV, false);
    live.delete('w1:p2');

    expect(await lifecycle.open('m:k', ENV, false)).toBe(false);
    expect(await lifecycle.open('m:k', ENV, true)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('retries the auto-open after a failed first open', async () => {
    const { open } = stubHerdr([null, 'w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');

    expect(await lifecycle.open('m:k', ENV, false)).toBe(false);
    expect(await lifecycle.open('m:k', ENV, false)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('PaneLifecycle snapshot', () => {
  it('keeps the dismissal across instances, as the open CLI needs', async () => {
    const { open, live } = stubHerdr(['w1:p2']);
    const first = new PaneLifecycle('w1:p1');
    await first.open('m:k', ENV, false);
    live.delete('w1:p2');

    const second = new PaneLifecycle('w1:p1', first.snapshot());

    expect(await second.open('m:k', ENV, false)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('StateStore.write()', () => {
  it('lets concurrent writes of one key all succeed', async () => {
    const store = new StateStore(mkdtempSync(join(tmpdir(), 'herdr-mods-')));

    await Promise.all([1, 2, 3, 4].map((turns) => store.write('m', 'k', { turns })));

    expect(await store.read(store.pathFor('m', 'k'))).toHaveProperty('turns');
  });
});

describe('PaneLifecycle single pane', () => {
  it('skips an automatic open while another mod pane lives, and replaces it on a forced open', async () => {
    const { open, live } = stubHerdr(['w1:p2', 'w1:p3']);
    const close = spyOn(HerdrPane, 'close').mockImplementation(async (paneId: string) => void live.delete(paneId));
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('a:k', ENV, false);

    expect(await lifecycle.open('b:k', ENV, false)).toBe(false);
    expect(await lifecycle.open('b:k', ENV, true)).toBe(true);

    expect(close).toHaveBeenCalledWith('w1:p2');
    expect(open).toHaveBeenCalledTimes(2);
    close.mockRestore();
  });
});

describe('HerdrPane.title', () => {
  it('names the pane after the mod', () => {
    expect(HerdrPane.title('claude-summaries')).toBe('summaries Mod');
    expect(HerdrPane.title('weather')).toBe('weather Mod');
  });
});
