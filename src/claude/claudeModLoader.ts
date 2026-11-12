import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { TermRenderer } from '../render/termRenderer.ts';

/** What a Claude Code mod's `.claude-plugin/plugin.json` declares, as far as herdr-mods uses it. */
export interface ClaudeModManifest {
  readonly name: string;
  readonly userConfig?: Readonly<Record<string, { readonly default?: unknown }>>;
}

export interface LoadedClaudeMod {
  readonly name: string;
  readonly root: string;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly registers: readonly ((on: unknown, options: Readonly<Record<string, unknown>>) => void)[];
}

/**
 * Loads an unchanged Claude Code mod: compiles every .ts/.tsx under its folder to plain JS (classic
 * JSX through the private `__herdrModsH` factory, `claude-code` rewritten to the herdr-mods shim) into
 * a cache folder, then imports the modules its `hooks/hooks.json` lists.
 */
export class ClaudeModLoader {
  static readonly JSX_FACTORY = '__herdrModsH';
  static readonly JSX_FRAGMENT = '__herdrModsFragment';
  private static readonly SHIM = join(import.meta.dir, 'claudeCode.ts');
  private static readonly SKIPPED_FOLDERS = new Set(['node_modules', 'tests', '.git', 'agent-spec']);
  private static readonly SOURCE = /\.(ts|tsx)$/;
  private static readonly CLAUDE_CODE_IMPORT = /(from\s*|import\s*\(\s*|import\s+)(["'])claude-code\2/g;

  private readonly transpiler = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: { compilerOptions: { jsx: 'react', jsxFactory: ClaudeModLoader.JSX_FACTORY, jsxFragmentFactory: ClaudeModLoader.JSX_FRAGMENT } },
  });

  constructor(private readonly cacheRoot: string = join(process.env['HOME'] ?? '', '.cache', 'herdr-mods', 'claude-build')) {}

  async load(root: string): Promise<LoadedClaudeMod> {
    const globals = globalThis as Record<string, unknown>;
    globals[ClaudeModLoader.JSX_FACTORY] = TermRenderer.h;
    globals[ClaudeModLoader.JSX_FRAGMENT] = TermRenderer.Fragment;
    const manifest = JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as ClaudeModManifest;
    const hooks = JSON.parse(await readFile(join(root, 'hooks', 'hooks.json'), 'utf8')) as { modules?: string[] };
    const buildRoot = join(this.cacheRoot, manifest.name);
    await this.compile(root, root, buildRoot);
    const stamp = Date.now();
    const registers = await Promise.all(
      (hooks.modules ?? []).map(async (module) => {
        const loaded = (await import(`${join(buildRoot, 'hooks', module)}?v=${stamp}`)) as { register?: LoadedClaudeMod['registers'][number] };
        if (typeof loaded.register !== 'function') {
          throw new Error(`${module} has no register export`);
        }
        return loaded.register;
      }),
    );
    const defaults = Object.fromEntries(Object.entries(manifest.userConfig ?? {}).map(([key, spec]) => [key, spec.default]));
    return { name: manifest.name, root, defaults, registers };
  }

  private async compile(root: string, folder: string, buildRoot: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const source = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!ClaudeModLoader.SKIPPED_FOLDERS.has(entry.name)) {
          await this.compile(root, source, buildRoot);
        }
        continue;
      }
      if (!ClaudeModLoader.SOURCE.test(entry.name) || entry.name.endsWith('.d.ts')) {
        continue;
      }
      const target = join(buildRoot, relative(root, source));
      await mkdir(dirname(target), { recursive: true });
      const compiled = this.transpiler.transformSync(await readFile(source, 'utf8'));
      await writeFile(target, compiled.replace(ClaudeModLoader.CLAUDE_CODE_IMPORT, `$1$2${ClaudeModLoader.SHIM}$2`));
    }
  }

  /** Whether `root` holds a Claude Code mod with hooks. */
  static isClaudeMod(root: string): boolean {
    return existsSync(join(root, '.claude-plugin', 'plugin.json')) && existsSync(join(root, 'hooks', 'hooks.json'));
  }
}
