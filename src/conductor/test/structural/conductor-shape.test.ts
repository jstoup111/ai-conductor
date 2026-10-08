// Covers: task:1
import { describe, expect, it } from 'vitest';

import { checkConductorImports, checkConductorShape } from './conductor-shape-guard.js';

const ALLOWED_TUNABLES = [
  'MAX_RECOVERY_RETRIES',
  'MAX_RATE_LIMIT_DEADLINE_MS',
  'PUBLICATION_REDISPATCH_BUDGET',
  'MAX_GATE_SELECTIONS',
  'DONE_MARKER',
  'LOOP_HALT_MARKER',
];

const ALLOWED_IMPORTERS = new Set(['index.ts', 'daemon-cli.ts']);

describe('structural: conductor shape guard', () => {
  it.each([
    ['function', 'runNow', 'function runNow() {}'],
    ['const', 'NOT_A_TUNABLE', 'const NOT_A_TUNABLE = 1;'],
    ['export star', '*', "export * from './other.js';"],
    ['export default', 'default', 'export default 1;'],
    ['export assignment', 'x', 'export = x;'],
    ['local export', 'X', 'export { X };'],
    ['type', 'LocalType', 'type LocalType = string;'],
    ['interface', 'LocalInterface', 'interface LocalInterface {}'],
    ['enum', 'LocalEnum', 'enum LocalEnum { Value }'],
    ['namespace', 'LocalNamespace', 'namespace LocalNamespace {}'],
    ['declare', 'declaredValue', 'declare const declaredValue: string;'],
    ['let', 'mutableValue', 'let mutableValue = 1;'],
    ['var', 'legacyValue', 'var legacyValue = 1;'],
    ['class', 'NotConductor', 'class NotConductor {}'],
    ['expression statement', 'callMe', 'callMe();'],
  ])('rejects a top-level %s and reports its kind, name, and line', (kind, name, source) => {
    expect(checkConductorShape(source, ALLOWED_TUNABLES)).toContainEqual(expect.objectContaining({
      kind,
      name,
      line: 1,
    }));
  });

  it('accepts imports, named re-exports, the six tunables, and Conductor', () => {
    const source = [
      "import { dependency } from './dependency.js';",
      "export { value } from './value.js';",
      "export type { Value } from './value.js';",
      'export const MAX_RECOVERY_RETRIES = 1;',
      'const MAX_RATE_LIMIT_DEADLINE_MS = 2;',
      'const PUBLICATION_REDISPATCH_BUDGET = 3;',
      'const MAX_GATE_SELECTIONS = 4;',
      "const DONE_MARKER = 'done';",
      "const LOOP_HALT_MARKER = 'halt';",
      'class Conductor { dependency = dependency; }',
    ].join('\n');

    expect(checkConductorShape(source, ALLOWED_TUNABLES)).toEqual([]);
  });

  it.each([
    ['value import', "import { Conductor } from './conductor.js';"],
    ['type-only import', "import type { Conductor } from './conductor.js';"],
    ['double-quoted import', 'import { Conductor } from "./conductor.js";'],
  ])('rejects a non-destination module with a %s of conductor', (_label, statement) => {
    const violations = checkConductorImports({ 'engine/foo.ts': statement }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'engine/foo.ts',
      specifier: './conductor.js',
    }));
  });

  it.each([
    ['index.ts', 'buildRetryHint'],
    ['daemon-cli.ts', 'OperatorParkedTermination'],
  ])('rejects %s importing %s alongside Conductor', (file, extraName) => {
    const statement = `import { Conductor, ${extraName} } from './conductor.js';`;
    const violations = checkConductorImports({ [file]: statement }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file,
      names: [extraName],
    }));
  });

  it('rejects an allowed importer that aliases Conductor', () => {
    const violations = checkConductorImports({
      'index.ts': "import { Conductor as Runner } from './conductor.js';",
    }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'index.ts',
      names: ['Conductor as Runner'],
    }));
  });

  it('rejects a destination module that imports Conductor type-only', () => {
    const violations = checkConductorImports({
      'index.ts': "import type { Conductor } from './conductor.js';",
    }, ALLOWED_IMPORTERS);

    expect(violations).toContainEqual(expect.objectContaining({
      file: 'index.ts',
      specifier: './conductor.js',
    }));
  });

  it('accepts destination modules that import only Conductor by value', () => {
    expect(checkConductorImports({
      'index.ts': "import { Conductor } from './conductor.js';",
      'daemon-cli.ts': "import { Conductor } from './conductor.js';",
    }, ALLOWED_IMPORTERS)).toEqual([]);
  });

  it('ignores imports and re-exports whose source is not conductor', () => {
    expect(checkConductorImports({
      'engine/foo.ts': [
        "import { helper } from './helper.js';",
        "export { exportedHelper } from './exported-helper.js';",
      ].join('\n'),
    }, ALLOWED_IMPORTERS)).toEqual([]);
  });
});
