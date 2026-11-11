import { OpencodeHost } from './src/opencode/opencodeHost.ts';
import type { HostContext, ModEntry } from './src/opencode/hostContext.ts';

// opencode 2 TUI plugin. List this folder in `~/.config/opencode/cli.json` with the mods to load:
// { "plugins": [{ "package": "/path/to/herdr-mods", "options": { "mods": ["/path/to/mod.ts"] } }] }
export default {
  id: 'herdr-mods',
  async setup(context: HostContext): Promise<(() => void) | undefined> {
    try {
      const mods = (context.options?.['mods'] ?? []) as readonly ModEntry[];
      return await new OpencodeHost(context).register(mods);
    } catch {
      /* never throw into the TUI — a broken mod host must not take opencode down */
      return undefined;
    }
  },
};
