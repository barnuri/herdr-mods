import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** A mod found in the mods folder: a herdr mod (`mod.ts`) or an unchanged Claude Code mod (`.claude-plugin/plugin.json`). */
export interface FoundMod {
  readonly kind: 'herdr' | 'claude';
  readonly path: string;
}

/**
 * The mods folder (`~/.config/herdr-mods/mods`, or `HERDR_MODS_DIR`): every sub-folder is a mod, so
 * dropping a folder (or a symlink to one) there registers it.
 */
export class ModFolder {
  static readonly HERDR_MOD_ENTRY = 'mod.ts';
  static readonly CLAUDE_MOD_MANIFEST = join('.claude-plugin', 'plugin.json');

  constructor(private readonly directory: string = ModFolder.defaultDirectory()) {}

  static defaultDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string {
    return env['HERDR_MODS_DIR'] || join(env['HOME'] ?? '', '.config', 'herdr-mods', 'mods');
  }

  get path(): string {
    return this.directory;
  }

  async list(): Promise<FoundMod[]> {
    if (!existsSync(this.directory)) {
      return [];
    }
    const names = (await readdir(this.directory)).filter((name) => !name.startsWith('.')).sort();
    return names.flatMap((name): FoundMod[] => {
      const folder = join(this.directory, name);
      if (existsSync(join(folder, ModFolder.HERDR_MOD_ENTRY))) {
        return [{ kind: 'herdr', path: join(folder, ModFolder.HERDR_MOD_ENTRY) }];
      }
      if (existsSync(join(folder, ModFolder.CLAUDE_MOD_MANIFEST))) {
        return [{ kind: 'claude', path: folder }];
      }
      return [];
    });
  }
}
