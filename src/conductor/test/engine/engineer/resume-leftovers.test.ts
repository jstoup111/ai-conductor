// Covers: task:13
import { describe, expect, it } from 'vitest';
import { chooseResumeLocalState } from '../../../src/engine/engineer/resume.js';
import { renderComposerLocalStatePrompt } from '../../../src/engine/engineer-cli.js';

describe('resume local leftovers', () => {
  it('Covers: Task 13 presents dirty docs and unpushed commits as explicit keep-local or discard-local choices', () => {
    const leftovers = { dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: ['abc'] };
    expect(chooseResumeLocalState({ leftovers, interactive: true, choice: 'keep-local', fastForwardable: true })).toBe('keep-local');
    expect(chooseResumeLocalState({ leftovers, interactive: true, choice: 'discard-local', fastForwardable: true })).toBe('discard-local');
    expect(chooseResumeLocalState({ leftovers, interactive: true, choice: 'keep-local', fastForwardable: false })).toBe('refuse');
    expect(chooseResumeLocalState({ leftovers, interactive: false, fastForwardable: true })).toBe('refuse');
  });

  it('Covers: Task 13 refuses divergent and non-interactive leftovers before any keep or discard action', () => {
    const divergent = { dirtyDocs: [], unpushedCommits: ['ahead-1', 'ahead-2'] };
    expect(chooseResumeLocalState({ leftovers: divergent, interactive: true, choice: 'keep-local', fastForwardable: false })).toBe('refuse');
    expect(chooseResumeLocalState({ leftovers: divergent, interactive: false, fastForwardable: true })).toBe('refuse');
  });

  it('Covers: Task 13 renders the production local-leftovers prompt beside saved remote progress', () => {
    expect(renderComposerLocalStatePrompt({
      dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: ['abc123'],
      remote: { step: 'stories', lastActor: 'operator-a', lastAt: '2026-11-10T00:00:00.000Z', tip: 'deadbeef' },
    })).toContain('Saved remote progress: step stories; last actor operator-a at 2026-11-10T00:00:00.000Z; origin/spec tip deadbeef.');
  });
});
