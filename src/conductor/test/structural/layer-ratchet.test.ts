// Covers: task:1
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
});
