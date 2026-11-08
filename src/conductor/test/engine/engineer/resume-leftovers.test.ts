import { describe, expect, it } from 'vitest';
import { chooseResumeLocalState } from '../../../src/engine/engineer/resume.js';

describe('resume local leftovers', () => {
  it('Covers: Task 13 keeps only fast-forwardable work and refuses non-TTY leftovers', () => {
    const leftovers = { dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: ['abc'] };
    expect(chooseResumeLocalState({ leftovers, interactive: true, choice: 'keep-local', fastForwardable: true })).toBe('keep-local');
    expect(chooseResumeLocalState({ leftovers, interactive: true, choice: 'keep-local', fastForwardable: false })).toBe('refuse');
    expect(chooseResumeLocalState({ leftovers, interactive: false, fastForwardable: true })).toBe('refuse');
  });
});
