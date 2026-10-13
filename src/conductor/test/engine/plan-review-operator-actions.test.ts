// Covers: task:14
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { computeReviewedDigest, parsePlanReviewArtifact, renderPlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import { acceptPlanReviewFinding, acknowledgePlanReviewChanges } from '../../src/engine/plan-review-runner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-actions-')); roots.push(root);
  await mkdir(join(root, '.docs/plans'), { recursive: true }); await mkdir(join(root, '.docs/stories'), { recursive: true }); await mkdir(join(root, '.docs/plan-review'), { recursive: true });
  const planText = '# Plan\n\n### Task 1: One\n**Dependencies:** none\n'; const storiesText = '# Stories\n\n## Story 1: One\nworks\n';
  await writeFile(join(root, '.docs/plans/idea.md'), planText); await writeFile(join(root, '.docs/stories/idea.md'), storiesText); await writeFile(join(root, 'source.ts'), 'export const value = true;\n');
  const artifact = { round: 2, authoringHost: 'claude', reviewerProvider: 'codex', independence: 'cross-provider' as const, findings: [{ id: 'block-1', severity: 'blocking' as const, lens: 'feasibility' as const, artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null, summary: 'fix it', evidence: ['source.ts:1'] }], dispositions: [], reviewedDigest: computeReviewedDigest({ planText, storiesText, adrTexts: {}, artifactTexts: { '.docs/coherence/idea.md': '' }, changedPaths: [] }) };
  const path = join(root, '.docs/plan-review/idea.md'); await writeFile(path, renderPlanReviewArtifact(artifact)); return { root, path };
}
describe('plan-review operator actions', () => {
  it('records acceptance and emits the accepted finding id', async () => {
    const { root, path } = await fixture(); const events: any[] = [];
    await acceptPlanReviewFinding({ worktreePath: root, planStem: 'idea', findingId: 'block-1', reason: 'accepted risk', emit: async (event) => { events.push(event); } });
    const parsed = parsePlanReviewArtifact(await readFile(path, 'utf8')) as any;
    expect(parsed.dispositions).toContainEqual({ findingId: 'block-1', kind: 'accepted', reason: 'accepted risk' }); expect(events[0]).toMatchObject({ type: 'plan_review_finding_accepted', findingId: 'block-1' });
  });
  it('refuses invalid acceptance unchanged and acknowledges current inputs without a dispatch', async () => {
    const { root, path } = await fixture(); const before = await readFile(path, 'utf8');
    await expect(acceptPlanReviewFinding({ worktreePath: root, planStem: 'idea', findingId: 'missing', reason: 'why' })).rejects.toThrow('unknown plan-review finding');
    await expect(acceptPlanReviewFinding({ worktreePath: root, planStem: 'idea', findingId: 'block-1', reason: '' })).rejects.toThrow('reason'); expect(await readFile(path, 'utf8')).toBe(before);
    await writeFile(join(root, '.docs/plans/idea.md'), '# Plan\n\n### Task 1: Changed\n**Dependencies:** none\n');
    await acknowledgePlanReviewChanges({ worktreePath: root, planStem: 'idea', reason: 'inputs reviewed' });
    expect(await readFile(path, 'utf8')).not.toBe(before);
  });
});
