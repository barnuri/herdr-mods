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
  spyOn(HerdrPane, 'modPanesIn').mockImplementation(async () => [...live]);
  spyOn(HerdrPane, 'close').mockImplementation(async (paneId: string) => {
    live.delete(paneId);
  });
  return { open, live };
};

afterEach(() => {
  (HerdrPane.open as unknown as { mockRestore(): void }).mockRestore?.();
  (HerdrPane.modPanesIn as unknown as { mockRestore(): void }).mockRestore?.();
  (HerdrPane.close as unknown as { mockRestore(): void }).mockRestore?.();
});

describe('PaneLifecycle', () => {
  it('opens a pane by itself once, and keeps it while it lives', async () => {
    const { open } = stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');

    expect(await lifecycle.open('m:k', ENV, false)).toBe(true);
    expect(await lifecycle.open('m:k', ENV, false)).toBe(true);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('never adds a second panel to a tab that already has one, even from another instance', async () => {
    const { open } = stubHerdr(['w1:p2', 'w1:p3']);
    await new PaneLifecycle('w1:p1').open('m:k', ENV, false);

    expect(await new PaneLifecycle('w1:p1').open('other:k', ENV, false)).toBe(false);
    expect(await new PaneLifecycle('w1:p1').open('m:k', ENV, true)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
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

describe('PaneLifecycle relayout', () => {
  const stubLayout = (areaWidth: number, paneWidths: Record<string, number>) => {
    const layout = spyOn(HerdrPane, 'layoutOf').mockImplementation(async () => ({
      areaWidth,
      widths: new Map(Object.entries(paneWidths)),
    }));
    const move = spyOn(HerdrPane, 'move').mockImplementation(async () => undefined);
    return { layout, move };
  };

  afterEach(() => {
    (HerdrPane.layoutOf as unknown as { mockRestore(): void }).mockRestore?.();
    (HerdrPane.move as unknown as { mockRestore(): void }).mockRestore?.();
  });

  it('moves a side-by-side panel below when the screen narrows', async () => {
    stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('m:k', ENV, false);
    const { move } = stubLayout(100, { 'w1:p1': 60, 'w1:p2': 40 });

    await lifecycle.relayout();
    expect(move).not.toHaveBeenCalled();
    await lifecycle.relayout();

    expect(move).toHaveBeenCalledWith('w1:p2', 'w1:p1', 'down');
  });

  it('moves a stacked panel to the right when the screen widens', async () => {
    stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('m:k', ENV, false);
    const { move } = stubLayout(200, { 'w1:p1': 200, 'w1:p2': 200 });

    await lifecycle.relayout();
    await lifecycle.relayout();

    expect(move).toHaveBeenCalledWith('w1:p2', 'w1:p1', 'right');
  });

  it('does not move when the width flips back before the second check', async () => {
    stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('m:k', ENV, false);
    const { layout, move } = stubLayout(100, { 'w1:p1': 60, 'w1:p2': 40 });

    await lifecycle.relayout();
    layout.mockImplementation(async () => ({ areaWidth: 200, widths: new Map([['w1:p1', 120], ['w1:p2', 80]]) }));
    await lifecycle.relayout();

    expect(move).not.toHaveBeenCalled();
  });

  it('closes an extra mod panel in the tab and keeps the first', async () => {
    const { live } = stubHerdr(['w1:p2']);
    await new PaneLifecycle('w1:p1').open('m:k', ENV, false);
    live.add('w1:p3');
    stubLayout(200, { 'w1:p1': 120, 'w1:p2': 80, 'w1:p3': 80 });

    await new PaneLifecycle('w1:p1').relayout();

    expect(HerdrPane.close).toHaveBeenCalledWith('w1:p3');
    expect(HerdrPane.close).not.toHaveBeenCalledWith('w1:p2');
  });

  it('leaves a panel alone when its side already fits the width', async () => {
    stubHerdr(['w1:p2']);
    const lifecycle = new PaneLifecycle('w1:p1');
    await lifecycle.open('m:k', ENV, false);
    const { move } = stubLayout(200, { 'w1:p1': 120, 'w1:p2': 80 });

    await lifecycle.relayout();

    expect(move).not.toHaveBeenCalled();
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
