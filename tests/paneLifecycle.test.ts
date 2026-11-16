import { afterEach, beforeEach, describe, expect, it, spyOn, mock } from 'bun:test';
import { HerdrPane } from '../src/herdr/herdrPane.ts';
import { PaneLifecycle } from '../src/herdr/paneLifecycle.ts';
import type { PanelRecord, PanelTab } from '../src/state/panelState.ts';
import { PANEL_MOD, panelSideKey } from '../src/state/panelState.ts';
import { StateStore } from '../src/state/stateStore.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTO = { isForced: false, parentPid: 0 };
const FORCED = { isForced: true, parentPid: 0 };
const tab = (modId: string, key = 'k'): PanelTab => ({ modId, key, view: `/views/${modId}.ts`, options: {} });

let store: StateStore;
beforeEach(() => {
  store = new StateStore(mkdtempSync(join(tmpdir(), 'herdr-mods-')));
});

/** A lifecycle for the agent pane `besidePaneId`; every lifecycle in a test shares one store, as the host and the CLI do. */
const lifecycle = (besidePaneId = 'w1:p1') => new PaneLifecycle(besidePaneId, store);

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

const recordOf = async (besidePaneId = 'w1:p1'): Promise<PanelRecord> =>
  (await store.read(store.pathFor(PANEL_MOD, besidePaneId))) as PanelRecord;

afterEach(() => {
  mock.restore();
});

describe('PaneLifecycle', () => {
  it('opens the panel by itself once, and keeps it while it lives', async () => {
    const { open } = stubHerdr(['w1:p2']);

    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);
    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('adds a second mod to the same panel as a tab, without a second herdr pane', async () => {
    const { open } = stubHerdr(['w1:p2', 'w1:p3']);

    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);
    expect(await lifecycle().open(tab('b'), AUTO)).toBe(true);

    expect(open).toHaveBeenCalledTimes(1);
    expect((await recordOf()).tabs.map((item) => item.modId)).toEqual(['a', 'b']);
  });

  it('keeps one tab per mod: opening it with another key replaces its key', async () => {
    const { open } = stubHerdr(['w1:p2']);
    await lifecycle().open(tab('a', 'k1'), AUTO);

    expect(await lifecycle().open(tab('a', 'k2'), AUTO)).toBe(true);

    const { tabs } = await recordOf();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.key).toBe('k2');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a forced open selects its tab', async () => {
    stubHerdr(['w1:p2']);
    await lifecycle().open(tab('a'), AUTO);
    await lifecycle().open(tab('b'), AUTO);
    const before = (await recordOf()).focus?.at ?? 0;

    await lifecycle().open(tab('a'), FORCED);

    const record = await recordOf();
    expect(record.focus?.modId).toBe('a');
    expect(record.focus?.at).toBeGreaterThan(before);
  });

  it('opens by itself again after the person closed the panel', async () => {
    const { open, live } = stubHerdr(['w1:p2', 'w1:p3']);
    await lifecycle().open(tab('a'), AUTO);
    live.delete('w1:p2');

    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps the tab after the panel closes, so the reopened panel shows the same mod', async () => {
    const { live } = stubHerdr(['w1:p2', 'w1:p3']);
    await lifecycle().open(tab('a', 'k1'), AUTO);
    live.delete('w1:p2');

    await lifecycle().open(tab('a', 'k1'), AUTO);

    expect((await recordOf()).tabs).toEqual([tab('a', 'k1')]);
  });

  it('a forced open does not use up the automatic open of this process', async () => {
    const { open, live } = stubHerdr(['w1:p2', 'w1:p3']);
    await lifecycle().open(tab('a'), FORCED);
    live.delete('w1:p2');

    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('a new panel starts with only the tab that opened it', async () => {
    const { live } = stubHerdr(['w1:p2', 'w1:p3']);
    await lifecycle().open(tab('a'), AUTO);
    live.delete('w1:p2');

    await lifecycle().open(tab('b'), FORCED);

    expect((await recordOf()).tabs.map((item) => item.modId)).toEqual(['b']);
  });

  it('retries the automatic open after a failed first open', async () => {
    const { open } = stubHerdr([null, 'w1:p2']);

    expect(await lifecycle().open(tab('a'), AUTO)).toBe(false);
    expect(await lifecycle().open(tab('a'), AUTO)).toBe(true);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('isOpen is true for a tab only while its panel lives', async () => {
    const { live } = stubHerdr(['w1:p2']);
    await lifecycle().open(tab('a'), AUTO);

    expect(await lifecycle().isOpen('a:k')).toBe(true);
    live.delete('w1:p2');
    expect(await lifecycle().isOpen('a:k')).toBe(false);
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

  it('moves a side-by-side panel below when the screen narrows', async () => {
    stubHerdr(['w1:p2']);
    const life = lifecycle();
    await life.open(tab('m'), AUTO);
    const { move } = stubLayout(100, { 'w1:p1': 60, 'w1:p2': 40 });

    await life.relayout();
    expect(move).not.toHaveBeenCalled();
    await life.relayout();

    expect(move).toHaveBeenCalledWith('w1:p2', 'w1:p1', 'down');
  });

  it('moves a stacked panel to the right when the screen widens', async () => {
    stubHerdr(['w1:p2']);
    const life = lifecycle();
    await life.open(tab('m'), AUTO);
    const { move } = stubLayout(200, { 'w1:p1': 200, 'w1:p2': 200 });

    await life.relayout();
    await life.relayout();

    expect(move).toHaveBeenCalledWith('w1:p2', 'w1:p1', 'right');
  });

  it('does not move when the width flips back before the second check', async () => {
    stubHerdr(['w1:p2']);
    await lifecycle().open(tab('m'), AUTO);
    const life = lifecycle();
    const { layout, move } = stubLayout(100, { 'w1:p1': 60, 'w1:p2': 40 });

    await life.relayout();
    layout.mockImplementation(async () => ({ areaWidth: 200, widths: new Map([['w1:p1', 120], ['w1:p2', 80]]) }));
    await life.relayout();

    expect(move).not.toHaveBeenCalled();
  });

  it('closes an extra mod panel in the tab and keeps the first', async () => {
    const { live } = stubHerdr(['w1:p2']);
    await lifecycle().open(tab('m'), AUTO);
    live.add('w1:p3');
    stubLayout(200, { 'w1:p1': 120, 'w1:p2': 80, 'w1:p3': 80 });

    await lifecycle().relayout();

    expect(HerdrPane.close).toHaveBeenCalledWith('w1:p3');
    expect(HerdrPane.close).not.toHaveBeenCalledWith('w1:p2');
  });

  it('leaves a panel alone when its side already fits the width', async () => {
    stubHerdr(['w1:p2']);
    await lifecycle().open(tab('m'), AUTO);
    const { move } = stubLayout(200, { 'w1:p1': 120, 'w1:p2': 80 });

    await lifecycle().relayout();

    expect(move).not.toHaveBeenCalled();
  });

  it('keeps a panel below the agent pane on a narrow tab when a sidebar makes it narrower than the tab', async () => {
    stubHerdr(['w1:p2']);
    await lifecycle().open(tab('m'), AUTO);
    const raw = {
      result: {
        layout: {
          panes: [
            { pane_id: 'w1:p9', rect: { x: 0, y: 0, width: 40, height: 50 } },
            { pane_id: 'w1:p1', rect: { x: 40, y: 0, width: 80, height: 30 } },
            { pane_id: 'w1:p2', rect: { x: 40, y: 30, width: 80, height: 20 } },
          ],
        },
      },
    };
    spyOn(HerdrPane, 'layoutOf').mockImplementation(async () => ({ areaWidth: 120, widths: new Map([['w1:p1', 80], ['w1:p2', 80]]), raw }));
    const move = spyOn(HerdrPane, 'move').mockImplementation(async () => undefined);
    const life = lifecycle();

    await life.relayout();
    await life.relayout();

    expect(move).not.toHaveBeenCalled();
  });

  it('moves the panel at once to the side the person chose, even on a wide tab', async () => {
    stubHerdr(['w1:p2']);
    await lifecycle().open(tab('m'), AUTO);
    await store.write(PANEL_MOD, panelSideKey('w1:p1'), { side: 'down' });
    const { move } = stubLayout(200, { 'w1:p1': 120, 'w1:p2': 80 });

    await lifecycle().relayout();

    expect(move).toHaveBeenCalledWith('w1:p2', 'w1:p1', 'down');
  });
});

describe('StateStore.write()', () => {
  it('lets concurrent writes of one key all succeed', async () => {
    const local = new StateStore(mkdtempSync(join(tmpdir(), 'herdr-mods-')));

    await Promise.all([1, 2, 3, 4].map((turns) => local.write('m', 'k', { turns })));

    expect(await local.read(local.pathFor('m', 'k'))).toHaveProperty('turns');
  });
});

describe('HerdrPane.title', () => {
  it('names the panel after the mod, with a lowercase mod', () => {
    expect(HerdrPane.title('claude-summaries')).toBe('summaries mod');
    expect(HerdrPane.title('weather')).toBe('weather mod');
  });

  it('gives the mod name without the claude prefix', () => {
    expect(HerdrPane.name('claude-summaries')).toBe('summaries');
    expect(HerdrPane.name('orch-graph')).toBe('orch-graph');
  });
});
