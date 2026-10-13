// Covers: task:13
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function seed() {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-bound-')); roots.push(root);
  await mkdir(join(root, '.docs/plans'), { recursive: true }); await mkdir(join(root, '.docs/stories'), { recursive: true });
  await writeFile(join(root, '.docs/plans/idea.md'), '# Plan\n\n### Task 1: First\n**Steps:**\n1. Add `thing`.\n\n**Done when:**\n- first.\n\n**Dependencies:** none\n', 'utf8');
  await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n\n## Story 1: First\nInitial.\n', 'utf8'); await writeFile(join(root, 'source.ts'), 'export const thing = true;\n');
  return root;
}
const executor = (prompts: string[]) => async (input: any) => { prompts.push(input.options.prompt); return { success: true, finalStructuredResult: { findings: [] } }; };

describe('runPlanReview bounded rounds', () => {
  it('rechecks changed review inputs in round two, then refuses a third dispatch', async () => {
    const root = await seed(); const prompts: string[] = []; const input = { worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any, providerExecutor: executor(prompts) };
    await runPlanReview(input);
    await writeFile(join(root, '.docs/plans/idea.md'), '# Plan\n\n### Task 1: First changed\n**Steps:**\n1. Add `thing`.\n\n**Done when:**\n- changed.\n\n**Dependencies:** none\n', 'utf8');
    const second = await runPlanReview(input);
    expect(second.round).toBe(2); expect(prompts[1]).toContain('Task 1: First changed');
    await expect(runPlanReview(input)).rejects.toThrow('plan review bound reached');
    expect(prompts).toHaveLength(2);
  });
});
