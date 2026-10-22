// Covers: task:7
import { describe, expect, it } from 'vitest';
import {
  buildCitationJudgementInput,
  collectPendingCitations,
  DONE_WHEN_CITATION_JUDGEMENT_SCHEMA,
  DONE_WHEN_CITATION_WINDOW_LINES,
  validateCitationJudgementOutput,
} from '../../src/engine/done-when-citation-judgement.js';

const pendingStatus = {
  tasks: [{
    id: '7',
    doneWhen: [
      { check: '[test] ordinary report', evidence: 'reported', source: 'reported' },
      { check: '[test] parser accepts one citation', evidence: 'test:test/citation.test.ts::accepts one citation', source: 'pending-judgement' },
    ],
  }],
};

describe('done-when citation judgement contract', () => {
  it('collects every pending citation with its task and one-based check index', () => {
    expect(collectPendingCitations(pendingStatus)).toEqual([{
      taskId: '7', checkIndex: 2, check: '[test] parser accepts one citation',
      path: 'test/citation.test.ts', title: 'accepts one citation',
    }]);
  });

  it('reports an unknown close source by name and never treats it as pending', () => {
    expect(() => collectPendingCitations({ tasks: [{ id: '7', doneWhen: [{
      check: '[test] malformed', evidence: 'test:test/citation.test.ts::title', source: 'bogus',
    }] }] })).toThrow('unknown done-when close source: bogus');
  });

  it('projects check and task context with cited HEAD content centred and bounded around its title', () => {
    const pending = collectPendingCitations(pendingStatus);
    const lines = Array.from({ length: DONE_WHEN_CITATION_WINDOW_LINES + 20 }, (_, index) =>
      index === 50 ? "it('accepts one citation', () => {})" : `line ${index}`,
    );
    const input = buildCitationJudgementInput(pending, new Map([['7', 'Task 7 body']]), new Map([['test/citation.test.ts', lines.join('\n')]]));
    expect(input.citations).toEqual([expect.objectContaining({
      taskId: '7', checkIndex: 2, check: '[test] parser accepts one citation', taskText: 'Task 7 body',
      path: 'test/citation.test.ts', title: 'accepts one citation',
    })]);
    expect(input.citations[0]!.citedFileContent.split('\n')).toHaveLength(DONE_WHEN_CITATION_WINDOW_LINES);
    expect(input.citations[0]!.citedFileContent).toContain("it('accepts one citation'");
  });

  it('validates every pending citation, rejects an incomplete response, and ignores unknown citations', () => {
    const pending = collectPendingCitations(pendingStatus);
    expect(validateCitationJudgementOutput({ verdicts: [
      { taskId: '7', checkIndex: 2, verdict: 'asserts', reason: 'it tests the parser' },
      { taskId: '999', checkIndex: 1, verdict: 'does-not-assert', reason: 'not pending' },
    ] }, pending)).toEqual({ kind: 'valid', verdicts: [{ taskId: '7', checkIndex: 2, verdict: 'asserts', reason: 'it tests the parser' }] });
    expect(validateCitationJudgementOutput({ verdicts: [] }, pending)).toMatchObject({ kind: 'invalid' });
  });

  it('exports a closed schema whose verdict vocabulary and reason requirement match the contract', () => {
    const verdict = DONE_WHEN_CITATION_JUDGEMENT_SCHEMA.properties.verdicts as { items: { properties: Record<string, unknown>; required: readonly string[] } };
    expect((verdict.items.properties.verdict as { enum: readonly string[] }).enum).toEqual(['asserts', 'does-not-assert']);
    expect(verdict.items.required).toContain('reason');
    expect(verdict.items.properties.reason).toMatchObject({ type: 'string', pattern: '\\S' });
  });
});
