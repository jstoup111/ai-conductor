// Covers: task:13
import { describe, expect, it, vi } from 'vitest';
import { chooseResumeLocalState, resumeComposerRun } from '../../../src/engine/engineer/resume.js';
import { renderComposerLocalStatePrompt } from '../../../src/engine/engineer-cli.js';

const record = JSON.stringify({
  schemaVersion: 1,
  slug: 'demo',
  steps: { explore: { state: 'draft' } },
  needsReconfirm: [],
  ownerHistory: [],
  notes: {},
});

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

  it('Covers: Task 13 applies the selected local-state action before attach and preserves the selected local work', async () => {
    const attach = vi.fn(async () => ({ worktree: '/tmp/demo' }));
    const discard = vi.fn(async () => {});

    await resumeComposerRun('spec/demo', {
      resolveBranch: async () => ({ branch: 'spec/demo' }),
      attach,
      readRunRecord: async () => record,
      localState: async () => ({
        leftovers: { dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: ['abc123'] },
        interactive: true,
        choice: 'keep-local',
        fastForwardable: true,
      }),
    });
    expect(discard).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalledOnce();

    await resumeComposerRun('spec/demo', {
      resolveBranch: async () => ({ branch: 'spec/demo' }),
      attach,
      readRunRecord: async () => record,
      localState: async () => ({
        leftovers: { dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: ['abc123'] },
        interactive: true,
        choice: 'discard-local',
        fastForwardable: true,
        discard,
      }),
    });
    expect(discard).toHaveBeenCalledOnce();
  });

  it('Covers: Task 13 refuses divergent or non-TTY leftovers before it attaches or changes a worktree', async () => {
    const attach = vi.fn(async () => ({ worktree: '/must-not-attach' }));
    const discard = vi.fn(async () => {});
    for (const localState of [
      { leftovers: { dirtyDocs: [], unpushedCommits: ['ahead'] }, interactive: true, choice: 'keep-local' as const, fastForwardable: false, discard },
      { leftovers: { dirtyDocs: ['.docs/specs/demo.md'], unpushedCommits: [] }, interactive: false, choice: undefined, fastForwardable: true, discard },
    ]) {
      await expect(resumeComposerRun('spec/demo', {
        resolveBranch: async () => ({ branch: 'spec/demo' }), attach,
        readRunRecord: async () => record, localState: async () => localState,
      })).rejects.toThrow(/leftovers.*backup option/i);
    }
    expect(attach).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });
});
