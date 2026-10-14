import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { HarnessConfig } from '../types/config.js';
import type { ConductorEvent } from '../types/events.js';
import { computeReviewedDigest, diffReviewedDigests, parsePlanReviewArtifact, renderPlanReviewArtifact, type PlanReviewArtifact } from './plan-review-artifact.js';
import { PLAN_REVIEW_RESULT_SCHEMA, validatePlanReviewResult } from './plan-review-contract.js';
import { dependencyOrderCandidates, reachabilityCandidates, testImpactCandidates } from './plan-review-candidates.js';
import { classifyIndependence, orderReviewerCandidates, resolveAuthoringHost } from './plan-review-provider.js';
import type { ProviderRuntimeSet } from './provider-runtime.js';
import type { ProviderSessionStore } from './provider-session.js';
import { executeProviderCandidates, type ExecuteProviderCandidatesInput } from './provider-execution.js';
import { resolveIdeaFiles } from './engineer/spec-change-set.js';
import { parseAdrDecisions } from './artifacts.js';

async function files(root: string, at = root): Promise<string[]> {
  const entries = await readdir(at, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? (entry.name === '.git' || entry.name === 'node_modules' ? [] : files(root, join(at, entry.name)))
    : entry.isFile() ? [relative(root, join(at, entry.name)).replaceAll('\\', '/')] : []))).flat();
}
async function reviewInputs(worktreePath: string, planStem: string, canonicalPath?: string) {
  const planText = await readFile(join(worktreePath, '.docs', 'plans', `${planStem}.md`), 'utf8');
  const storiesText = await readFile(join(worktreePath, '.docs', 'stories', `${planStem}.md`), 'utf8').catch(() => '');
  const coherenceText = await readFile(join(worktreePath, '.docs', 'coherence', `${planStem}.md`), 'utf8').catch(() => '');
  const architectureReviewText = await (async () => {
    try {
      const review = (await readdir(join(worktreePath, '.docs', 'decisions')))
        .filter((name) => name.startsWith('architecture-review-') && name.endsWith(`-${planStem}.md`))
        .sort()[0];
      return review ? await readFile(join(worktreePath, '.docs', 'decisions', review), 'utf8') : '';
    } catch {
      return '';
    }
  })();
  const allAdrTexts: Record<string, string> = {};
  try { for (const file of await readdir(join(worktreePath, '.docs', 'decisions'))) if (file.endsWith('.md')) allAdrTexts[file.slice(0, -3)] = await readFile(join(worktreePath, '.docs', 'decisions', file), 'utf8'); } catch { /* optional */ }
  const cited = new Set([...planText.matchAll(/\b(adr-[a-z0-9][a-z0-9-]*)\b/gi)].map((match) => match[1]!));
  const adrTexts = Object.fromEntries([...cited].flatMap((stem) => allAdrTexts[stem] === undefined ? [] : [[stem, allAdrTexts[stem]] ]));
  const sourceFiles: Record<string, string> = {};
  for (const path of await files(worktreePath)) if (!path.startsWith('.pipeline/')) sourceFiles[path] = await readFile(join(worktreePath, path), 'utf8').catch(() => '');
  const changedPaths = canonicalPath ? await resolveIdeaFiles(worktreePath, canonicalPath) : new Set<string>();
  const digest = computeReviewedDigest({ planText, storiesText, adrTexts, artifactTexts: { [` .docs/coherence/${planStem}.md`.trim()]: coherenceText }, changedPaths: [...changedPaths] });
  return { planText, storiesText, coherenceText, architectureReviewText, adrTexts, sourceFiles, digest };
}

function selectedPlanTasks(planText: string, ids: readonly string[]): string {
  if (ids.length === 0) return '';
  const matches = [...planText.matchAll(/^###\s+Task\s+([^:\n]+):[^\n]*(?:\n|$)/gmi)];
  return matches.flatMap((match, index) => ids.includes(match[1]!.trim())
    ? [planText.slice(match.index!, matches[index + 1]?.index ?? planText.length)] : []).join('\n');
}

function selectedStories(storiesText: string, ids: readonly string[]): string {
  if (ids.length === 0) return '';
  const matches = [...storiesText.matchAll(/^##\s+Story\s+([A-Za-z0-9._-]+)\b[^\n]*(?:\n|$)/gmi)];
  return matches.flatMap((match, index) => ids.includes(match[1]!)
    ? [storiesText.slice(match.index!, matches[index + 1]?.index ?? storiesText.length)] : []).join('\n');
}

function selectedDecisions(adrTexts: Readonly<Record<string, string>>, ids: readonly string[]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const id of ids) {
    const [stem, decision] = id.split('#');
    const text = adrTexts[stem!];
    if (!text || !decision) continue;
    const parsed = parseAdrDecisions(text);
    if (parsed.kind === 'decisions') {
      const passages = parsed.passages.get(decision.replace(/^D/, ''));
      if (passages) selected[id] = passages.join('\n');
    }
  }
  return selected;
}

/** Render only the decision passages that are in scope for a first review round. */
function allDecisionSections(adrTexts: Readonly<Record<string, string>>): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const [stem, text] of Object.entries(adrTexts)) {
    const parsed = parseAdrDecisions(text);
    if (parsed.kind !== 'decisions') continue;
    for (const [decision, passages] of parsed.passages) selected[`${stem}#D${decision}`] = passages.join('\n');
  }
  return selected;
}
export interface RunPlanReviewInput {
  worktreePath: string; canonicalPath?: string; planStem: string; config: HarnessConfig; runtimes: ProviderRuntimeSet; sessions: ProviderSessionStore;
  env?: NodeJS.ProcessEnv; configuredProviders?: readonly string[]; emit?: (event: Extract<ConductorEvent, { type: 'plan_review_dispatched' | 'plan_review_completed' | 'plan_review_finding_accepted' }>) => Promise<void>; onNotice?: (notice: string) => void; providerExecutor?: typeof executeProviderCandidates;
}
export async function runPlanReview(input: RunPlanReviewInput): Promise<PlanReviewArtifact> {
  const previousPath = join(input.worktreePath, '.docs', 'plan-review', `${input.planStem}.md`);
  const previousText = await readFile(previousPath, 'utf8').catch(() => '');
  const previous = previousText ? parsePlanReviewArtifact(previousText) : undefined;
  if (previous && !('kind' in previous) && previous.round >= 2) throw new Error(`plan review bound reached: ${previous.findings.filter((f) => f.severity === 'blocking').map((f) => `${f.id} ${f.summary}`).join('; ')}`);
  const source = await reviewInputs(input.worktreePath, input.planStem, input.canonicalPath);
  const host = resolveAuthoringHost(input.env);
  const candidates = orderReviewerCandidates({ config: input.config, host, configuredProviders: input.configuredProviders });
  if (!candidates.length) throw new Error('plan review has no configured reviewer provider');
  const rows = await Promise.all([
    testImpactCandidates({ worktreePath: input.worktreePath, planText: source.planText }),
    reachabilityCandidates({ worktreePath: input.worktreePath, planText: source.planText, architectureReviewText: source.architectureReviewText })
      .then((candidates) => candidates.map((candidate) => ({ ...candidate, evidence: candidate.evidence.replace(/^plan\.md:/, `.docs/plans/${input.planStem}.md:`) }))),
    Promise.resolve(dependencyOrderCandidates(source.planText)),
  ]);
  const prior = previous && !('kind' in previous) ? previous : undefined;
  const changed = prior ? diffReviewedDigests(prior.reviewedDigest, source.digest) : undefined;
  const reviewPlan = changed ? selectedPlanTasks(source.planText, changed.planTaskIds) : source.planText;
  const reviewStories = changed ? selectedStories(source.storiesText, changed.storyIds) : source.storiesText;
  const reviewDecisions = changed
    ? selectedDecisions(source.adrTexts, changed.adrDecisionIds)
    : allDecisionSections(source.adrTexts);
  const priorFindings = prior?.findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'significant') ?? [];
  const roundCandidates = changed
    ? rows.flat().filter((candidate: any) => changed.planTaskIds.includes(candidate.taskId) || priorFindings.some((finding) => finding.reference === `task ${candidate.taskId}` || finding.relatedReference === `task ${candidate.taskId}`))
    : rows.flat();
  const prompt = `$plan-review\n\nPLAN:\n${reviewPlan}\n\nSTORIES:\n${reviewStories}\n\nADR DECISIONS:\n${JSON.stringify(reviewDecisions)}\n\nCOHERENCE:\n${source.coherenceText}\n\nCANDIDATES:\n${JSON.stringify(roundCandidates)}${prior ? `\n\nPRIOR BLOCKING AND SIGNIFICANT FINDINGS:\n${JSON.stringify(priorFindings)}` : ''}`;
  const executor = input.providerExecutor ?? executeProviderCandidates;
  let findings: readonly import('./plan-review-contract.js').PlanReviewFinding[] | undefined;
  let used: string | undefined;
  for (const provider of candidates) {
    await input.emit?.({ type: 'plan_review_dispatched', round: previous && !('kind' in previous) ? previous.round + 1 : 1, reviewerProvider: provider, independence: classifyIndependence(host, provider) });
    const attempted = await executor({ step: 'plan_review', configuredProviders: [provider], runtimes: input.runtimes, sessions: input.sessions, config: input.config, nativeSchemaScratch: { worktreeRoot: input.worktreePath, repository: input.worktreePath, featureSlug: input.planStem }, options: { prompt, cwd: input.worktreePath, interactive: false, readOnlyReview: true, nativeSchema: PLAN_REVIEW_RESULT_SCHEMA } } as ExecuteProviderCandidatesInput);
    if (!attempted.success || attempted.finalStructuredResult === undefined) continue;
    const raw = attempted.finalStructuredResult;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw as Record<string, unknown>).length !== 1 || !Array.isArray((raw as { findings?: unknown }).findings)) continue;
    findings = (raw as { findings: unknown[] }).findings.flatMap((finding) => {
      const validation = validatePlanReviewResult({ findings: [finding] }, source);
      return validation.kind === 'accepted' ? validation.result.findings : [];
    });
    used = provider;
    break;
  }
  if (!findings || !used) throw new Error('plan review reviewer dispatch failed for every candidate');
  const resolved = priorFindings.filter((finding) => !findings.some((current) => current.id === finding.id || current.resolvesPrior === finding.id));
  const artifact: PlanReviewArtifact = {
    round: prior ? prior.round + 1 : 1,
    authoringHost: host,
    reviewerProvider: used,
    independence: classifyIndependence(host, used),
    findings,
    dispositions: [
      ...(prior?.dispositions ?? []),
      ...resolved.map((finding) => ({ findingId: finding.id, kind: 'resolved' as const, reason: 'not returned by round-2 reviewer' })),
    ],
    reviewedDigest: source.digest,
  };
  await mkdir(join(input.worktreePath, '.docs', 'plan-review'), { recursive: true });
  await writeFile(previousPath, renderPlanReviewArtifact(artifact), 'utf8');
  if (artifact.independence !== 'cross-provider') input.onNotice?.(`plan review independence: ${artifact.independence} (${host} authoring host, ${used} reviewer)`);
  const counts = (severity: 'blocking' | 'significant' | 'advisory') => artifact.findings.filter((f) => f.severity === severity).length;
  await input.emit?.({ type: 'plan_review_completed', round: artifact.round, reviewerProvider: used, independence: artifact.independence, blockingCount: counts('blocking'), significantCount: counts('significant'), advisoryCount: counts('advisory') });
  return artifact;
}
export async function acceptPlanReviewFinding(input: Pick<RunPlanReviewInput, 'worktreePath' | 'planStem' | 'emit'> & { findingId: string; reason: string }): Promise<void> {
  if (!input.reason.trim()) throw new Error('plan review acceptance reason is required');
  const path = join(input.worktreePath, '.docs', 'plan-review', `${input.planStem}.md`); const parsed = parsePlanReviewArtifact(await readFile(path, 'utf8'));
  if ('kind' in parsed) throw new Error('plan review artifact is invalid'); if (parsed.round < 2) throw new Error('plan review requires remaining round before acceptance');
  if (!parsed.findings.some((f) => f.id === input.findingId)) throw new Error(`unknown plan-review finding ${input.findingId}`);
  await writeFile(path, renderPlanReviewArtifact({ ...parsed, dispositions: [...parsed.dispositions, { findingId: input.findingId, kind: 'accepted', reason: input.reason }] }), 'utf8');
  await input.emit?.({ type: 'plan_review_finding_accepted', findingId: input.findingId, reason: input.reason });
}

/** Records an operator's acknowledgement after bounded review, without a model call. */
export async function acknowledgePlanReviewChanges(input: { worktreePath: string; canonicalPath?: string; planStem: string; reason: string }): Promise<void> {
  if (!input.reason.trim()) throw new Error('plan review acknowledgement reason is required');
  const path = join(input.worktreePath, '.docs', 'plan-review', `${input.planStem}.md`);
  const parsed = parsePlanReviewArtifact(await readFile(path, 'utf8'));
  if ('kind' in parsed) throw new Error('plan review artifact is invalid');
  if (parsed.round < 2) throw new Error('plan review requires remaining round before acknowledgement');
  const current = await reviewInputs(input.worktreePath, input.planStem, input.canonicalPath);
  await writeFile(path, renderPlanReviewArtifact({ ...parsed, reviewedDigest: current.digest }), 'utf8');
}
