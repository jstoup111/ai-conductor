// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import { composeSpecCommitMessage } from '../../../src/engine/engineer/spec-commit-message.js';
import {
  TASK_ID_PATTERN,
  TASK_TRAILER_LINE_PATTERN,
} from '../../../src/engine/plan-task-parse.js';

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
    expect(message.split('\n\n').at(-1)).toBe([
      'Tasks: 3',
      '- Task 1: Compose the body',
      '- Task 2: Guard trailer-shaped prose',
      '- Task 3: Commit the summary',
    ].join('\n'));

    const trailer = new RegExp(`^Task: ${TASK_ID_PATTERN}$`);
    expect(message.split('\n')).not.toContainEqual(expect.stringMatching(trailer));
  });

  it('renders a dash-delimited task heading title', () => {
    const message = composeSpecCommitMessage(
      'dash-delimited task title',
      'technical',
      'S',
      '',
      '### Task task_3 — Dash-delimited title',
    );

    expect(message.split('\n')).toContain('- Task task_3: Dash-delimited title');
  });

  it.each(['### Task 4', '### Task 4:'])('renders an untitled task heading without a colon: %s', (heading) => {
    let message = '';

    expect(() => {
      message = composeSpecCommitMessage('untitled task', 'technical', 'S', '', heading);
    }).not.toThrow();

    const taskLines = message.split('\n').filter((line) => line.startsWith('- Task 4'));
    expect(taskLines).toEqual(['- Task 4']);
    expect(taskLines).not.toContainEqual(expect.stringMatching(/^- Task 4:/));
  });

  it('excludes task headings inside fenced code blocks', () => {
    const message = composeSpecCommitMessage(
      'fenced task heading',
      'technical',
      'S',
      '',
      [
        '### Task 1: Real task',
        '',
        '```markdown',
        '### Task 9: Example heading',
        '```',
      ].join('\n'),
    );

    expect(message).toContain('Tasks: 1');
    expect(message.split('\n')).not.toContainEqual(expect.stringMatching(/^- Task 9/));
  });

  it('does not emit a task trailer when a heading title is trailer-shaped', () => {
    const message = composeSpecCommitMessage(
      'trailer-shaped task title',
      'technical',
      'S',
      '',
      '### Task 1: Task: 71',
    );

    expect(message.split('\n')).toContain('- Task 1: Task: 71');
    const trailer = new RegExp(TASK_TRAILER_LINE_PATTERN);
    expect(message.split('\n').map((line) => line.trim())).not.toContainEqual(expect.stringMatching(trailer));
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
        'Tasks: 1\n- Task 1: Filter copied trailers',
      ].join('\n\n'),
    );
  });

  it('drops copied trailer-shaped lines carrying trailing horizontal whitespace', () => {
    const message = composeSpecCommitMessage(
      'trailing whitespace trailers',
      'technical',
      'S',
      '',
      [
        '## Summary',
        '',
        'Keep the summary reviewable.',
        'Task: 71   ',
        '\tTask: 72\t',
      ].join('\n'),
    );

    // `git stripspace` (commit message cleanup) strips trailing horizontal
    // whitespace, so these lines would land as real routing trailers.
    const trailer = new RegExp(`^Task: ${TASK_ID_PATTERN}$`);
    expect(
      message.split('\n').filter((line) => trailer.test(line.replace(/[ \t]+$/, '').trim())),
    ).toEqual([]);
    expect(message).toContain('Keep the summary reviewable.');
  });

  it('keeps the derivable track when plan and stories text are empty', () => {
    const message = composeSpecCommitMessage('empty artifacts', 'product', undefined, '', '');

    expect(message).toBe(
      [
        'spec: land authored artifacts for "empty artifacts" [engineer/land]',
        'Track: product',
      ].join('\n\n'),
    );
  });

  it('returns only the subject when nothing at all is derivable', () => {
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
