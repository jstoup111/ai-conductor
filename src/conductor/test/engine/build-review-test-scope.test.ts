// Covers: task:5
import { describe, expect, it } from 'vitest';
import { analyzeBuildReviewTestScope } from '../../src/engine/build-review-test-scope.js';

const storiesText = `
## Story 2: Binding

#### Happy Path
- Given a marker, when it binds, then it is retained
`;

function scope(baseText: string, headText: string, fileName = 'test/example.test.ts') {
  return analyzeBuildReviewTestScope({
    base: { source: { fileName, bytes: Buffer.from(baseText) }, storiesText, planText: '### Task 7: Example\n' },
    head: { source: { fileName, bytes: Buffer.from(headText) }, storiesText, planText: '### Task 7: Example\n' },
  });
}

describe('build-review test scope association evidence', () => {
  it('keeps a removed marker as a concrete association candidate but never gives its former target final authority', () => {
    const result = scope(
      `// Covers: S2.1\nit('same body', () => { expect(true).toBe(true); });`,
      `it('same body', () => { expect(true).toBe(true); });`,
    );

    expect(result.targets).toEqual([]);
    expect(result.candidates).toMatchObject([
      {
        declaration: { titleChain: ['same body'] },
        reasons: ['binding-removed'],
        associationChanges: [{ kind: 'removed', binding: { marker: { reference: { id: 'S2.1' } } } }],
      },
    ]);
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
          { kind: 'removed', binding: { marker: { reference: { kind: 'criterion', id: 'S2.1' } } } },
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

  it('does not turn a trailing uncertain marker into a candidate for an earlier changed declaration', () => {
    const result = scope(
      `it('changed', () => { expect(1).toBe(1); });`,
      `it('changed', () => { expect(1).toBe(2); });\n// Covers: S2.1`,
    );

    expect(result).toMatchObject({ targets: [], candidates: [] });
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
    );

    expect(result).toMatchObject({ targets: [], candidates: [] });
  });
});
