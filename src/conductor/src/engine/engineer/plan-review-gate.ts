import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { computeReviewedDigest, diffReviewedDigests, parsePlanReviewArtifact } from '../plan-review-artifact.js';
import { resolveIdeaFiles } from './spec-change-set.js';

export async function runPlanReviewGate(input: { worktreePath: string; canonicalPath: string; planStem: string; tier: string; planText: string; storiesText: string }): Promise<void> {
  if (input.tier === 'S') return;
  const artifactPath = join(input.worktreePath, '.docs', 'plan-review', `${input.planStem}.md`);
  let parsed;
  try { parsed = parsePlanReviewArtifact(await readFile(artifactPath, 'utf8')); }
  catch { throw new Error('plan review has not run'); }
  if ('kind' in parsed) throw new Error(`plan review artifact is ${parsed.kind}`);
  const decisions = join(input.worktreePath, '.docs', 'decisions');
  const adrTexts: Record<string, string> = {};
  try { for (const file of await readdir(decisions)) if (file.endsWith('.md')) adrTexts[file.slice(0, -3)] = await readFile(join(decisions, file), 'utf8'); } catch { /* no ADRs */ }
  const coherence = await readFile(join(input.worktreePath, '.docs', 'coherence', `${input.planStem}.md`), 'utf8').catch(() => '');
  const changedPaths = await resolveIdeaFiles(input.worktreePath, input.canonicalPath);
  const digest = computeReviewedDigest({ planText: input.planText, storiesText: input.storiesText, adrTexts, artifactTexts: { [`.docs/coherence/${input.planStem}.md`]: coherence }, changedPaths: [...changedPaths] });
  if (digest.digest !== parsed.reviewedDigest.digest) {
    const changed = diffReviewedDigests(parsed.reviewedDigest, digest);
    const names = [...changed.planTaskIds.map((id) => `task ${id}`), ...changed.storyIds.map((id) => `story ${id}`), ...changed.adrDecisionIds, ...changed.artifactPaths];
    throw new Error(`plan review is stale: ${names.join(', ') || 'reviewed artifact changed'}`);
  }
  const accepted = new Set(parsed.dispositions.filter((d) => d.kind === 'accepted').map((d) => d.findingId));
  const blocking = parsed.findings.filter((finding) => finding.severity === 'blocking' && !accepted.has(finding.id));
  if (blocking.length) throw new Error(`standing blocking plan-review findings: ${blocking.map((f) => `${f.id} (${f.reference}): ${f.summary}`).join('; ')}`);
}
