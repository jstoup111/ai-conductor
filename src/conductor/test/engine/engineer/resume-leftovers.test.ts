// Covers: task:13
import { describe, expect, it } from 'vitest';
import { chooseResumeLocalState } from '../../../src/engine/engineer/resume.js';

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
});
