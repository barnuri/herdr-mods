import { describe, expect, it } from 'bun:test';
import { PaneScroll } from '../src/render/paneScroll.ts';

describe('PaneScroll', () => {
  it('keeps every row when the view fits the pane', () => {
    expect(PaneScroll.bodyRows(20, 15)).toBe(20);
    expect(PaneScroll.maxOffset(20, 15)).toBe(0);
    expect(PaneScroll.clamp(5, 20, 15)).toBe(0);
  });

  it('gives the last row to the indicator when the view overflows', () => {
    expect(PaneScroll.bodyRows(20, 120)).toBe(19);
    expect(PaneScroll.maxOffset(20, 120)).toBe(101);
  });

  it('clamps the offset to the top and to the last line', () => {
    expect(PaneScroll.clamp(-4, 20, 120)).toBe(0);
    expect(PaneScroll.clamp(500, 20, 120)).toBe(101);
    expect(PaneScroll.clamp(Infinity, 20, 120)).toBe(101);
  });

  it('shows the lines in view as the indicator', () => {
    expect(PaneScroll.indicator(0, 19, 120)).toBe('↑↓ 1-19 of 120');
    expect(PaneScroll.indicator(101, 19, 120)).toBe('↑↓ 102-120 of 120');
  });
});
