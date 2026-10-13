// Covers: task:23
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('plan-review runner lens boundary', () => {
  it('refuses an unknown Dependencies task before it can dispatch a reviewer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plan-review-lenses-')); roots.push(root); await mkdir(join(root, '.docs/plans'), { recursive: true }); await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(join(root, '.docs/plans/idea.md'), '# Plan\n\n### Task 1: Broken\n**Steps:**\n1. Add `value`.\n\n**Dependencies:** Task 99\n'); await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n');
    let dispatches = 0;
    await expect(runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any, providerExecutor: async () => { dispatches++; return { success: true, finalStructuredResult: { findings: [] } }; } })).rejects.toThrow(/Task 1.*Dependencies/i);
    expect(dispatches).toBe(0);
  });
});
