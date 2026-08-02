import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/engine/config.js';
import {
  resolveLayer2Applicability,
  buildImportGraph,
  reachableFromRoots,
  checkExportReachability,
  computeWiringEvidence,
  findSameFileSymbolReference,
} from '../src/engine/wiring-probe.js';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as ts from 'typescript';

describe('wiring.entry_points config parsing', () => {
  it('parses a wiring.entry_points list of repo-relative paths', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-config-'));
    try {
      await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
      const configYaml = `wiring:\n  entry_points:\n    - src/conductor/src/index.ts\n    - bin/conduct\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.wiring?.entry_points).toEqual([
        'src/conductor/src/index.ts',
        'bin/conduct',
      ]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('resolveLayer2Applicability', () => {
  async function makeTsProject(): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-ts-project-'));
    await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
    await writeFile(join(tmpDir, 'package.json'), '{}');
    return tmpDir;
  }

  it('is not applicable for a project with no tsconfig.json/package.json', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-non-ts-'));
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('not-applicable');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('is skipped for a TS project missing wiring.entry_points config', async () => {
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('skipped');
      if (result.reason !== 'skipped') return;
      expect(result.message).toBe('Layer 2 skipped: wiring.entry_points not configured');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not affect Layer 1 pass/fail when Layer 2 is skipped', async () => {
    // Layer 2 skip is purely a degradation classification; it carries no
    // gate verdict of its own, so a skipped result must never assert
    // pass/fail — Layer 1's verdict is computed independently elsewhere.
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      expect('satisfied' in result).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('is applicable with resolved roots when entry_points are configured and exist', async () => {
    const tmpDir = await makeTsProject();
    try {
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'index.ts'), 'export {};');
      const result = await resolveLayer2Applicability(
        { wiring: { entry_points: ['src/index.ts'] } },
        tmpDir,
      );
      expect(result.applicable).toBe(true);
      if (!result.applicable) return;
      expect(result.roots).toEqual(['src/index.ts']);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports satisfied:false naming the bad root when a configured entry point does not exist on disk', async () => {
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability(
        { wiring: { entry_points: ['src/bad/path.ts'] } },
        tmpDir,
      );
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('bad-root');
      if (result.reason !== 'bad-root') return;
      expect(result.satisfied).toBe(false);
      expect(result.message).toBe(
        'wiring.entry_points root "src/bad/path.ts" does not exist',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('buildImportGraph / reachableFromRoots', () => {
  async function makeFixtureProject(): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-import-graph-'));
    await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(
      join(tmpDir, 'src', 'root.ts'),
      "import { a } from './a.js';\nexport const rootValue = a;\n",
    );
    await writeFile(
      join(tmpDir, 'src', 'a.ts'),
      "import { b } from './b.js';\nexport const a = b;\n",
    );
    await writeFile(join(tmpDir, 'src', 'b.ts'), 'export const b = 1;\n');
    return tmpDir;
  }

  it('builds a module import graph transitively from configured roots', async () => {
    const tmpDir = await makeFixtureProject();
    try {
      const rootFile = join(tmpDir, 'src', 'root.ts');
      const graph = buildImportGraph([rootFile], tmpDir);

      const aFile = join(tmpDir, 'src', 'a.ts');
      const bFile = join(tmpDir, 'src', 'b.ts');

      expect(graph.has(rootFile)).toBe(true);
      expect(graph.get(rootFile)).toContain(aFile);
      expect(graph.has(aFile)).toBe(true);
      expect(graph.get(aFile)).toContain(bFile);
      expect(graph.has(bFile)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports a transitively-imported module as reachable from roots with the chain as evidence', async () => {
    const tmpDir = await makeFixtureProject();
    try {
      const rootFile = join(tmpDir, 'src', 'root.ts');
      const aFile = join(tmpDir, 'src', 'a.ts');
      const bFile = join(tmpDir, 'src', 'b.ts');

      const graph = buildImportGraph([rootFile], tmpDir);
      const result = reachableFromRoots(graph, [rootFile], bFile);

      expect(result.reachable).toBe(true);
      expect(result.chain).toEqual([rootFile, aFile, bFile]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('follows a dynamic import() edge nested inside a function body, not just top-level static imports', async () => {
    // Regression for the as-built architecture review (2026-07-13): a root
    // that reaches a subtree only via `await import('./lazy.js')` (e.g.
    // src/index.ts's lazy daemon-cli.ts load) must not be structurally
    // disconnected from the graph — buildImportGraph must recurse into
    // function bodies/conditionals to find CallExpression-form dynamic
    // imports, not just forEachChild's top-level declarations.
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-dynamic-import-'));
    try {
      await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(
        join(tmpDir, 'src', 'root.ts'),
        [
          'export async function maybeLoad(flag: boolean) {',
          '  if (flag) {',
          "    const { lazyValue } = await import('./lazy.js');",
          '    return lazyValue;',
          '  }',
          '  return null;',
          '}',
          '',
        ].join('\n'),
      );
      await writeFile(join(tmpDir, 'src', 'lazy.ts'), 'export const lazyValue = 1;\n');

      const rootFile = join(tmpDir, 'src', 'root.ts');
      const lazyFile = join(tmpDir, 'src', 'lazy.ts');
      const graph = buildImportGraph([rootFile], tmpDir);

      expect(graph.get(rootFile)).toContain(lazyFile);
      const result = reachableFromRoots(graph, [rootFile], lazyFile);
      expect(result.reachable).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('checkExportReachability — orphan islands and test-only edges', () => {
  it('exposes the shortest repo-relative root chain for a reachable export', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-reachable-export-chain-'));
    try {
      await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(
        join(tmpDir, 'src', 'root.ts'),
        [
          "import { detour } from './detour.js';",
          "import { a } from './a.js';",
          'export const rootValue = detour + a;',
          '',
        ].join('\n'),
      );
      await writeFile(
        join(tmpDir, 'src', 'detour.ts'),
        "import { bridge } from './bridge.js';\nexport const detour = bridge;\n",
      );
      await writeFile(
        join(tmpDir, 'src', 'bridge.ts'),
        "import { b } from './b.js';\nexport const bridge = b;\n",
      );
      await writeFile(
        join(tmpDir, 'src', 'a.ts'),
        "import { b } from './b.js';\nexport const a = b;\n",
      );
      await writeFile(join(tmpDir, 'src', 'b.ts'), 'export const b = 1;\n');

      const results = checkExportReachability(
        [{ file: 'src/b.ts', symbol: 'b' }],
        ['src/root.ts'],
        tmpDir,
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        reachable: true,
        reachableFromRoots: ['src/root.ts', 'src/a.ts', 'src/b.ts'],
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports an orphan island (modules that import each other but are unreachable from any root) as unreachable', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-orphan-island-'));
    try {
      await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'root.ts'), 'export const rootValue = 1;\n');
      await writeFile(
        join(tmpDir, 'src', 'islandA.ts'),
        "import { b } from './islandB.js';\nexport const a = b;\n",
      );
      await writeFile(
        join(tmpDir, 'src', 'islandB.ts'),
        "import { a } from './islandA.js';\nexport const b = a;\n",
      );

      const roots = ['src/root.ts'];
      const results = checkExportReachability(
        [{ file: 'src/islandA.ts', symbol: 'a' }],
        roots,
        tmpDir,
      );

      expect(results).toHaveLength(1);
      expect(results[0].reachable).toBe(false);
      expect(results[0].message).toBe(
        `«a» exported but unreachable from any entry point (roots: ${roots.join(', ')})`,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats a module reachable only through a test file import as unreachable', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-test-only-edge-'));
    try {
      await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(
        join(tmpDir, 'src', 'root.ts'),
        "import './foo.test.js';\nexport const rootValue = 1;\n",
      );
      await writeFile(
        join(tmpDir, 'src', 'foo.test.ts'),
        "import { barValue } from './bar.js';\nexport const usesBar = barValue;\n",
      );
      await writeFile(join(tmpDir, 'src', 'bar.ts'), 'export const barValue = 1;\n');

      const roots = ['src/root.ts'];
      const results = checkExportReachability(
        [{ file: 'src/bar.ts', symbol: 'barValue' }],
        roots,
        tmpDir,
      );

      expect(results).toHaveLength(1);
      expect(results[0].reachable).toBe(false);
      expect(results[0].message).toBe(
        `«barValue» exported but unreachable from any entry point (roots: ${roots.join(', ')})`,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('computeWiringEvidence — TypeScript analysis context', () => {
  it('constructs one compiler program for multiple Layer 2 exports in one probe run', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-analysis-context-'));
    try {
      await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(
        join(tmpDir, 'src', 'root.ts'),
        "import { a } from './a.js';\nimport { b } from './b.js';\nexport const root = a + b;\n",
      );
      await writeFile(join(tmpDir, 'src', 'a.ts'), 'export const a = 1;\n');
      await writeFile(join(tmpDir, 'src', 'b.ts'), 'export const b = 2;\n');
      const planPath = join(tmpDir, 'plan.md');
      await writeFile(
        planPath,
        [
          '### Task 1: Add exports',
          '**Files:** src/a.ts, src/b.ts',
          '**Wired-into:** src/root.ts#root',
          '',
        ].join('\n'),
      );

      let constructions = 0;
      await computeWiringEvidence({
        runGit: async (args: string[]) => {
          if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'head' };
          if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: '' };
          if (args[0] === 'diff') {
            return {
              stdout: [
                'diff --git a/src/a.ts b/src/a.ts',
                '+++ b/src/a.ts',
                '+export const a = 1;',
                'diff --git a/src/b.ts b/src/b.ts',
                '+++ b/src/b.ts',
                '+export const b = 2;',
              ].join('\n'),
            };
          }
          if (args[0] === 'grep') return { stdout: 'src/root.ts\n' };
          return { stdout: '' };
        },
        projectRoot: tmpDir,
        planPath,
        config: { wiring: { entry_points: ['src/root.ts'] } },
        gh: async () => {
          throw new Error('gh should not be called');
        },
        anchor: 'base',
        compilerProgramFactory: (roots, compilerOptions, host) => {
          constructions++;
          return ts.createProgram(roots, compilerOptions, host);
        },
      });

      expect(constructions).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('findSameFileSymbolReference', () => {
  it('returns identity evidence when a top-level caller references the exact exported helper', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-symbol-reference-'));
    try {
      const sourcePath = join(tmpDir, 'composition.ts');
      await writeFile(
        sourcePath,
        [
          'export function helper(): string {',
          "  return 'ok';",
          '}',
          '',
          'export function compose(): string {',
          '  return helper();',
          '}',
          '',
        ].join('\n'),
      );
      const program = ts.createProgram([sourcePath], { noEmit: true });

      const evidence = findSameFileSymbolReference(
        program,
        program.getTypeChecker(),
        sourcePath,
        'compose',
        'helper',
      );

      expect(evidence).toEqual({
        file: sourcePath,
        caller: 'compose',
        export: 'helper',
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'comment', prefix: '', callerBody: '// helper\n  return \'ok\';' },
    { name: 'string', prefix: '', callerBody: "return 'helper';" },
    { name: 'declaration', prefix: '', callerBody: "const helper = 'local';\n  return helper;" },
    {
      name: 'import',
      prefix: "import { helper as importedHelper } from './other.js';\n\n",
      callerBody: "return 'ok';",
    },
  ])('returns no proof when the helper name occurs only in a $name', async ({ prefix, callerBody }) => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-symbol-lookalike-'));
    try {
      const sourcePath = join(tmpDir, 'composition.ts');
      await writeFile(
        sourcePath,
        [
          prefix,
          'export function helper(): string {',
          "  return 'ok';",
          '}',
          '',
          'export function compose(): string {',
          `  ${callerBody}`,
          '}',
          '',
        ].join('\n'),
      );
      const program = ts.createProgram([sourcePath], { noEmit: true });

      expect(
        findSameFileSymbolReference(
          program,
          program.getTypeChecker(),
          sourcePath,
          'compose',
          'helper',
        ),
      ).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
