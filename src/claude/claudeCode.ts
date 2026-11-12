/**
 * Stands in for the `claude-code` module a Claude Code mod imports: `atom`, `read` and `update`. The
 * loader rewrites `from 'claude-code'` to this file. Atom values live in the mod's runtime, which the
 * `$` engine carries under ATOM_STORE.
 */
export const ATOM_STORE = Symbol.for('herdr-mods.claude.atoms');

export interface AtomToken<Value> {
  readonly key: string;
  readonly initial: Value;
}

export interface AtomStore {
  read<Value>(token: AtomToken<Value>): Value;
  update<Value>(token: AtomToken<Value>, change: (current: Value) => Value): void;
}

export function atom<Value>(spec: { readonly plugin: string; readonly key: string }, initial: Value): AtomToken<Value> {
  return { key: `${spec.plugin}:${spec.key}`, initial };
}

function storeOf($: unknown): AtomStore {
  const store = ($ as Record<symbol, AtomStore | undefined>)[ATOM_STORE];
  if (!store) {
    throw new Error('herdr-mods: read/update need the $ the event handler received');
  }
  return store;
}

export async function read<Value>($: unknown, token: AtomToken<Value>): Promise<Value> {
  return storeOf($).read(token);
}

export async function update<Value>($: unknown, token: AtomToken<Value>, change: (current: Value) => Value): Promise<void> {
  storeOf($).update(token, change);
}
