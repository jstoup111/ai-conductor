// Covers: task:4
import { describe, expect, it } from 'vitest';
import { bindCoversMarkers } from '../../src/engine/build-review-test-bindings.js';

function bindings(text: string) {
  return bindCoversMarkers({
    source: { fileName: 'test/example.test.ts', bytes: Buffer.from(text, 'utf8') },
    storiesText: `
## Story 2: Example

#### Happy Path
- Given a feature, when it runs, then it succeeds
`,
    planText: '### Task 7: Example\n',
  });
}

describe('build-review Covers marker bindings', () => {
  it('binds immediately leading criterion and task markers with their owning test provenance', () => {
    const text = `
// Covers: S2.1
it('criterion', () => {});
// Covers: task:7
it('task', () => {});
`;

    expect(bindings(text).bindings).toMatchObject([
      {
        kind: 'bound',
        target: { titleChain: ['criterion'] },
        marker: { span: { start: text.indexOf('Covers: S2.1'), end: text.indexOf('Covers: S2.1') + 'Covers: S2.1'.length }, reference: { kind: 'criterion', id: 'S2.1' } },
        owner: { kind: 'test', association: 'leading-comment', declaration: { titleChain: ['criterion'] } },
      },
      {
        kind: 'bound',
        target: { titleChain: ['task'] },
        marker: { reference: { kind: 'task', id: '7' } },
        owner: { kind: 'test', association: 'leading-comment', declaration: { titleChain: ['task'] } },
      },
    ]);
  });

  it('inherits suite title and attached markers only into descendant tests', () => {
    const result = bindings(`
describe('outer — Covers: S2.1', () => {
  // Covers: task:7
  describe('inner', () => {
    it('descendant', () => {});
  });
});
it('sibling', () => {});
`);

    expect(result.bindings).toMatchObject([
      {
        kind: 'bound', target: { titleChain: ['outer — Covers: S2.1', 'inner', 'descendant'] },
        marker: { reference: { kind: 'criterion', id: 'S2.1' } },
        owner: { kind: 'suite', association: 'title', declaration: { titleChain: ['outer — Covers: S2.1'] } },
      },
      {
        kind: 'bound', target: { titleChain: ['outer — Covers: S2.1', 'inner', 'descendant'] },
        marker: { reference: { kind: 'task', id: '7' } },
        owner: { kind: 'suite', association: 'leading-comment', declaration: { titleChain: ['outer — Covers: S2.1', 'inner'] } },
      },
      { kind: 'unbound', target: { titleChain: ['sibling'] } },
    ]);
  });

  it('does not borrow sibling markers and records absent or malformed references as unresolved', () => {
    const result = bindings(`
// Covers: S2.1
it('marked sibling', () => {});
// Covers: S9.9, task:missing, task:
it('foreign', () => {});
it('unmarked', () => {});
`);

    expect(result.bindings).toMatchObject([
      { kind: 'bound', target: { titleChain: ['marked sibling'] } },
      { kind: 'unresolved-reference', target: { titleChain: ['foreign'] }, marker: { reference: { kind: 'criterion', id: 'S9.9' } } },
      { kind: 'unresolved-reference', target: { titleChain: ['foreign'] }, marker: { reference: { kind: 'task', id: 'missing' } } },
      { kind: 'unresolved-reference', target: { titleChain: ['foreign'] }, marker: { reference: { kind: 'unresolved', id: 'task:' } } },
      { kind: 'unbound', target: { titleChain: ['unmarked'] } },
    ]);
  });

  it('leaves a marker separated from a declaration by a statement as uncertain rather than lending it onward', () => {
    const result = bindings(`
// Covers: S2.1
const unrelated = 1;
it('later test', () => {});
`);

    expect(result.bindings).toMatchObject([
      { kind: 'uncertain-association', marker: { reference: { kind: 'criterion', id: 'S2.1' } } },
      { kind: 'unbound', target: { titleChain: ['later test'] } },
    ]);
  });
});
