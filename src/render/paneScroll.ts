/**
 * Vertical scrolling of a view that is taller than its pane. When the view overflows, the pane's last row
 * shows a position indicator, so the view's body takes one row less.
 */
export class PaneScroll {
  /** Lines one mouse wheel notch moves. */
  static readonly WHEEL_LINES = 3;

  /** The rows the view's lines take: the visible rows, less the indicator row when the view overflows. */
  static bodyRows(visibleRows: number, totalLines: number): number {
    return totalLines > visibleRows ? Math.max(0, visibleRows - 1) : visibleRows;
  }

  /** The largest offset that still fills the body: the last line sits at the bottom. */
  static maxOffset(visibleRows: number, totalLines: number): number {
    return Math.max(0, totalLines - PaneScroll.bodyRows(visibleRows, totalLines));
  }

  /** `offset` kept between the top and the bottom of the view. */
  static clamp(offset: number, visibleRows: number, totalLines: number): number {
    return Math.min(Math.max(0, offset), PaneScroll.maxOffset(visibleRows, totalLines));
  }

  /** The indicator text: the lines shown, for example `↑↓ 21-40 of 120`. */
  static indicator(offset: number, bodyRows: number, totalLines: number): string {
    return `\u2191\u2193 ${offset + 1}-${Math.min(totalLines, offset + bodyRows)} of ${totalLines}`;
  }
}
