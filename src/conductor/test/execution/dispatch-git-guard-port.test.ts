// Covers: task:9
import { describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
import type { DispatchGitGuard } from '../../src/execution/llm-provider.js';

describe('dispatch git guard provider port', () => {
  it('requires the guard when constructing every provider', () => {
    // @ts-expect-error dispatchGitGuard is required
    new ClaudeProvider();
    // @ts-expect-error dispatchGitGuard is required
    new CodexProvider();
    // @ts-expect-error dispatchGitGuard is required
    new PiProvider();
  });

  it('uses the injected guard for a normal dispatch but exempts review dispatches', async () => {
    const dispatchGitGuard: DispatchGitGuard = vi.fn(async () => null);
    const subprocess = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 1, failed: true }));
    const provider = new ClaudeProvider(dispatchGitGuard, undefined, subprocess as never);

    await provider.invoke({ prompt: 'normal', sessionId: 'normal', resume: false, cwd: '/worktree' });
    await provider.invoke({ prompt: 'review', sessionId: 'review', resume: false, cwd: '/review-worktree', reviewDispatch: true });

    expect(dispatchGitGuard).toHaveBeenCalledTimes(1);
    expect(dispatchGitGuard).toHaveBeenCalledWith('/worktree');
  });
});
