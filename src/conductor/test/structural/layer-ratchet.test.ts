// Covers: task:1, task:2, task:3, task:4, task:5
import { describe, expect, it } from 'vitest';

import { checkLayerRatchet, decodeAllowlistName, encodeAllowlistName } from './layer-ratchet.js';

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

  it('ignores type-only imports, re-exports, and inline import types', () => {
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

    expect(result).toEqual({ scannedFileCount: 2, edges: [], violations: [] });
  });

  it('ignores an engine file that reaches ui only through a dynamic import', () => {
    const result = checkLayerRatchet({
      files: new Map([
        ['engine/a.ts', "await import('../ui/x.js');"],
        ['ui/x.ts', 'export {};'],
      ]),
      allowlist: [],
    });

    expect(result).toEqual({ scannedFileCount: 2, edges: [], violations: [] });
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
    ['a type-only back edge', new Map([
      ['engine/a.ts', "import './b.js';"],
      ['engine/b.ts', "import type { A } from './a.js';"],
    ])],
    ['a dynamic-import back edge', new Map([
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
  ])('round-trips allowlist names for %s and %s', (from, to) => {
    expect(decodeAllowlistName(encodeAllowlistName(from, to))).toEqual({ from, to });
  });

  it('encodes collision-prone file pairs differently', () => {
    expect(encodeAllowlistName('engine/a-b.ts', 'ui/c.ts')).not.toBe(
      encodeAllowlistName('engine/a/b.ts', 'ui/c.ts'),
    );
  });

  it.each([
    'not-an-edge.txt',
    'engine%2Fa.ts+ui%2Fb.ts+types%2Fc.ts.edge',
    '..%2Fx.ts+ui%2Fb.ts.edge',
    'engine%2fa.ts+ui%2Fb.ts.edge',
  ])('reports malformed allowlist entry %s', (entry) => {
    const result = checkLayerRatchet({ files: new Map(), allowlist: [entry] });

    expect(result.violations).toEqual([{ kind: 'malformed-entry', entry }]);
  });
});
