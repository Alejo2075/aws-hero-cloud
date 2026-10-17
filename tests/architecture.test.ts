import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the dependency table in docs/ARCHITECTURE.md. A package may depend only on the
 * workspace packages listed for it. The engine must never reach a door, `presentation`, or `local`.
 */
const root = join(import.meta.dirname, '..');

const ENGINE = [
  '@hero-cloud/sdk',
  '@hero-cloud/core',
  '@hero-cloud/specification',
  '@hero-cloud/sources',
  '@hero-cloud/analyzer',
  '@hero-cloud/planner',
  '@hero-cloud/deployment',
  '@hero-cloud/provider-aws',
  '@hero-cloud/provider-ai',
  '@hero-cloud/plugin-sdk',
  '@hero-cloud/plugin-node',
  '@hero-cloud/plugin-container',
  '@hero-cloud/shared',
] as const;

const NON_ENGINE = [
  '@hero-cloud/presentation',
  '@hero-cloud/local',
  '@hero-cloud/server',
  '@hero-cloud/mcp',
  '@hero-cloud/cli',
  '@hero-cloud/studio',
  '@hero-cloud/web',
] as const;

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  '@hero-cloud/shared': [],
  '@hero-cloud/specification': [],
  '@hero-cloud/core': ['@hero-cloud/specification', '@hero-cloud/shared'],
  '@hero-cloud/plugin-sdk': ['@hero-cloud/core', '@hero-cloud/specification'],
  '@hero-cloud/sources': ['@hero-cloud/core', '@hero-cloud/shared'],
  '@hero-cloud/plugin-node': [
    '@hero-cloud/core',
    '@hero-cloud/analyzer', // development only: its tests run detectors through the analyzer
    '@hero-cloud/plugin-sdk',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/plugin-container': [
    '@hero-cloud/core',
    '@hero-cloud/analyzer', // development only: its tests run detectors through the analyzer
    '@hero-cloud/plugin-node', // development only: tests check it next to the Node detectors
    '@hero-cloud/plugin-sdk',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/analyzer': [
    '@hero-cloud/core',
    '@hero-cloud/plugin-sdk',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/planner': [
    '@hero-cloud/core',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
    // development only: planner tests build analyses from real fixtures
    '@hero-cloud/analyzer',
    '@hero-cloud/plugin-node',
  ],
  '@hero-cloud/deployment': ['@hero-cloud/core', '@hero-cloud/shared'],
  '@hero-cloud/provider-aws': [
    '@hero-cloud/core',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/provider-ai': [
    '@hero-cloud/core',
    '@hero-cloud/specification',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/sdk': [
    '@hero-cloud/core',
    '@hero-cloud/specification',
    '@hero-cloud/sources',
    '@hero-cloud/analyzer',
    '@hero-cloud/plugin-node',
    '@hero-cloud/plugin-container',
    '@hero-cloud/plugin-sdk',
    '@hero-cloud/planner',
    '@hero-cloud/deployment',
    '@hero-cloud/provider-aws',
    '@hero-cloud/provider-ai',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/presentation': [
    '@hero-cloud/core',
    '@hero-cloud/shared',
    '@hero-cloud/specification',
  ],
  '@hero-cloud/local': ['@hero-cloud/core', '@hero-cloud/presentation', '@hero-cloud/shared'],
  '@hero-cloud/server': [
    '@hero-cloud/sdk',
    '@hero-cloud/presentation',
    '@hero-cloud/local',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/mcp': [
    '@hero-cloud/sdk',
    '@hero-cloud/presentation',
    '@hero-cloud/local',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/cli': [
    '@hero-cloud/sdk',
    '@hero-cloud/presentation',
    '@hero-cloud/local',
    '@hero-cloud/server',
    '@hero-cloud/mcp',
    '@hero-cloud/shared',
  ],
  '@hero-cloud/studio': ['@hero-cloud/presentation'],
  '@hero-cloud/web': [],
};

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly internalDeps: readonly string[];
}

function listPackageDirs(): string[] {
  const dirs: string[] = [];
  const visit = (parent: string, depth: number): void => {
    for (const entry of readdirSync(parent)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const dir = join(parent, entry);
      if (!statSync(dir).isDirectory()) continue;
      try {
        statSync(join(dir, 'package.json'));
        dirs.push(dir);
      } catch {
        if (depth < 1) visit(dir, depth + 1);
      }
    }
  };
  visit(join(root, 'apps'), 0);
  visit(join(root, 'packages'), 0);
  visit(join(root, 'plugins'), 0);
  return dirs;
}

function loadPackages(): WorkspacePackage[] {
  return listPackageDirs().map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Development dependencies count too: tests must respect the same boundaries.
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies };
    return {
      name: pkg.name,
      dir,
      internalDeps: Object.keys(deps).filter((d) => d.startsWith('@hero-cloud/')),
    };
  });
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (['node_modules', 'dist', '.astro'].includes(entry)) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(ts|tsx|astro)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(path);
    }
  };
  visit(join(dir, 'src'));
  return out;
}

const packages = loadPackages();

describe('workspace architecture', () => {
  it('knows every workspace package', () => {
    const known = new Set(Object.keys(ALLOWED));
    for (const pkg of packages) {
      expect(known.has(pkg.name), `${pkg.name} is missing from the architecture table`).toBe(true);
    }
  });

  it.each(packages.map((p) => [p.name, p] as const))(
    '%s depends only on allowed workspace packages',
    (name, pkg) => {
      const allowed = ALLOWED[name] ?? [];
      const illegal = pkg.internalDeps.filter((dep) => !allowed.includes(dep));
      expect(illegal, `${name} may not depend on ${illegal.join(', ')}`).toEqual([]);
    },
  );

  it('never lets the engine depend on a door, presentation, or the local runtime', () => {
    for (const pkg of packages.filter((p) => (ENGINE as readonly string[]).includes(p.name))) {
      const forbidden = pkg.internalDeps.filter((d) =>
        (NON_ENGINE as readonly string[]).includes(d),
      );
      expect(forbidden, `${pkg.name} is engine and imports ${forbidden.join(', ')}`).toEqual([]);
    }
  });

  it('only imports workspace packages that it declares', () => {
    for (const pkg of packages) {
      const declared = new Set(pkg.internalDeps);
      for (const file of sourceFiles(pkg.dir)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/from\s+['"](@hero-cloud\/[a-z-]+)(?:\/[^'"]*)?['"]/g)) {
          const dep = match[1] ?? '';
          if (dep === pkg.name) continue;
          expect(
            declared.has(dep),
            `${relative(root, file)} imports ${dep} without declaring it`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps package entry points as the only public surface', () => {
    for (const pkg of packages) {
      for (const file of sourceFiles(pkg.dir)) {
        const text = readFileSync(file, 'utf8');
        expect(
          /from\s+['"]@hero-cloud\/[a-z-]+\/src\//.test(text),
          `${relative(root, file)} reaches into another package's src`,
        ).toBe(false);
      }
    }
  });
});
