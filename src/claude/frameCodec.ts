import type { TermNode } from '../render/termRenderer.ts';

/** A view tree as JSON: each function prop is `{ "$action": <id> }`; function components are already expanded. */
export interface EncodedFrame {
  readonly tree: unknown;
}

const ACTION = '$action';

/** Moves a rendered tree between the opencode process (where a Claude mod renders) and its herdr pane. */
export class FrameCodec {
  /** The tree as JSON, and the functions its action ids stand for. */
  static encode(tree: unknown): { readonly frame: EncodedFrame; readonly actions: ReadonlyMap<number, () => unknown> } {
    const actions = new Map<number, () => unknown>();
    const walk = (node: unknown): unknown => {
      if (Array.isArray(node)) {
        return node.map(walk);
      }
      if (!FrameCodec.isNode(node)) {
        return typeof node === 'function' ? null : node;
      }
      if (typeof node.type === 'function') {
        return walk((node.type as (props: unknown) => unknown)({ ...node.props, children: node.children }));
      }
      const props = Object.fromEntries(
        Object.entries(node.props).map(([name, value]) => {
          if (typeof value !== 'function') {
            return [name, value];
          }
          const id = actions.size + 1;
          actions.set(id, value as () => unknown);
          return [name, { [ACTION]: id }];
        }),
      );
      return { type: node.type, props, children: node.children.map(walk) };
    };
    return { frame: { tree: walk(tree) }, actions };
  }

  /** The tree back, with each action id calling `send(id)`. */
  static decode(frame: EncodedFrame | null, send: (actionId: number) => void): unknown {
    const walk = (node: unknown): unknown => {
      if (Array.isArray(node)) {
        return node.map(walk);
      }
      if (!FrameCodec.isNode(node)) {
        return node;
      }
      const props = Object.fromEntries(
        Object.entries(node.props).map(([name, value]) => {
          const id = (value as Record<string, unknown> | null)?.[ACTION];
          return typeof id === 'number' ? [name, () => send(id)] : [name, value];
        }),
      );
      return { type: node.type, props, children: node.children.map(walk) };
    };
    return frame ? walk(frame.tree) : null;
  }

  private static isNode(value: unknown): value is TermNode {
    return typeof value === 'object' && value !== null && 'type' in value && 'props' in value && 'children' in value;
  }
}
