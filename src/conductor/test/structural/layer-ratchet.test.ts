// Covers: task:1, task:2, task:3, task:4, task:5, task:6, task:7, task:8
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { checkLayerRatchet, formatAllowlistEntry, formatRatchetViolations, isForbiddenLayerEdge, parseAllowlistEntry, readAllowlistEntries } from './layer-ratchet.js';

const structuralDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(structuralDirectory, '../../src');
const allowlistFile = join(structuralDirectory, 'layer-allowlist.txt');

async function sourceFiles(directory = sourceDirectory): Promise<Map<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? new Map([[relative(sourceDirectory, path), await readFile(path, 'utf8')]]) : new Map();
  }));
  return new Map(nested.flatMap((files) => [...files]));
}

describe('structural: layer ratchet', () => {
  it('resolves .js specifiers to sibling TypeScript files', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import './sibling.js';"],
        ['engine/sibling.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result).toEqual({
      scannedFileCount: 2,
      edges: [{ file: 'engine/a.ts', imported: 'engine/sibling.ts', line: 1 }],
      violations: [],
    });
  });

  it.each([
    ['./dir/index.js'],
    ['./dir'],
  ])('resolves %s to a directory index TypeScript file', (specifier) => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', `import '${specifier}';`],
        ['engine/dir/index.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result).toEqual({
      scannedFileCount: 2,
      edges: [{ file: 'engine/a.ts', imported: 'engine/dir/index.ts', line: 1 }],
      violations: [],
    });
  });

  it('ignores package and node specifiers', () => {
    const result = checkLayerRatchet({
      files: new Map([['engine/a.ts', "import 'typescript';\nimport 'node:fs';"]]),
      allowlist: [],
    });

    expect(result).toEqual({ scannedFileCount: 1, edges: [], violations: [] });
  });

  it('reports files outside a known layer', () => {
    const result = checkLayerRatchet({
      files: new Map([['misc/x.ts', 'export {};']]),
      allowlist: [],
    });

    expect(result).toEqual({
      scannedFileCount: 1,
      edges: [],
      violations: [{ kind: 'unclassifiable-file', file: 'misc/x.ts' }],
    });
  });

  it.each([
    ['./missing.js'],
    ['../../outside.js'],
  ])('reports unresolved relative specifier %s without recording an edge', (specifier) => {
    const result = checkLayerRatchet({
      files: new Map([['engine/a.ts', `import '${specifier}';`]]),
      allowlist: [],
    });

    expect(result).toEqual({
      scannedFileCount: 1,
      edges: [],
      violations: [{
        kind: 'unresolved-specifier',
        file: 'engine/a.ts',
        line: 1,
        specifier,
      }],
    });
  });

  it('allows downward, entry-to-entry, tools-to-engine/types, and same-layer imports', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import '../execution/e.js';\nimport '../types/t.js';\nimport './sibling.js';"],
        ['engine/sibling.ts', 'export {};'],
        ['execution/e.ts', 'export {};'],
        ['types/t.ts', 'export {};'],
        ['ui/a.ts', "import '../execution/e.js';"],
        ['index.ts', "import './cli.js';"],
        ['cli.ts', 'export {};'],
        ['tools/a.ts', "import '../engine/a.js';\nimport '../types/t.js';"],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([]);
  });

  it('reports an engine value import from ui as upward', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import '../ui/b.js';"],
        ['ui/b.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([{
      kind: 'upward',
      file: 'engine/a.ts',
      line: 1,
      imported: 'ui/b.ts',
      edge: 'engine -> ui',
    }]);
  });

  it.each([
    ['engine/a.ts', "import '../cli-defaults.js';", 'cli-defaults.ts', 'engine -> entry'],
    ['types/a.ts', "import '../execution/b.js';", 'execution/b.ts', 'types -> execution'],
  ])('reports %s -> %s as upward', (file, source, imported, edge) => {
    const result = checkLayerRatchet({
      files: new Map([
        [file, source],
        [imported, 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([{
      kind: 'upward',
      file,
      line: 1,
      imported,
      edge,
    }]);
  });

  it('reports forbidden edges to tools and from tools', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import '../tools/t.js';"],
        ['tools/t.ts', 'export {};'],
        ['tools/a.ts', "import '../ui/u.js';\nimport '../execution/e.js';"],
        ['ui/u.ts', 'export {};'],
        ['execution/e.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      {
        kind: 'upward',
        file: 'engine/a.ts',
        line: 1,
        imported: 'tools/t.ts',
        edge: 'engine -> tools',
      },
      {
        kind: 'upward',
        file: 'tools/a.ts',
        line: 1,
        imported: 'ui/u.ts',
        edge: 'tools -> ui',
      },
      {
        kind: 'upward',
        file: 'tools/a.ts',
        line: 2,
        imported: 'execution/e.ts',
        edge: 'tools -> execution',
      },
    ]);
  });

  it('reports type-only imports, re-exports, and inline import types as upward edges', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['types/a.ts', [
          "import type { A } from '../engine/x.js';",
          "import { type A, type B } from '../engine/x.js';",
          "export type { A } from '../engine/x.js';",
          "export { type A } from '../engine/x.js';",
          "type X = import('../engine/x.js').X;",
        ].join('\n')],
        ['engine/x.ts', 'export type A = string; export type B = string; export type X = string;'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'upward', file: 'types/a.ts', line: 1, edge: 'types -> engine' }),
    ]);
  });

  it('reports an engine file that reaches ui through a dynamic import', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "await import('../ui/x.js');"],
        ['ui/x.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([{
      kind: 'upward', file: 'engine/a.ts', line: 1, imported: 'ui/x.ts', edge: 'engine -> ui',
    }]);
  });

  it('reports an execution value re-export from engine as upward', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['execution/a.ts', "export { name } from '../engine/x.js';"],
        ['engine/x.ts', 'export const name = 1;'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([{
      kind: 'upward',
      file: 'execution/a.ts',
      line: 1,
      imported: 'engine/x.ts',
      edge: 'execution -> engine',
    }]);
  });

  it.each([
    ['side-effect import', "import '../ui/x.js';"],
    ['mixed named import', "import { type A, b } from '../ui/x.js';"],
  ])('reports an engine %s from ui as upward', (_description, source) => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', source],
        ['ui/x.ts', 'export type A = string; export const b = 1;'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([{
      kind: 'upward',
      file: 'engine/a.ts',
      line: 1,
      imported: 'ui/x.ts',
      edge: 'engine -> ui',
    }]);
  });

  it('treats default and namespace imports as value edges', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/default.ts', "import value from '../ui/default.js';"],
        ['ui/default.ts', 'export default 1;'],
        ['engine/namespace.ts', "import * as values from '../ui/namespace.js';"],
        ['ui/namespace.ts', 'export const value = 1;'],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      {
        kind: 'upward',
        file: 'engine/default.ts',
        line: 1,
        imported: 'ui/default.ts',
        edge: 'engine -> ui',
      },
      {
        kind: 'upward',
        file: 'engine/namespace.ts',
        line: 1,
        imported: 'ui/namespace.ts',
        edge: 'engine -> ui',
      },
    ]);
  });

  it('records conductor value re-exports as same-layer edges', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/conductor.ts', "export { a } from './a.js';\nexport { b } from './b.js';"],
        ['engine/a.ts', 'export const a = 1;'],
        ['engine/b.ts', 'export const b = 1;'],
      ]),
      allowlist: [],
    });

    expect(result).toEqual({
      scannedFileCount: 3,
      edges: [
        { file: 'engine/conductor.ts', imported: 'engine/a.ts', line: 1 },
        { file: 'engine/conductor.ts', imported: 'engine/b.ts', line: 2 },
      ],
      violations: [],
    });
  });

  it.each([
    ['an acyclic chain', new Map([
      ['engine/a.ts', "import './b.js';"],
      ['engine/b.ts', "import './c.js';"],
      ['engine/c.ts', 'export {};'],
    ])],
    ['a type-only back edge in one layer', new Map([
      ['engine/a.ts', "import './b.js';"],
      ['engine/b.ts', "import type { A } from './a.js';"],
    ])],
    ['a dynamic-import back edge in one layer', new Map([
      ['engine/a.ts', "import './b.js';"],
      ['engine/b.ts', "await import('./a.js');"],
    ])],
  ])('reports no violations for %s', (_description, files) => {
    const result = checkLayerRatchet({ files, allowlist: [] });

    expect(result.violations).toEqual([]);
  });

  it('reports both edges in a two-file value-import cycle', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import './b.js';"],
        ['engine/b.ts', "import './a.js';"],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      {
        kind: 'cycle',
        file: 'engine/a.ts',
        line: 1,
        imported: 'engine/b.ts',
        cycle: ['engine/a.ts', 'engine/b.ts'],
      },
      {
        kind: 'cycle',
        file: 'engine/b.ts',
        line: 1,
        imported: 'engine/a.ts',
        cycle: ['engine/a.ts', 'engine/b.ts'],
      },
    ]);
  });

  it('reports every edge in a cycle closed by a value re-export', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "import './b.js';"],
        ['engine/b.ts', "import './c.js';"],
        ['engine/c.ts', "export { x } from './a.js';"],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      {
        kind: 'cycle',
        file: 'engine/a.ts',
        line: 1,
        imported: 'engine/b.ts',
        cycle: ['engine/a.ts', 'engine/b.ts', 'engine/c.ts'],
      },
      {
        kind: 'cycle',
        file: 'engine/b.ts',
        line: 1,
        imported: 'engine/c.ts',
        cycle: ['engine/a.ts', 'engine/b.ts', 'engine/c.ts'],
      },
      {
        kind: 'cycle',
        file: 'engine/c.ts',
        line: 1,
        imported: 'engine/a.ts',
        cycle: ['engine/a.ts', 'engine/b.ts', 'engine/c.ts'],
      },
    ]);
  });

  it('reports upward and cycle violations for a cross-layer cycle', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/x.ts', "import '../ui/y.js';"],
        ['ui/y.ts', "import '../engine/x.js';"],
      ]),
      allowlist: [],
    });

    expect(result.violations).toEqual([
      {
        kind: 'upward',
        file: 'engine/x.ts',
        line: 1,
        imported: 'ui/y.ts',
        edge: 'engine -> ui',
      },
      {
        kind: 'cycle',
        file: 'engine/x.ts',
        line: 1,
        imported: 'ui/y.ts',
        cycle: ['engine/x.ts', 'ui/y.ts'],
      },
      {
        kind: 'cycle',
        file: 'ui/y.ts',
        line: 1,
        imported: 'engine/x.ts',
        cycle: ['engine/x.ts', 'ui/y.ts'],
      },
    ]);
  });

  it.each([
    ['engine/conductor.ts', 'ui/events.ts'],
    ['engine/engineer/intake/x.ts', 'cli.ts'],
  ])('round-trips allowlist entries for %s and %s', (from, to) => {
    expect(formatAllowlistEntry(from, to)).toBe(`${from} -> ${to}`);
    expect(parseAllowlistEntry(formatAllowlistEntry(from, to))).toEqual({ from, to });
  });

  it.each([
    'engine/a.ts ui/b.ts',
    'engine/a.ts -> ui/b.ts -> types/c.ts',
    '../x.ts -> ui/b.ts',
    'engine/a.ts  ->  ui/b.ts',
    'engine/a.js -> ui/b.ts',
    'engine/./a.ts -> ui/b.ts',
  ])('reports malformed allowlist entry %s', (entry) => {
    const result = checkLayerRatchet({ files: new Map(), allowlist: [entry] });

    expect(result.violations).toEqual([{ kind: 'malformed-entry', entry }]);
  });

  it.each([
    ['a duplicate', ['engine/a.ts -> ui/b.ts', 'engine/a.ts -> ui/b.ts']],
    ['an out-of-order entry', ['engine/b.ts -> ui/b.ts', 'engine/a.ts -> ui/b.ts']],
  ])('reports %s as malformed so the file stays sorted and unique', (_description, allowlist) => {
    const files = new Map([['engine/a.ts', "import '../ui/b.js';"], ['engine/b.ts', "import '../ui/b.js';"], ['ui/b.ts', '']]);

    expect(checkLayerRatchet({ files, allowlist }).violations).toContainEqual({ kind: 'malformed-entry', entry: allowlist[1] });
  });

  it('reads allowlist entries while skipping blank lines and # comments', () => {
    expect(readAllowlistEntries('# header\n\nengine/a.ts -> ui/b.ts\n# note\nengine/c.ts -> ui/d.ts\n'))
      .toEqual(['engine/a.ts -> ui/b.ts', 'engine/c.ts -> ui/d.ts']);
  });

  it.each([
    ['an upward edge', new Map([['engine/a.ts', "import '../ui/b.js';"], ['ui/b.ts', '']]), [formatAllowlistEntry('engine/a.ts', 'ui/b.ts')]],
    ['a same-layer cycle', new Map([['engine/a.ts', "import './b.js';"], ['engine/b.ts', "import './a.js';"]]), [formatAllowlistEntry('engine/a.ts', 'engine/b.ts'), formatAllowlistEntry('engine/b.ts', 'engine/a.ts')]],
    ['duplicate imports of one pair', new Map([['engine/a.ts', "import '../ui/b.js';\nimport '../ui/b.js';"], ['ui/b.ts', '']]), [formatAllowlistEntry('engine/a.ts', 'ui/b.ts')]],
  ])('covers %s with allowlist entries', (_description, files, allowlist) => {
    expect(checkLayerRatchet({ files, allowlist }).violations).toEqual([]);
  });

  it('reports only an unlisted edge inside an otherwise allowlisted cycle', () => {
    const result = checkLayerRatchet({ files: new Map([
      ['engine/a.ts', "import './b.js';\nimport './c.js';"], ['engine/b.ts', "import './c.js';"], ['engine/c.ts', "import './a.js';"],
    ]), allowlist: [formatAllowlistEntry('engine/a.ts', 'engine/b.ts'), formatAllowlistEntry('engine/b.ts', 'engine/c.ts'), formatAllowlistEntry('engine/c.ts', 'engine/a.ts')] });
    expect(result.violations).toEqual([expect.objectContaining({ kind: 'cycle', file: 'engine/a.ts', imported: 'engine/c.ts' })]);
  });

  it('formats an unlisted upward violation with the allowlist entry that would cover it', () => {
    const result = checkLayerRatchet({ files: new Map([['engine/a.ts', "import '../ui/b.js';"], ['ui/b.ts', '']]), allowlist: [] });
    expect(formatRatchetViolations(result.violations)).toContain(formatAllowlistEntry('engine/a.ts', 'ui/b.ts'));
  });

  it('formats a stale entry with its allowlist line', () => {
    const entry = formatAllowlistEntry('engine/a.ts', 'ui/b.ts');
    const result = checkLayerRatchet({ files: new Map([['engine/a.ts', ''], ['ui/b.ts', '']]), allowlist: [entry] });

    expect(formatRatchetViolations(result.violations)).toContain(entry);
  });

  it('reports edge-missing for a removed import', () => {
    const entry = formatAllowlistEntry('engine/a.ts', 'ui/b.ts');
    expect(checkLayerRatchet({ files: new Map([['engine/a.ts', ''], ['ui/b.ts', 'export type B = string;']]), allowlist: [entry] }).violations)
      .toEqual([{ kind: 'stale-entry', entry, reason: 'edge-missing' }]);
  });

  it('reports not-a-violation after a two-file cycle is broken', () => {
    const entry = formatAllowlistEntry('engine/a.ts', 'engine/b.ts');
    expect(checkLayerRatchet({ files: new Map([['engine/a.ts', "import './b.js';"], ['engine/b.ts', '']]), allowlist: [entry] }).violations)
      .toEqual([{ kind: 'stale-entry', entry, reason: 'not-a-violation' }]);
  });

  it('reports every freed entry after a four-file cycle is broken', () => {
    const entries = [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([from, to]) => formatAllowlistEntry(`engine/${from}.ts`, `engine/${to}.ts`));
    const result = checkLayerRatchet({ files: new Map([
      ['engine/a.ts', "import './b.js';"], ['engine/b.ts', "import './c.js';"], ['engine/c.ts', "import './d.js';"], ['engine/d.ts', ''],
    ]), allowlist: entries });
    expect(result.violations).toEqual(entries.map((entry) => ({ kind: 'stale-entry', entry, reason: 'not-a-violation' })));
  });

  it('ratchets the real source tree against the committed allowlist', async () => {
    const entries = readAllowlistEntries(await readFile(allowlistFile, 'utf8'));
    const result = checkLayerRatchet({ files: await sourceFiles(), allowlist: entries });

    expect(result.scannedFileCount).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
    expect(result.violations, formatRatchetViolations(result.violations)).toEqual([]);
  });

  // Covers: task:15
  it('contains no upward-edge entries in the committed allowlist', async () => {
    const entries = readAllowlistEntries(await readFile(allowlistFile, 'utf8'));
    const upwardEntries = entries.filter((entry) => {
      const pair = parseAllowlistEntry(entry);
      return pair !== undefined && isForbiddenLayerEdge(pair.from, pair.to);
    });

    expect(upwardEntries).toEqual([]);
  });
});
