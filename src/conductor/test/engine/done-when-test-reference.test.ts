// Covers: task:2
import { describe, expect, it } from 'vitest';
import { verifyDoneWhenTestReference } from '../../src/engine/done-when-test-reference.js';

const stories = `## Story 2: Verified test evidence

### Happy Path
- Given a test reference, when it names a committed test, then the task can close.

### Negative Paths
- Given no matching marker, when evidence closes, then it is refused.
`;

const task = '**Story:** 2';

function verify(evidence: string, blob?: string) {
  return verifyDoneWhenTestReference({
    evidence,
    taskId: '2',
    taskText: task,
    storiesText: stories,
    blobs: blob === undefined ? new Map() : new Map([['test/example.test.ts', blob]]),
  });
}

describe('verifyDoneWhenTestReference', () => {
  it('verifies a whitespace-normalized title with a task Covers marker', () => {
    expect(verify(
      'test:test/example.test.ts::proves   task\nclose',
      '// Covers: task:2\n\nit(\'proves task close\', () => {});\n',
    )).toMatchObject({ kind: 'verified', path: 'test/example.test.ts', title: 'proves   task\nclose' });
  });

  it('verifies a criterion marker derived from the task Story line', () => {
    expect(verify(
      'test:test/example.test.ts::criterion evidence',
      '// Covers: S2.1\nit(\'criterion evidence\', () => {});\n',
    )).toMatchObject({ kind: 'verified' });
  });

  it.each([
    ['free text', 'evidence was supplied', undefined, 'not-a-test-reference'],
    ['absent blob', 'test:test/example.test.ts::a title', undefined, 'missing-file'],
    ['missing title', 'test:test/example.test.ts::a title', '// Covers: task:2\nit(\'other title\', () => {});', 'missing-title'],
    ['unrelated Covers marker', 'test:test/example.test.ts::a title', '// Covers: task:other\nit(\'a title\', () => {});', 'missing-covers-marker'],
  ])('refuses %s with its failed verification part', (_caseName, evidence, blob, part) => {
    expect(verify(evidence, blob)).toMatchObject({ kind: 'refused', part });
  });

  it('accepts Elixir and TypeScript test blobs without parsing either language', () => {
    const reference = 'test:test/example.test.ts::works across languages';
    const typescript = new Map([['test/example.test.ts', '// Covers: task:2\nit(\'works across languages\', () => {});']]);
    const elixir = new Map([['test/example.test.ts', '# Covers: task:2\ntest "works across languages" do\n  :ok\nend']]);

    for (const blobs of [typescript, elixir]) {
      expect(verifyDoneWhenTestReference({
        evidence: reference,
        taskId: '2',
        taskText: task,
        storiesText: stories,
        blobs,
      })).toMatchObject({ kind: 'verified' });
    }
  });
});
