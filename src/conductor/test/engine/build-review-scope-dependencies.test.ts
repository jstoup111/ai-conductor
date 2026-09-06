// Covers: task:7
import { describe, expect, it } from 'vitest';
import { discoverBuildReviewScopeDependencies } from '../../src/engine/build-review-scope-dependencies.js';
import { analyzeBuildReviewTestScope } from '../../src/engine/build-review-test-scope.js';

const storiesText = `
## Story 3: Shared changes

#### Happy Path
- Given an opted-in test, when a local helper changes, then the effect is retained
`;

describe('build-review local dependency scope', () => {
  it('keeps a plan-seeded changed helper as a candidate only with the test local Covers binding', async () => {
    const base = new Map([
      ['test/orders.test.ts', "import { order } from '../src/order-helper';\n// Covers: S3.1\nit('uses order helper', () => { expect(order()).toBe('base'); });\n"],
      ['src/order-helper.ts', "export const order = () => 'base';\n"],
    ]);
    const head = new Map([
      ['test/orders.test.ts', "import { order } from '../src/order-helper';\n// Covers: S3.1\nit('uses order helper', () => { expect(order()).toBe('base'); });\n"],
      ['src/order-helper.ts', "export const order = () => 'changed';\n"],
    ]);
    const dependencies = await discoverBuildReviewScopeDependencies({
      reader: { read: async (side, path) => (side === 'base' ? base : head).get(path) },
      changedTestPaths: [],
      planText: '### Task 7: dependencies\n**Files:** test/orders.test.ts\n',
    });
    const result = analyzeBuildReviewTestScope({
      base: {
        source: { fileName: 'test/orders.test.ts', bytes: Buffer.from(base.get('test/orders.test.ts')!) },
        storiesText,
        planText: '### Task 7: dependencies\n**Files:** test/orders.test.ts\n',
      },
      head: {
        source: { fileName: 'test/orders.test.ts', bytes: Buffer.from(head.get('test/orders.test.ts')!) },
        storiesText,
        planText: '### Task 7: dependencies\n**Files:** test/orders.test.ts\n',
      },
      dependencyEffects: dependencies.effects,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates).toMatchObject([{
      declaration: { titleChain: ['uses order helper'] },
      markers: [{ reference: { id: 'S3.1' } }],
      reasons: ['affected-dependency'],
      affectedDependency: {
        seed: { source: { fileName: 'test/orders.test.ts' } },
        chain: [{}, { source: { fileName: 'src/order-helper.ts' } }],
      },
    }]);
  });

  it('does not turn a plan path alone into authority for an unmarked helper consumer', async () => {
    const base = new Map([
      ['test/unmarked.test.ts', "import { value } from '../src/helper';\nit('uses helper', () => expect(value()).toBe('base'));\n"],
      ['src/helper.ts', "export const value = () => 'base';\n"],
    ]);
    const head = new Map([
      ['test/unmarked.test.ts', base.get('test/unmarked.test.ts')!],
      ['src/helper.ts', "export const value = () => 'changed';\n"],
    ]);
    const dependencies = await discoverBuildReviewScopeDependencies({
      reader: { read: async (side, path) => (side === 'base' ? base : head).get(path) },
      changedTestPaths: [],
      planText: '### Task 7: dependencies\n**Files:** test/unmarked.test.ts\n',
    });
    const result = analyzeBuildReviewTestScope({
      base: { source: { fileName: 'test/unmarked.test.ts', bytes: Buffer.from(base.get('test/unmarked.test.ts')!) }, storiesText, planText: '### Task 7: dependencies\n' },
      head: { source: { fileName: 'test/unmarked.test.ts', bytes: Buffer.from(head.get('test/unmarked.test.ts')!) }, storiesText, planText: '### Task 7: dependencies\n' },
      dependencyEffects: dependencies.effects,
    });

    expect(result.candidates).toEqual([]);
  });

  it('keeps one helper candidate for a suite-owned binding instead of enumerating unchanged descendants', () => {
    const source = `// Covers: S3.1
describe('orders', () => {
  it('creates', () => { expect(true).toBe(true); });
  it('cancels', () => { expect(true).toBe(true); });
});
`;
    const result = analyzeBuildReviewTestScope({
      base: { source: { fileName: 'test/orders.test.ts', bytes: Buffer.from(source) }, storiesText, planText: '### Task 7: dependencies\n' },
      head: { source: { fileName: 'test/orders.test.ts', bytes: Buffer.from(source) }, storiesText, planText: '### Task 7: dependencies\n' },
      dependencyEffects: [{
        seed: { source: { fileName: 'test/orders.test.ts', side: 'head' } },
        chain: [{ source: { fileName: 'test/orders.test.ts', side: 'head' } }, { source: { fileName: 'src/order-helper.ts', side: 'head' } }],
        changedSources: [{ source: { fileName: 'src/order-helper.ts', side: 'head' } }],
      }],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates).toMatchObject([{
      declaration: { kind: 'suite', titleChain: ['orders'] },
      markers: [{ reference: { id: 'S3.1' } }],
      reasons: ['affected-dependency'],
    }]);
  });

  it('resolves require through an explicit local index path and ignores an unused plan seed', async () => {
    const base = new Map([
      ['test/require.test.ts', "const { value } = require('../src/box');\n"],
      ['src/box/index.ts', "exports.value = 'base';\n"],
    ]);
    const head = new Map([
      ...base,
      ['src/box/index.ts', "exports.value = 'changed';\n"],
    ]);
    const result = await discoverBuildReviewScopeDependencies({
      reader: { read: async (side, path) => (side === 'base' ? base : head).get(path) },
      changedTestPaths: [],
      planText: '### Task 7: dependencies\n**Files:** test/require.test.ts, test/missing.test.ts\n',
    });

    expect(result).toMatchObject({
      effects: [{
        seed: { source: { fileName: 'test/require.test.ts' } },
        chain: [{}, { source: { fileName: 'src/box/index.ts' } }],
      }],
      uncertainties: [],
    });
  });

  it('keeps ambiguous local resolution as bounded uncertainty instead of guessing a helper candidate', async () => {
    const testSource = "import { helper } from '../src/helper';\n";
    const base = new Map([
      ['test/ambiguous.test.ts', testSource],
      ['src/helper.ts', 'export const helper = 1;\n'],
      ['src/helper.js', 'export const helper = 1;\n'],
    ]);
    const head = new Map([
      ...base,
      ['src/helper.ts', 'export const helper = 2;\n'],
    ]);
    const result = await discoverBuildReviewScopeDependencies({
      reader: { read: async (side, path) => (side === 'base' ? base : head).get(path) },
      changedTestPaths: ['test/ambiguous.test.ts'],
      planText: '### Task 7: dependencies\n',
    });

    expect(result).toMatchObject({
      effects: [],
      uncertainties: [{ kind: 'ambiguous-resolution', source: { source: { fileName: 'test/ambiguous.test.ts' } } }],
    });
  });

  it('memoizes shared blobs, stops a local dependency cycle, and leaves dynamic edges as uncertainty', async () => {
    const base = new Map([
      ['test/first.test.ts', "import { helper } from '../src/a';\n"],
      ['test/second.test.ts', "import { helper } from '../src/a';\n"],
      ['src/a.ts', "import { helper } from './b';\nexport { helper };\n"],
      ['src/b.ts', "import { again } from './a';\nexport const helper = () => again;\n"],
      ['test/dynamic.test.ts', "import('../src/maybe');\n"],
    ]);
    const head = new Map([
      ...base,
      ['src/b.ts', "import { again } from './a';\nexport const helper = () => 'changed';\n"],
    ]);
    const reads: string[] = [];
    const result = await discoverBuildReviewScopeDependencies({
      reader: {
        read: async (side, path) => {
          reads.push(`${side}:${path}`);
          return (side === 'base' ? base : head).get(path);
        },
      },
      changedTestPaths: ['test/first.test.ts', 'test/second.test.ts', 'test/dynamic.test.ts'],
      planText: '### Task 7: dependencies\n**Files:** src/production.ts\n',
    });

    expect(result).toMatchObject({
      effects: [
        { seed: { source: { fileName: 'test/first.test.ts' } }, chain: [{}, {}, { source: { fileName: 'src/b.ts' } }] },
        { seed: { source: { fileName: 'test/second.test.ts' } }, chain: [{}, {}, { source: { fileName: 'src/b.ts' } }] },
      ],
      uncertainties: [{ kind: 'dynamic-import', source: { source: { fileName: 'test/dynamic.test.ts' } } }],
    });
    expect(reads.filter((entry) => entry === 'head:src/b.ts')).toHaveLength(1);
    expect(reads.filter((entry) => entry === 'base:src/b.ts')).toHaveLength(1);
  });
});
