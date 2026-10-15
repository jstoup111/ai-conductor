import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { HarnessConfig } from '../types/config.js';
import type { ConductorEvent } from '../types/events.js';
import { computeReviewedDigest, diffReviewedDigests, parsePlanReviewArtifact, renderPlanReviewArtifact, type PlanReviewArtifact } from './plan-review-artifact.js';
import { PLAN_REVIEW_LENSES, PLAN_REVIEW_RESULT_SCHEMA, PLAN_REVIEW_SEVERITIES, validatePlanReviewResult } from './plan-review-contract.js';
import { dependencyOrderCandidates, reachabilityCandidates, testImpactCandidates } from './plan-review-candidates.js';
import { classifyIndependence, orderReviewerCandidates, resolveAuthoringHost } from './plan-review-provider.js';
import type { ProviderRuntimeSet } from './provider-runtime.js';
import type { ProviderSessionStore } from './provider-session.js';
import { executeProviderCandidates, type ExecuteProviderCandidatesInput } from './provider-execution.js';
import { resolveIdeaFiles } from './engineer/spec-change-set.js';
import { parseAdrDecisions } from './artifacts.js';
import { selectPlanReviewAdrDecisionSections, selectPlanReviewAdrStems, selectPlanReviewAdrTexts } from './plan-review-adr-scope.js';

function isSchemaValidFinding(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const finding = value as Record<string, unknown>;
  const keys = ['id', 'severity', 'lens', 'artifact', 'reference', 'relatedReference', 'resolvesPrior', 'summary', 'evidence'];
  return Object.keys(finding).length === keys.length && Object.keys(finding).every((key) => keys.includes(key)) &&
    typeof finding.id === 'string' && finding.id.length > 0 &&
    typeof finding.severity === 'string' && (PLAN_REVIEW_SEVERITIES as readonly string[]).includes(finding.severity) &&
    typeof finding.lens === 'string' && (PLAN_REVIEW_LENSES as readonly string[]).includes(finding.lens) &&
    typeof finding.artifact === 'string' && finding.artifact.length > 0 &&
    typeof finding.reference === 'string' && finding.reference.length > 0 &&
    (finding.relatedReference === null || typeof finding.relatedReference === 'string' && finding.relatedReference.length > 0) &&
    (finding.resolvesPrior === null || typeof finding.resolvesPrior === 'string' && finding.resolvesPrior.length > 0) &&
    typeof finding.summary === 'string' && finding.summary.length > 0 &&
    Array.isArray(finding.evidence) && finding.evidence.length > 0 && finding.evidence.every((entry) => typeof entry === 'string' && entry.length > 0);
}

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
  const changedPaths = canonicalPath ? await resolveIdeaFiles(worktreePath, canonicalPath) : new Set<string>();
  const allAdrTexts: Record<string, string> = {};
  for (const stem of selectPlanReviewAdrStems({ planText, changedPaths: [...changedPaths] })) {
    try {
      allAdrTexts[stem] = await readFile(join(worktreePath, '.docs', 'decisions', `${stem}.md`), 'utf8');
    } catch {
      // A cited or changed ADR may be absent while a plan is being authored.
    }
  }
  const adrScope = { planText, adrTexts: allAdrTexts, changedPaths: [...changedPaths] };
  const adrTexts = selectPlanReviewAdrTexts(adrScope);
  const adrDecisionSections = selectPlanReviewAdrDecisionSections(adrScope);
  const sourceFiles: Record<string, string> = {};
  for (const path of await files(worktreePath)) if (!path.startsWith('.pipeline/')) sourceFiles[path] = await readFile(join(worktreePath, path), 'utf8').catch(() => '');
  const digest = computeReviewedDigest({ planText, storiesText, adrTexts: allAdrTexts, artifactTexts: { [` .docs/coherence/${planStem}.md`.trim()]: coherenceText }, changedPaths: [...changedPaths] });
  return { planText, storiesText, coherenceText, architectureReviewText, adrTexts, adrDecisionSections, sourceFiles, digest };
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

/**
 * A reviewer prompt above this size cannot be dispatched to the configured
 * providers; refusing early names what is oversized instead of reporting that
 * every reviewer failed.
 */
export const PLAN_REVIEW_MAX_PROMPT_CHARS = 400_000;

/** The reviewer reads source itself, so reachability rows carry a path count, not the list. */
function promptCandidates(candidates: readonly unknown[]): unknown[] {
  return candidates.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || !('searchedPaths' in candidate)) return candidate;
    const { searchedPaths, ...rest } = candidate as { searchedPaths: readonly string[] } & Record<string, unknown>;
    return { ...rest, searchedPathCount: searchedPaths.length };
  });
}

/** Render only the decision passages that are in scope for a first review round. */
export interface RunPlanReviewInput {
  worktreePath: string; canonicalPath?: string; planStem: string; config: HarnessConfig; runtimes: ProviderRuntimeSet; sessions: ProviderSessionStore;
  env?: NodeJS.ProcessEnv; configuredProviders?: readonly string[]; emit?: (event: Extract<ConductorEvent, { type: 'plan_review_dispatched' | 'plan_review_completed' | 'plan_review_finding_accepted' }>) => Promise<void>; onNotice?: (notice: string) => void; providerExecutor?: typeof executeProviderCandidates;
  onCandidateStart?: ExecuteProviderCandidatesInput['onCandidateStart'];
  /** Prompt budget; defaults to {@link PLAN_REVIEW_MAX_PROMPT_CHARS}. */
  maxPromptChars?: number;
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
    reachabilityCandidates({ worktreePath: input.worktreePath, planPath: `.docs/plans/${input.planStem}.md`, planText: source.planText, architectureReviewText: source.architectureReviewText }),
    Promise.resolve(dependencyOrderCandidates(source.planText)),
  ]);
  const prior = previous && !('kind' in previous) ? previous : undefined;
  const changed = prior ? diffReviewedDigests(prior.reviewedDigest, source.digest) : undefined;
  const reviewPlan = changed ? selectedPlanTasks(source.planText, changed.planTaskIds) : source.planText;
  const reviewStories = changed ? selectedStories(source.storiesText, changed.storyIds) : source.storiesText;
  const reviewDecisions = changed
    ? selectedDecisions(source.adrTexts, changed.adrDecisionIds)
    : source.adrDecisionSections;
  const priorFindings = prior?.findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'significant') ?? [];
  const roundCandidates = changed
    ? rows.flat().filter((candidate: any) => changed.planTaskIds.includes(candidate.taskId))
    : rows.flat();
  const decisionsJson = JSON.stringify(reviewDecisions);
  const candidatesJson = JSON.stringify(promptCandidates(roundCandidates));
  const prompt = `$plan-review\n\nPLAN:\n${reviewPlan}\n\nSTORIES:\n${reviewStories}\n\nADR DECISIONS:\n${decisionsJson}\n\nCOHERENCE:\n${source.coherenceText}\n\nCANDIDATES:\n${candidatesJson}${prior ? `\n\nPRIOR BLOCKING AND SIGNIFICANT FINDINGS:\n${JSON.stringify(priorFindings)}` : ''}`;
  const maxPromptChars = input.maxPromptChars ?? PLAN_REVIEW_MAX_PROMPT_CHARS;
  if (prompt.length > maxPromptChars) {
    throw new Error(`plan review prompt is too large: ${prompt.length} characters exceeds ${maxPromptChars} (plan ${reviewPlan.length}, stories ${reviewStories.length}, ADR decisions ${decisionsJson.length}, coherence ${source.coherenceText.length}, candidates ${candidatesJson.length})`);
  }
  const executor = input.providerExecutor ?? executeProviderCandidates;
  let findings: readonly import('./plan-review-contract.js').PlanReviewFinding[] | undefined;
  let used: string | undefined;
  for (const provider of candidates) {
    await input.emit?.({ type: 'plan_review_dispatched', round: previous && !('kind' in previous) ? previous.round + 1 : 1, reviewerProvider: provider, independence: classifyIndependence(host, provider) });
    const attempted = await executor({ step: 'plan_review', configuredProviders: [provider], runtimes: input.runtimes, sessions: input.sessions, config: input.config, onCandidateStart: input.onCandidateStart, nativeSchemaScratch: { worktreeRoot: input.worktreePath, repository: input.worktreePath, featureSlug: input.planStem }, options: { prompt, cwd: input.worktreePath, interactive: false, readOnlyReview: true, nativeSchema: PLAN_REVIEW_RESULT_SCHEMA } } as ExecuteProviderCandidatesInput);
    if (!attempted.success || attempted.finalStructuredResult === undefined) continue;
    const raw = attempted.finalStructuredResult;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw as Record<string, unknown>).length !== 1 || !Array.isArray((raw as { findings?: unknown }).findings)) continue;
    const rawFindings = (raw as { findings: unknown[] }).findings;
    if (!rawFindings.every(isSchemaValidFinding)) continue;
    findings = rawFindings.flatMap((finding) => {
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
