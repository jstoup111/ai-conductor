// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';

import { checkLayerRatchet } from './layer-ratchet.js';

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
});
