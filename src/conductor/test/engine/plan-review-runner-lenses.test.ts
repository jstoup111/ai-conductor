// Covers: task:23
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('plan-review runner lens boundary', () => {
  it('refuses an unknown Dependencies task before it can dispatch a reviewer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plan-review-lenses-')); roots.push(root); await mkdir(join(root, '.docs/plans'), { recursive: true }); await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(join(root, '.docs/plans/idea.md'), '# Plan\n\n### Task 1: Broken\n**Steps:**\n1. Add `value`.\n\n**Dependencies:** Task 99\n'); await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n');
    let dispatches = 0;
    await expect(runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any, providerExecutor: (async () => { dispatches++; return { success: true, finalStructuredResult: { findings: [] } }; }) as any })).rejects.toThrow(/Task 1.*Dependencies/i);
    expect(dispatches).toBe(0);
  });

  it('validates and writes the Task 7/Task 8 dependency-order finding with plan-line evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plan-review-lenses-')); roots.push(root);
    await mkdir(join(root, '.docs/plans'), { recursive: true }); await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(join(root, '.docs/plans/idea.md'), `# Plan

### Task 7: Validate the review input
**Steps:**
1. Add validation.

**Done when:**
- [test] The review calls \`dependencyOrderCandidates\`.

**Dependencies:** none

### Task 8: Add dependency-order candidates
**Steps:**
1. Export \`dependencyOrderCandidates\`.

**Dependencies:** Task 7
`);
    await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n');

    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [{
        id: 'dependency-order-7-8', severity: 'blocking', lens: 'dependency-order', artifact: '.docs/plans/idea.md',
        reference: 'task 7', relatedReference: 'task 8', resolvesPrior: null,
        summary: 'Task 7 depends on an export that Task 8 introduces after it.',
        evidence: ['.docs/plans/idea.md:3', 'Dependency closure for task 7: none; task 8 is not reachable.'],
      }] } })) as any,
    });

    expect(artifact.findings).toEqual([expect.objectContaining({ id: 'dependency-order-7-8', reference: 'task 7', relatedReference: 'task 8' })]);
    expect(parsePlanReviewArtifact(await readFile(join(root, '.docs/plan-review/idea.md'), 'utf8'))).toMatchObject({
      findings: [expect.objectContaining({ id: 'dependency-order-7-8', reference: 'task 7', relatedReference: 'task 8' })],
    });
  });
});
