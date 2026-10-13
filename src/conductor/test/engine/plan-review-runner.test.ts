// Covers: task:12, task:17
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';

const roots: string[] = [];
const execFile = promisify(execFileCb);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(includeUncitedAdr = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-runner-')); roots.push(root);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(root, '.docs/plans/idea.md'), `# Plan\n\n### Task 1: Configure\n**Steps:**\n1. Add \`reviewFlag\`.\n\n**Done when:**\n- [test] the flag works.\n\n**Dependencies:** none\n`, 'utf8');
  await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n\n## Story 1: Review\nThe flag is reviewed.\n', 'utf8');
  await writeFile(join(root, '.docs/decisions/adr-review.md'), '## Decision\n\nD1. The flag is allowed.\n', 'utf8');
  if (includeUncitedAdr) await writeFile(join(root, '.docs/decisions/adr-uncited.md'), '## Decision\n\nD1. Original decision.\n', 'utf8');
  await writeFile(join(root, 'source.ts'), 'export const reviewFlag = true;\n', 'utf8');
  await execFile('git', ['init'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-m', 'baseline'], { cwd: root });
  return root;
}

describe('runPlanReview', () => {
  it('dispatches one fresh, read-only, schema-constrained reviewer and writes only its validated findings', async () => {
    const root = await fixture(); const calls: any[] = []; const events: any[] = [];
    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: ['claude', 'pi'], steps: { plan_review: { llm_provider: 'pi' } } } as any,
      configuredProviders: ['claude', 'pi'], env: { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
      emit: async (event) => { events.push(event); },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ step: 'plan_review', configuredProviders: ['pi'], nativeSchemaScratch: { worktreeRoot: root, repository: root, featureSlug: 'idea' }, options: { cwd: root, interactive: false, readOnlyReview: true } });
    expect(calls[0].options.nativeSchema).toBeDefined();
    expect(calls[0].options.prompt).toContain('### Task 1: Configure');
    expect(calls[0].options.prompt).toContain('## Story 1: Review');
    expect(calls[0].options.prompt).toContain('D1. The flag is allowed.');
    expect(artifact).toMatchObject({ round: 1, reviewerProvider: 'pi', independence: 'cross-provider', findings: [] });
    expect(events.map((event) => event.type)).toEqual(['plan_review_dispatched', 'plan_review_completed']);
    expect([...new Set(events.map((event) => event.reviewerProvider))]).toEqual(['pi']);
    expect(parsePlanReviewArtifact(await readFile(join(root, '.docs/plan-review/idea.md'), 'utf8'))).toMatchObject({ findings: [] });
  });

  it('includes a modified tracked uncited ADR in the reviewed digest', async () => {
    const root = await fixture(true);
    await writeFile(join(root, '.docs/decisions/adr-uncited.md'), '## Decision\n\nD1. This must still be reviewed.\n', 'utf8');

    const artifact = await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    });

    expect(artifact.reviewedDigest.adrDecisionDigests).toHaveProperty('adr-uncited#D1');
  });

  it('falls through a failed candidate while preserving round one and recording same-provider independence', async () => {
    const root = await fixture(); const calls: any[] = [];
    const artifact = await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: ['codex', 'claude'] } as any, configuredProviders: ['codex', 'claude'], env: { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return calls.length === 1 ? { success: false } : { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls.map((call) => call.configuredProviders[0])).toEqual(['codex', 'claude']);
    expect(artifact).toMatchObject({ round: 1, reviewerProvider: 'claude', independence: 'same-provider' });
  });

  it('feeds the feature architecture review Wiring Surface into reachability candidates', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs/plans/idea.md'), `# Plan

### Task 1: Introduce \`unwiredSurface\`
**Steps:**
1. Add the surface.

**Done when:**
- [test] the surface is covered.

**Dependencies:** none
`, 'utf8');
    await writeFile(join(root, '.docs/decisions/architecture-review-2026-10-13-idea.md'), `# Architecture review

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| \`unwiredSurface\` | \`runSurface\` |
`, 'utf8');

    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    expect(calls[0].options.prompt).toContain('"lens":"reachability"');
    expect(calls[0].options.prompt).toContain('"identifier":"unwiredSurface"');
    expect(calls[0].options.prompt).toContain('"taskId":"1"');
  });
});
