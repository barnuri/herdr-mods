import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HerdrPane } from '../src/herdr/herdrPane.ts';
import { TermRenderer } from '../src/render/termRenderer.ts';
import { StateStore } from '../src/state/stateStore.ts';

const h = TermRenderer.h;
const plain = (lines: readonly string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));

describe('TermRenderer', () => {
  it('stacks a column box and joins a row box', () => {
    const tree = h('Box', { flexDirection: 'column' }, h('Text', { bold: true }, 'title'), h('Box', { flexDirection: 'row', columnGap: 1 }, h('Text', null, 'a'), h('Text', null, 'b')));

    expect(plain(new TermRenderer(40, () => undefined).render(tree).lines)).toEqual(['title', 'a b']);
  });

  it('records a click region and the hotkey of a button', () => {
    let pressed = 0;
    const tree = h('Box', { flexDirection: 'row' }, h('Text', null, 'go: '), h('Button', { hotkey: 'n', onPress: () => (pressed += 1) }, h('Text', { underline: true }, 'next')));

    const frame = new TermRenderer(40, () => undefined).render(tree);
    frame.regions[0]?.onPress();
    frame.hotkeys.get('n')?.();

    expect(frame.regions[0]).toMatchObject({ row: 0, start: 4, end: 8 });
    expect(pressed).toBe(2);
  });

  it('wraps text with wrap="wrap" and opens links through the opener', () => {
    const opened: string[] = [];
    const renderer = new TermRenderer(10, (href) => opened.push(href));

    const frame = renderer.render(h('Box', { flexDirection: 'column' }, h('Text', { wrap: 'wrap' }, 'one two three four'), h('Link', { href: 'https://x' }, 'site')));
    frame.regions[0]?.onPress();

    expect(plain(frame.lines)).toEqual(['one two', 'three four', 'site']);
    expect(opened).toEqual(['https://x']);
  });

  it('paints hex and named colors', () => {
    const [line] = new TermRenderer(20, () => undefined).render(h('Text', { color: '#D77757' }, 'x')).lines;

    expect(line).toBe('\x1b[38;2;215;119;87mx\x1b[0m');
  });
});

describe('HerdrPane.direction()', () => {
  const layout = (width: number) => ({ result: { layout: { panes: [{ pane_id: 'w1:p1', rect: { width, height: 50 } }] } } });

  it('splits right on a wide pane and below on a narrow one', () => {
    expect(HerdrPane.direction(layout(200), 'w1:p1')).toBe('right');
    expect(HerdrPane.direction(layout(140), 'w1:p1')).toBe('right');
    expect(HerdrPane.direction(layout(80), 'w1:p1')).toBe('down');
    expect(HerdrPane.direction(null, 'w1:p1')).toBe('right');
  });

  it('reads the new pane id from a plugin pane or split result', () => {
    expect(HerdrPane.paneIdOf({ result: { plugin_pane: { plugin_id: 'barnuri.mods', pane: { pane_id: 'w1:p3' } } } })).toBe('w1:p3');
    expect(HerdrPane.paneIdOf({ result: { pane: { pane_id: 'w1:p2' } } })).toBe('w1:p2');
    expect(HerdrPane.paneIdOf({ error: 'x' })).toBeNull();
  });
});

describe('StateStore', () => {
  it('writes and reads a mod state, with unsafe key characters folded', async () => {
    const store = new StateStore(mkdtempSync(join(tmpdir(), 'herdr-mods-')));

    await store.write('summarize', 'ses/1', { turns: 2 });

    expect(store.pathFor('summarize', 'ses/1').endsWith(join('summarize', 'ses-1.json'))).toBe(true);
    expect(await store.read(store.pathFor('summarize', 'ses/1'))).toEqual({ turns: 2 });
    expect(await store.read(store.pathFor('summarize', 'missing'))).toBeNull();
  });
});
