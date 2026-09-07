// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import { composeSpecCommitMessage } from '../../../src/engine/engineer/spec-commit-message.js';
import { TASK_ID_PATTERN } from '../../../src/engine/plan-task-parse.js';

describe('composeSpecCommitMessage', () => {
  it('composes the current subject and an inert DECIDE-artifact summary', () => {
    const message = composeSpecCommitMessage(
      'summarize landed artifacts',
      'technical',
      'S',
      [
        '# Stories: Summarize landed artifacts',
        '',
        '## Story 1: Show the decision summary',
        '',
        '## Story 2: Keep the summary inert',
      ].join('\n'),
      [
        '# Implementation Plan: Summarize landed artifacts',
        '',
        '## Summary',
        '',
        'Give the landed commit a reviewable DECIDE summary.',
        '',
        '### Task 1: Compose the body',
        '',
        '### Task 2: Guard trailer-shaped prose',
        '',
        '### Task 3: Commit the summary',
      ].join('\n'),
    );

    expect(message.split('\n')[0]).toBe(
      'spec: land authored artifacts for "summarize landed artifacts" [engineer/land]',
    );
    expect(message).toContain('Give the landed commit a reviewable DECIDE summary.');
    expect(message).toContain('technical');
    expect(message).toContain('S');
    expect(
      message
        .split('\n')
        .filter((line) => line.includes('Story ')),
    ).toEqual([
      '- Story 1: Show the decision summary',
      '- Story 2: Keep the summary inert',
    ]);
    expect(message.split('\n')).toContain('Tasks: 3');

    const trailer = new RegExp(`^Task: ${TASK_ID_PATTERN}$`);
    expect(message.split('\n')).not.toContainEqual(expect.stringMatching(trailer));
  });

  it('removes copied trailer-shaped lines from the composed body', () => {
    const message = composeSpecCommitMessage(
      'trailer filtering',
      'technical',
      'S',
      ['# Stories: Trailer filtering', '', '## Story 1: Keep the summary inert'].join('\n'),
      [
        '# Implementation Plan: Trailer filtering',
        '',
        '### Task 1: Filter copied trailers',
        '',
        '## Summary',
        '',
        'Keep the summary reviewable.',
        'Task: 71',
      ].join('\n'),
    );

    expect(message).toBe(
      [
        'spec: land authored artifacts for "trailer filtering" [engineer/land]',
        'Summary:\nKeep the summary reviewable.',
        'Track: technical; Tier: S',
        'Stories:\n- Story 1: Keep the summary inert',
        'Tasks: 1\n- Task 1',
      ].join('\n\n'),
    );
  });

  it('returns only the subject when every optional input is empty', () => {
    const message = composeSpecCommitMessage('empty artifacts', '', undefined, '', '');

    expect(message).toBe('spec: land authored artifacts for "empty artifacts" [engineer/land]');
  });

  it('omits the summary section when the plan has no Summary heading', () => {
    const message = composeSpecCommitMessage(
      'missing summary',
      'technical',
      undefined,
      '',
      '# Implementation Plan: Missing summary\n\n### Task 1: Keep it concise',
    );

    expect(message).not.toContain('Summary:');
  });

  it('omits the stories section when stories have no heading', () => {
    const message = composeSpecCommitMessage(
      'missing story heading',
      'technical',
      undefined,
      '# Stories: Missing story heading\n\nStory prose without a heading.',
      '',
    );

    expect(message).not.toContain('Stories:');
  });
});
