import { describe, it, expect } from 'vitest';
import type { ConductState, StateResult, StateError } from '../../src/types/state.js';

describe('State types', () => {
  it('ConductState accepts step status keys', () => {
    const state: ConductState = {
      worktree: 'done',
      memory: 'done',
      brainstorm: 'in_progress',
    };
    expect(state.worktree).toBe('done');
  });

  it('ConductState accepts metadata keys', () => {
    const state: ConductState = {
      feature_desc: 'URL shortener',
      complexity_tier: 'M',
      run_started_at: 1234567890,
      last_step: 'brainstorm',
      pr_url: 'https://github.com/example/pr/1',
      worktree_dir: '.worktrees/url-shortener',
      worktree_branch: 'feature/url-shortener',
      feature_status: 'complete',
    };
    expect(state.feature_desc).toBe('URL shortener');
    expect(state.complexity_tier).toBe('M');
  });

  it('StateResult success variant', () => {
    const result: StateResult<ConductState> = { ok: true, value: {} };
    expect(result.ok).toBe(true);
  });

  it('StateResult error variant', () => {
    const result: StateResult<ConductState> = {
      ok: false,
      error: { type: 'corrupted', message: 'Invalid JSON' },
    };
    expect(result.ok).toBe(false);
  });
});
