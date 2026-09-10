// Covers: task:5, task:6
import { describe, expect, it } from 'vitest';
import { analyzeBuildReviewTestScope } from '../../src/engine/build-review-test-scope.js';

const storiesText = `
## Story 2: Binding

#### Happy Path
- Given a marker, when it binds, then it is retained
`;

function scope(
  baseText: string,
  headText: string,
  fileName = 'test/example.test.ts',
  markerOwnership: 'current-feature' | 'inherited' = 'current-feature',
) {
  const pinnedBase = markerOwnership === 'current-feature'
    ? baseText.replace(/^(\s*(?:\/\/|\/\*)?\s*Covers\s*:)[^\r\n]*(?:\r?\n)?/gm, '')
    : baseText;
  return analyzeBuildReviewTestScope({
    base: { source: { fileName, bytes: Buffer.from(pinnedBase) }, storiesText, planText: '### Task 7: Example\n' },
    head: { source: { fileName, bytes: Buffer.from(headText) }, storiesText, planText: '### Task 7: Example\n' },
  });
}

describe('build-review test scope association evidence', () => {
  it('groups a changed suite hook with opted-in unchanged descendants without marking their bodies directly changed', () => {
    const result = scope(
      `// Covers: S2.1\ndescribe('accounts', () => {\n  beforeEach(() => { seed('base'); });\n  it('creates an account', () => { expect(true).toBe(true); });\n  it('deletes an account', () => { expect(true).toBe(true); });\n});\n// Covers: S2.1\ndescribe('billing', () => {\n  it('keeps an unrelated sibling', () => { expect(true).toBe(true); });\n});`,
      `// Covers: S2.1\ndescribe('accounts', () => {\n  beforeEach(() => { seed('changed'); });\n  it('creates an account', () => { expect(true).toBe(true); });\n  it('deletes an account', () => { expect(true).toBe(true); });\n});\n// Covers: S2.1\ndescribe('billing', () => {\n  it('keeps an unrelated sibling', () => { expect(true).toBe(true); });\n});`,
    );

    expect(result.changedDeclarations).toEqual([]);
    expect(result.candidates).toMatchObject([
      {
        declaration: { kind: 'suite', titleChain: ['accounts'] },
        reasons: ['affected-opted-in-group'],
        affectedGroup: {
          suite: { titleChain: ['accounts'] },
          setup: { kind: 'hook', source: { fileName: 'test/example.test.ts' } },
          unchangedDescendantBodies: [{}, {}],
        },
      },
    ]);
    expect(result.candidates[0]?.affectedGroup?.unchangedDescendantBodies).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ titleChain: expect.arrayContaining(['billing']) }),
    ]));
  });

  it('deduplicates a changed shared fixture into one group for several opted-in bodies', () => {
    const result = scope(
      `// Covers: S2.1\ndescribe('inventory', () => {\n  const itemFixture = createFixture('base');\n  it('adds stock', () => { expect(itemFixture).toBeTruthy(); });\n  it('removes stock', () => { expect(itemFixture).toBeTruthy(); });\n  it('counts stock', () => { expect(itemFixture).toBeTruthy(); });\n});`,
      `// Covers: S2.1\ndescribe('inventory', () => {\n  const itemFixture = createFixture('changed');\n  it('adds stock', () => { expect(itemFixture).toBeTruthy(); });\n  it('removes stock', () => { expect(itemFixture).toBeTruthy(); });\n  it('counts stock', () => { expect(itemFixture).toBeTruthy(); });\n});`,
    );

    expect(result.changedDeclarations).toEqual([]);
    expect(result.affectedGroups).toHaveLength(1);
    expect(result.sharedSources).toHaveLength(1);
    expect(result.candidates).toMatchObject([{
      declaration: { titleChain: ['inventory'] },
      affectedGroup: {
        setup: { kind: 'fixture' },
        sharedSources: [{ kind: 'fixture' }],
        unchangedDescendantBodies: [{}, {}, {}],
      },
    }]);
  });

  it('keeps a changed unresolved setup as the same concrete opted-in group candidate', () => {
    const result = scope(
      `// Covers: S2.1\ndescribe('wrapped setup', () => {\n  withEnvironment(beforeEach)(() => { seed('base'); });\n  it('uses setup', () => { expect(true).toBe(true); });\n});`,
      `// Covers: S2.1\ndescribe('wrapped setup', () => {\n  withEnvironment(beforeEach)(() => { seed('changed'); });\n  it('uses setup', () => { expect(true).toBe(true); });\n});`,
    );

    expect(result.changedDeclarations).toEqual([]);
    expect(result.candidates).toMatchObject([{
      declaration: { titleChain: ['wrapped setup'] },
      reasons: ['affected-opted-in-group'],
      affectedGroup: { setup: { kind: 'unresolved-setup' } },
    }]);
  });

  it('merges group-binding and dependency facts for one changed suite into one settleable candidate', () => {
    const result = analyzeBuildReviewTestScope({
      base: {
        source: { fileName: 'test/orders.test.ts', bytes: Buffer.from("describe.each([['base']])('orders %s', () => { it('creates', () => { expect(true).toBe(true); }); });\n") },
        storiesText,
        planText: '### Task 7: Example\n',
      },
      head: {
        source: { fileName: 'test/orders.test.ts', bytes: Buffer.from("// Covers: S2.1\ndescribe.each([['changed']])('orders %s', () => { it('creates', () => { expect(true).toBe(true); }); });\n") },
        storiesText,
        planText: '### Task 7: Example\n',
      },
      dependencyEffects: [{
        seed: { source: { fileName: 'test/orders.test.ts', side: 'head' } },
        chain: [{ source: { fileName: 'test/orders.test.ts', side: 'head' } }, { source: { fileName: 'src/order-helper.ts', side: 'head' } }],
        changedSources: [{ source: { fileName: 'src/order-helper.ts', side: 'head' } }],
      }],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      declaration: { kind: 'group', titleChain: ['orders %s'] },
      reasons: expect.arrayContaining(['declaration-group', 'affected-dependency']),
      affectedDependencies: [{ changedSources: [{ source: { fileName: 'src/order-helper.ts' } }] }],
    });
  });

  it('retains a removed hook or fixture as base-side shared evidence for its opted-in suite', () => {
    const hook = scope(
      `// Covers: S2.1\ndescribe('removed setup', () => {\n  beforeEach(() => { seed('base'); });\n  it('uses setup', () => { expect(true).toBe(true); });\n});`,
      `// Covers: S2.1\ndescribe('removed setup', () => {\n  it('uses setup', () => { expect(true).toBe(true); });\n});`,
    );
    const fixture = scope(
      `// Covers: S2.1\ndescribe('removed fixture', () => {\n  const recordFixture = createFixture('base');\n  it('uses fixture', () => { expect(true).toBe(true); });\n});`,
      `// Covers: S2.1\ndescribe('removed fixture', () => {\n  it('uses fixture', () => { expect(true).toBe(true); });\n});`,
    );

    for (const result of [hook, fixture]) {
      expect(result.candidates).toMatchObject([{
        declaration: { kind: 'suite' },
        reasons: ['affected-opted-in-group'],
        affectedGroup: { setup: { source: { side: 'base' } } },
      }]);
    }
  });

  it('does not retain an inherited removed marker as active-feature authority', () => {
    const result = scope(
      `// Covers: S2.1\nit('same body', () => { expect(true).toBe(true); });`,
      `it('same body', () => { expect(true).toBe(true); });`,
    );

    expect(result.targets).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('records a marker-only edit while granting final authority only to the HEAD association', () => {
    const result = scope(
      `// Covers: S2.1\nit('same body', () => { expect(true).toBe(true); });`,
      `// Covers: task:7\nit('same body', () => { expect(true).toBe(true); });`,
    );

    expect(result).toMatchObject({
      candidates: [],
      targets: [{
        declaration: { titleChain: ['same body'] },
        bindings: [{ marker: { reference: { kind: 'task', id: '7' } } }],
        associationChanges: [
          { kind: 'added', binding: { marker: { reference: { kind: 'task', id: '7' } } } },
        ],
      }],
    });
  });

  it('keeps file-header and competing markers as declaration-local candidates rather than admitting the file', () => {
    const header = scope(
      `it('changed', () => { expect(1).toBe(1); });\nit('unchanged', () => {});`,
      `// Covers: S2.1\nimport { it } from 'vitest';\nit('changed', () => { expect(1).toBe(2); });\nit('unchanged', () => {});`,
    );
    const competing = scope(
      `// Covers: S2.1\nit('changed', () => { expect(1).toBe(1); });\nit('unchanged', () => {});`,
      `// Covers: S2.1\n// Covers: task:7\nit('changed', () => { expect(1).toBe(2); });\nit('unchanged', () => {});`,
    );

    expect(header).toMatchObject({
      targets: [],
      candidates: [{ declaration: { titleChain: ['changed'] }, reasons: ['file-header-marker'] }],
    });
    expect(competing).toMatchObject({
      targets: [],
      candidates: [{ declaration: { titleChain: ['changed'] }, reasons: ['conflicting-associations'] }],
    });
  });

  it('does not attribute an inherited bare file-header task marker to the active feature', () => {
    const result = scope(
      `// Covers: task:7\nimport { it } from 'vitest';\nit('changed', () => { expect(1).toBe(1); });`,
      `// Covers: task:7\nimport { it } from 'vitest';\nit('changed', () => { expect(1).toBe(2); });`,
      'test/example.test.ts',
      'inherited',
    );

    expect(result).toMatchObject({
      changedDeclarations: [{ titleChain: ['changed'] }],
      targets: [],
      candidates: [],
      notes: [{ kind: 'unbound', declaration: { titleChain: ['changed'] } }],
    });
  });

  it('does not attribute an inherited bare declaration marker to the active feature', () => {
    const result = scope(
      `// Covers: task:7\nit('changed', () => { expect(1).toBe(1); });`,
      `// Covers: task:7\nit('changed', () => { expect(1).toBe(2); });`,
      'test/example.test.ts',
      'inherited',
    );

    expect(result).toMatchObject({
      changedDeclarations: [{ titleChain: ['changed'] }],
      targets: [],
      candidates: [],
      notes: [{ kind: 'unbound', declaration: { titleChain: ['changed'] } }],
    });
  });

  it('does not let a newly added matching task marker bless an inherited sibling association', () => {
    const result = analyzeBuildReviewTestScope({
      base: {
        source: { fileName: 'test/example.test.ts', bytes: Buffer.from("// Covers: task:7\nit('legacy', () => { expect(1).toBe(1); });\n") },
        storiesText,
        planText: '### Task 7: Example\n',
      },
      head: {
        source: { fileName: 'test/example.test.ts', bytes: Buffer.from("// Covers: task:7\nit('legacy', () => { expect(1).toBe(2); });\n// Covers: task:7\nit('current', () => { expect(true).toBe(true); });\n") },
        storiesText,
        planText: '### Task 7: Example\n',
      },
    });

    expect(result.targets).toMatchObject([
      { declaration: { titleChain: ['current'] }, bindings: [{ marker: { reference: { kind: 'task', id: '7' } } }] },
    ]);
    expect(result.targets).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ declaration: expect.objectContaining({ titleChain: ['legacy'] }) }),
    ]));
  });

  it('retains a HEAD source identity for equal-span candidates from different files', () => {
    const left = scope(
      `it('changed', () => { expect(1).toBe(1); });`,
      `// Covers: S2.1\nimport { it } from 'vitest';\nit('changed', () => { expect(1).toBe(2); });`,
      'test/left.test.ts',
    );
    const right = scope(
      `it('changed', () => { expect(1).toBe(1); });`,
      `// Covers: S2.1\nimport { it } from 'vitest';\nit('changed', () => { expect(1).toBe(2); });`,
      'test/right.test.ts',
    );

    const [leftCandidate] = left.candidates;
    const [rightCandidate] = right.candidates;

    expect(leftCandidate).toMatchObject({
      source: { fileName: 'test/left.test.ts', side: 'head' },
      reasons: ['file-header-marker'],
    });
    expect(rightCandidate).toMatchObject({
      source: { fileName: 'test/right.test.ts', side: 'head' },
      reasons: ['file-header-marker'],
    });
    expect(leftCandidate?.declaration?.span).toEqual(rightCandidate?.declaration?.span);
    expect(leftCandidate?.markers).toEqual(rightCandidate?.markers);
    expect(leftCandidate?.source).not.toEqual(rightCandidate?.source);
  });

  it('does not turn a trailing uncertain marker into a candidate for an earlier changed declaration', () => {
    const result = scope(
      `it('changed', () => { expect(1).toBe(1); });`,
      `it('changed', () => { expect(1).toBe(2); });\n// Covers: S2.1`,
    );

    expect(result).toMatchObject({
      changedDeclarations: [{ titleChain: ['changed'] }],
      targets: [],
      candidates: [],
      notes: [{ kind: 'unbound', declaration: { titleChain: ['changed'] } }],
    });
  });

  it('records unresolved and unmarked declarations as notes, while unsupported unmarked source creates no candidate or halt', () => {
    const unmarked = scope(
      `it('changed', () => { expect(1).toBe(1); });`,
      `// Covers: S9.9\nit('changed', () => { expect(1).toBe(2); });\nit('unmarked', () => {});`,
    );
    const unsupported = scope('describe "plain spec" do\nend', 'describe "plain spec" do\nend', 'spec/example.rb');

    expect(unmarked.targets).toEqual([]);
    expect(unmarked.candidates).toEqual([]);
    expect(unmarked.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unresolved-reference', declaration: expect.objectContaining({ titleChain: ['changed'] }) }),
      expect.objectContaining({ kind: 'unbound', declaration: expect.objectContaining({ titleChain: ['unmarked'] }) }),
    ]));
    expect(unsupported).toMatchObject({ targets: [], candidates: [] });
  });

  it('keeps a changed unsupported declaration source-bound when a concrete marker could apply', () => {
    const result = scope(
      `// Covers: S2.1\nwithEnvironment(it)('changed', () => { expect(1).toBe(1); });`,
      `// Covers: S2.1\nwithEnvironment(it)('changed', () => { expect(1).toBe(2); });`,
    );

    expect(result).toMatchObject({
      targets: [],
      candidates: [{
        diagnostic: { reason: 'unsupported-declaration-wrapper' },
        reasons: ['unsupported-declaration'],
        markers: [{ reference: { id: 'S2.1' } }],
      }],
    });
  });

  it('does not promote an unchanged marked unsupported form because a later declaration changed', () => {
    const result = scope(
      `// Covers: S2.1\nwithEnvironment(it)('unsupported', () => {});\nit('later', () => { expect(1).toBe(1); });`,
      `// Covers: S2.1\nwithEnvironment(it)('unsupported', () => {});\nit('later', () => { expect(1).toBe(2); });`,
      'test/example.test.ts',
      'inherited',
    );

    expect(result).toMatchObject({
      changedDeclarations: [{ titleChain: ['later'] }],
      targets: [],
      candidates: [],
    });
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unbound', declaration: expect.objectContaining({ titleChain: ['later'] }) }),
    ]));
  });

  it('establishes an FR-bound changed test as a target instead of an empty scope with an unresolved note', () => {
    const frStories = '## Story 2: Binding\n\nThis story delivers FR-4.\n\n#### Happy Path\n- Given a marker, when it binds, then it is retained\n';
    const result = analyzeBuildReviewTestScope({
      base: { source: { fileName: 'test/example.test.ts', bytes: Buffer.from("it('fr body', () => { expect('base').toBe('base'); });\n") }, storiesText: frStories, planText: '### Task 7: Example\n' },
      head: { source: { fileName: 'test/example.test.ts', bytes: Buffer.from("// Covers: FR-4\nit('fr body', () => { expect('head').toBe('head'); });\n") }, storiesText: frStories, planText: '### Task 7: Example\n' },
    });

    expect(result.targets).toMatchObject([
      { declaration: { titleChain: ['fr body'] }, bindings: [{ kind: 'bound', marker: { reference: { kind: 'fr', id: 'FR-4' } } }] },
    ]);
    expect(result.notes.filter((note) => note.kind === 'unresolved-reference')).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('produces every affected-opted-in-group candidate from the internally derived setup analysis, with no externally supplied group input', () => {
    const result = scope(
      `// Covers: S2.1\ndescribe('accounts', () => {\n  beforeEach(() => { seed('base'); });\n  it('creates an account', () => { expect(true).toBe(true); });\n});`,
      `// Covers: S2.1\ndescribe('accounts', () => {\n  beforeEach(() => { seed('changed'); });\n  it('creates an account', () => { expect(true).toBe(true); });\n});`,
    );

    const groupCandidates = result.candidates.filter((entry) => entry.reasons.includes('affected-opted-in-group'));
    expect(groupCandidates).toHaveLength(1);
    // The removed external `affectedOptedInGroups` rung emitted a candidate with
    // no derived group; every surviving one is anchored to derivedAffectedGroups.
    expect(groupCandidates.every((entry) => entry.affectedGroup !== undefined)).toBe(true);
    expect(result.affectedGroups).toHaveLength(1);
  });
});
