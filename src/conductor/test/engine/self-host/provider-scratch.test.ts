import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveScratchHome } from '../../../src/engine/self-host/provider-scratch.js';

describe('provider scratch homes', () => {
  it('resolves beneath the owning worktree', () => {
    expect(resolveScratchHome({ worktreeRoot: '/wt', runId: 'R', attempt: 2, provider: 'codex' })).toBe(
      '/wt/.daemon/scratch/R/2-codex',
    );
  });

  it.each([
    ['worktree root', { runId: 'R', attempt: 2, provider: 'codex' }],
    ['run id', { worktreeRoot: '/wt', attempt: 2, provider: 'codex' }],
    ['attempt', { worktreeRoot: '/wt', runId: 'R', provider: 'codex' }],
    ['provider', { worktreeRoot: '/wt', runId: 'R', attempt: 2 }],
  ])('rejects a missing %s', (missing, options) => {
    expect(() => resolveScratchHome(options as Parameters<typeof resolveScratchHome>[0])).toThrow(missing);
  });

  it('does not fall back to the current or main worktree root', async () => {
    const source = await readFile(new URL('../../../src/engine/self-host/provider-scratch.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/process\.cwd|mainRoot|resolveMainRoot/);
  });
});
