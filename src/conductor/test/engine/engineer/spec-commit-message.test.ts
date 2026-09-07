// Covers: task:1
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
});
