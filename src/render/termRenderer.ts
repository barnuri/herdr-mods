export interface TermNode {
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly unknown[];
}

interface Style {
  readonly color?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly underline?: boolean;
}

interface Segment {
  readonly text: string;
  readonly style: Style;
  readonly onPress?: () => void;
}

type Line = Segment[];

export interface ClickRegion {
  readonly row: number;
  readonly start: number;
  readonly end: number;
  readonly onPress: () => void;
}

export interface TermFrame {
  readonly lines: readonly string[];
  readonly regions: readonly ClickRegion[];
  readonly hotkeys: ReadonlyMap<string, () => void>;
}

/**
 * Renders a mod view tree (Box, Text, Button, Link, the elements Claude Code mods use) into terminal lines,
 * with click regions for buttons and their hotkeys.
 */
export class TermRenderer {
  static readonly BOX = 'Box';
  static readonly TEXT = 'Text';
  static readonly BUTTON = 'Button';
  static readonly LINK = 'Link';
  private static readonly NAMED_COLORS: Readonly<Record<string, number>> = {
    black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90,
    redBright: 91, greenBright: 92, yellowBright: 93, blueBright: 94, magentaBright: 95, cyanBright: 96, whiteBright: 97,
  };

  private readonly hotkeys = new Map<string, () => void>();

  constructor(
    private readonly width: number,
    private readonly openLink: (href: string) => void,
  ) {}

  /** `Fragment` for classic JSX: its children, unwrapped. */
  static Fragment(props: { readonly children?: unknown }): unknown {
    return props.children;
  }

  /** The `h` factory classic JSX compiles to. */
  static h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): TermNode {
    return { type, props: props ?? {}, children };
  }

  render(root: unknown): TermFrame {
    const lines = this.block(root, this.width);
    const regions: ClickRegion[] = [];
    const rendered = lines.map((line, row) => {
      let column = 0;
      return line
        .map((segment) => {
          const text = segment.text;
          if (segment.onPress) {
            regions.push({ row, start: column, end: column + text.length, onPress: segment.onPress });
          }
          column += text.length;
          return TermRenderer.ansi(text, segment.style);
        })
        .join('');
    });
    return { lines: rendered, regions, hotkeys: this.hotkeys };
  }

  private block(node: unknown, width: number): Line[] {
    if (node === null || node === undefined || node === false || node === true) {
      return [];
    }
    if (Array.isArray(node)) {
      return node.flatMap((child) => this.block(child, width));
    }
    if (!TermRenderer.isNode(node)) {
      return [[{ text: String(node), style: {} }]];
    }
    if (node.type === TermRenderer.BOX) {
      return this.box(node, width);
    }
    if (typeof node.type === 'function') {
      return this.block((node.type as (props: unknown) => unknown)({ ...node.props, children: node.children }), width);
    }
    return this.wrapInline(this.inline(node, {}), node.props['wrap'], width);
  }

  private box(node: TermNode, width: number): Line[] {
    const paddingLeft = Number(node.props['paddingLeft'] ?? 0);
    const paddingRight = Number(node.props['paddingRight'] ?? 0);
    const marginTop = Number(node.props['marginTop'] ?? 0);
    const inner = Math.max(1, width - paddingLeft - paddingRight);
    const children = TermRenderer.flatten(node.children);
    const lines =
      node.props['flexDirection'] === 'row'
        ? this.row(children, inner, Number(node.props['columnGap'] ?? 0), node.props['flexWrap'] === 'wrap')
        : this.column(children, inner, Number(node.props['minHeight'] ?? 0));
    const padded = paddingLeft > 0 ? lines.map((line) => [{ text: ' '.repeat(paddingLeft), style: {} }, ...line]) : lines;
    return [...Array.from({ length: marginTop }, () => []), ...padded];
  }

  private column(children: readonly unknown[], width: number, minHeight: number): Line[] {
    const blocks = children.map((child) => this.block(child, width));
    const total = blocks.reduce((sum, block) => sum + block.length, 0);
    const growIndex = children.findIndex((child) => TermRenderer.isNode(child) && child.props['flexGrow'] === 1);
    if (minHeight > total && growIndex >= 0) {
      blocks[growIndex] = [...(blocks[growIndex] ?? []), ...Array.from({ length: minHeight - total }, () => [])];
    }
    return blocks.flat();
  }

  private row(children: readonly unknown[], width: number, gap: number, isWrapping: boolean): Line[] {
    const blocks = children.map((child) => this.block(child, width)).filter((block) => block.length > 0);
    const rows: Line[][][] = [[]];
    let used = 0;
    for (const block of blocks) {
      const blockWidth = Math.max(0, ...block.map(TermRenderer.lineWidth));
      const current = rows.at(-1) ?? [];
      const needed = (current.length > 0 ? gap : 0) + blockWidth;
      if (isWrapping && current.length > 0 && used + needed > width) {
        rows.push([block]);
        used = blockWidth;
        continue;
      }
      current.push(block);
      used += needed;
    }
    return rows.flatMap((blocksInRow) => TermRenderer.sideBySide(blocksInRow, gap));
  }

  private static sideBySide(blocks: readonly Line[][], gap: number): Line[] {
    const height = Math.max(0, ...blocks.map((block) => block.length));
    const widths = blocks.map((block) => Math.max(0, ...block.map(TermRenderer.lineWidth)));
    return Array.from({ length: height }, (_, index) =>
      blocks.flatMap((block, column) => {
        const line = block[index] ?? [];
        const isLast = column === blocks.length - 1;
        const fill = isLast ? 0 : (widths[column] ?? 0) - TermRenderer.lineWidth(line) + gap;
        return fill > 0 ? [...line, { text: ' '.repeat(fill), style: {} }] : line;
      }),
    );
  }

  private inline(node: unknown, inherited: Style, onPress?: () => void): Segment[] {
    if (node === null || node === undefined || node === false || node === true) {
      return [];
    }
    if (Array.isArray(node)) {
      return node.flatMap((child) => this.inline(child, inherited, onPress));
    }
    if (!TermRenderer.isNode(node)) {
      return [{ text: String(node), style: inherited, ...(onPress ? { onPress } : {}) }];
    }
    const props = node.props;
    if (typeof node.type === 'function') {
      return this.inline((node.type as (props: unknown) => unknown)({ ...props, children: node.children }), inherited, onPress);
    }
    if (node.type === TermRenderer.LINK && typeof props['href'] === 'string') {
      const href = props['href'];
      return node.children.flatMap((child) => this.inline(child, { ...inherited, underline: true }, () => this.openLink(href)));
    }
    if (node.type === TermRenderer.BUTTON) {
      const press = typeof props['onPress'] === 'function' ? (props['onPress'] as () => void) : undefined;
      if (press && typeof props['hotkey'] === 'string') {
        this.hotkeys.set(props['hotkey'], press);
      }
      return node.children.flatMap((child) => this.inline(child, inherited, press));
    }
    const style: Style = {
      color: typeof props['color'] === 'string' ? props['color'] : inherited.color,
      bold: props['bold'] === true || inherited.bold,
      dim: props['dimColor'] === true || inherited.dim,
      underline: props['underline'] === true || inherited.underline,
    };
    return node.children.flatMap((child) => this.inline(child, style, onPress));
  }

  private wrapInline(segments: Segment[], wrap: unknown, width: number): Line[] {
    const lines: Line[] = [[]];
    let used = 0;
    for (const segment of segments) {
      const parts = segment.text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push([]);
          used = 0;
        }
        let rest = part;
        while (rest.length > 0) {
          const room = width - used;
          if (rest.length <= room || wrap !== 'wrap') {
            const text = wrap === 'wrap' ? rest : TermRenderer.truncate(rest, Math.max(0, room));
            lines.at(-1)?.push({ ...segment, text });
            used += text.length;
            rest = '';
            continue;
          }
          const cut = TermRenderer.breakAt(rest, room);
          lines.at(-1)?.push({ ...segment, text: rest.slice(0, cut) });
          lines.push([]);
          used = 0;
          rest = rest.slice(cut).replace(/^ /, '');
        }
      });
    }
    return lines;
  }

  private static breakAt(text: string, room: number): number {
    const space = text.lastIndexOf(' ', room);
    return space > 0 ? space : Math.max(1, room);
  }

  private static truncate(text: string, room: number): string {
    return text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`;
  }

  private static lineWidth(line: Line): number {
    return line.reduce((sum, segment) => sum + segment.text.length, 0);
  }

  private static flatten(children: readonly unknown[]): unknown[] {
    return children.flatMap((child) => (Array.isArray(child) ? TermRenderer.flatten(child) : [child]));
  }

  private static isNode(value: unknown): value is TermNode {
    return typeof value === 'object' && value !== null && 'type' in value && 'props' in value && 'children' in value;
  }

  private static ansi(text: string, style: Style): string {
    const codes = [
      ...(style.bold ? ['1'] : []),
      ...(style.dim ? ['2'] : []),
      ...(style.underline ? ['4'] : []),
      ...TermRenderer.colorCodes(style.color),
    ];
    return codes.length === 0 || text === '' ? text : `\x1b[${codes.join(';')}m${text}\x1b[0m`;
  }

  private static colorCodes(color: string | undefined): string[] {
    if (!color) {
      return [];
    }
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    if (hex) {
      return ['38', '2', ...hex.slice(1).map((part) => String(Number.parseInt(part, 16)))];
    }
    const named = TermRenderer.NAMED_COLORS[color];
    return named === undefined ? [] : [String(named)];
  }
}
