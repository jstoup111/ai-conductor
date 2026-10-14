// Covers: task:17
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';
import { runPlanReviewGate } from '../../../src/engine/engineer/plan-review-gate.js';

const roots: string[] = [];
const execFile = promisify(execFileCb);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function input(findings: any[] = [], includeUncitedAdr = false) {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-gate-')); roots.push(root);
  const planText = '# Plan\n\n### Task 1: One\n**Dependencies:** none\n'; const storiesText = '# Stories\n\n## Story 1: One\nworks\n';
  await mkdir(join(root, '.docs/plan-review'), { recursive: true }); await mkdir(join(root, '.docs/coherence'), { recursive: true });
  await mkdir(join(root, '.docs/decisions'), { recursive: true });
  await writeFile(join(root, '.docs/coherence/idea.md'), '');
  if (includeUncitedAdr) await writeFile(join(root, '.docs/decisions/adr-uncited.md'), '## Decision\n\nD1. Original decision.\n');
  await execFile('git', ['init', '-b', 'main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
  const reviewedDigest = computeReviewedDigest({ planText, storiesText, adrTexts: {}, artifactTexts: { '.docs/coherence/idea.md': '' }, changedPaths: [] });
  await writeFile(join(root, '.docs/plan-review/idea.md'), renderPlanReviewArtifact({ round: 1, authoringHost: 'claude', reviewerProvider: 'codex', independence: 'cross-provider', findings, dispositions: [], reviewedDigest }));
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-m', 'baseline'], { cwd: root });
  return { root, planText, storiesText };
}
describe('plan-review land gate', () => {
  it('accepts a current clean M review and does not evaluate S artifacts', async () => {
    const clean = await input(); await expect(runPlanReviewGate({ worktreePath: clean.root, canonicalPath: clean.root, planStem: 'idea', tier: 'M', planText: clean.planText, storiesText: clean.storiesText })).resolves.toBeUndefined();
    await expect(runPlanReviewGate({ worktreePath: clean.root, canonicalPath: clean.root, planStem: 'missing', tier: 'S', planText: '', storiesText: '' })).resolves.toBeUndefined();
  });
  it('refuses a missing artifact and standing blocking finding without any provider dispatch', async () => {
    const blocked = await input([{ id: 'block-1', severity: 'blocking', lens: 'feasibility', artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null, summary: 'must change', evidence: ['source.ts:1'] }]);
    await expect(runPlanReviewGate({ worktreePath: blocked.root, canonicalPath: blocked.root, planStem: 'missing', tier: 'M', planText: blocked.planText, storiesText: blocked.storiesText })).rejects.toThrow('plan review has not run');
    await expect(runPlanReviewGate({ worktreePath: blocked.root, canonicalPath: blocked.root, planStem: 'idea', tier: 'M', planText: blocked.planText, storiesText: blocked.storiesText })).rejects.toThrow('block-1 (task 1): must change');
  });
  // Covers: task:rem-as-built-R6
  it('marks a review stale when this spec adds a numbered-Markdown ADR decision after review', async () => {
    const stale = await input();
    await writeFile(join(stale.root, '.docs/decisions/adr-uncited.md'), '## Decision\n\n1. Newly authored decision.\n');

    await expect(runPlanReviewGate({ worktreePath: stale.root, canonicalPath: stale.root, planStem: 'idea', tier: 'M', planText: stale.planText, storiesText: stale.storiesText }))
      .rejects.toThrow('plan review is stale: adr-uncited#D1');
  });
  it('marks a review stale when this spec modifies a tracked uncited ADR after review', async () => {
    const stale = await input([], true);
    await writeFile(join(stale.root, '.docs/decisions/adr-uncited.md'), '## Decision\n\nD1. Modified decision.\n');

    await expect(runPlanReviewGate({ worktreePath: stale.root, canonicalPath: stale.root, planStem: 'idea', tier: 'M', planText: stale.planText, storiesText: stale.storiesText }))
      .rejects.toThrow('plan review is stale: adr-uncited#D1');
  });
});
