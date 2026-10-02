import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';

import {
  buildArtifactResolutionContext,
  resolveFeaturePlanPath,
  resolveFeaturePrdPaths,
} from './artifacts.js';
import { AcceptedWideningDecisionStore, type AcceptedWideningDecision } from './accepted-widenings.js';
import { readRemediationCaseStoreFeature, RemediationCaseStore, type RemediationCasePrdWideningRecord } from './remediation-case-store.js';
import { parseCoherenceArtifact, type CoherenceRow } from './coherence-parse.js';
import { parsePlanTaskBodies, parsePlanTaskDoneWhen, parsePlanTaskStoryIds } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { makeGitRunner, originDefaultBranch, resolveBase, type GitRunner } from './rebase.js';
import { readSealedStoryCriteria, splitStoryBlocks } from './story-criteria.js';

/** Incremented only when the engine-rendered PRD-audit input contract changes. */
export const PRD_AUDIT_PROJECTION_VERSION = 2;

const PRD_AUDIT_DIFF_EXCERPT_PER_FILE_BYTES = 256 * 1024;
const PRD_AUDIT_DIFF_EXCERPT_TOTAL_BYTES = 512 * 1024;

/** Largest observed normal source inputs at the time these engineering bounds were set. */
export const PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES = {
  planIntentBytes: 1_477,
  planTasksBytes: 188_016,
  criteriaBytes: 43_226,
  prdIntentBytes: 17_991,
  coherenceBytes: 82_354,
  historyBytes: 0,
} as const;

/** A non-empty history allowance when the repository corpus has no current history artifact. */
export const PRD_AUDIT_PROJECTION_MIN_HISTORY_BYTES = 256 * 1024;

/** Allows the versioned projection wrapper and JSON structure around its bounded sections. */
export const PRD_AUDIT_PROJECTION_ENVELOPE_OVERHEAD_BYTES = 64 * 1024;

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

const PRD_AUDIT_PROJECTION_COMPONENT_LIMITS = {
  planIntentBytes: roundUpPowerOfTwo(Math.max(256 * 1024, PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.planIntentBytes)),
  planTasksBytes: roundUpPowerOfTwo(Math.max(256 * 1024, PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.planTasksBytes)),
  criteriaBytes: roundUpPowerOfTwo(Math.max(256 * 1024, PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.criteriaBytes)),
  prdIntentBytes: roundUpPowerOfTwo(PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.prdIntentBytes),
  coherenceBytes: roundUpPowerOfTwo(PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.coherenceBytes),
  historyBytes: roundUpPowerOfTwo(Math.max(PRD_AUDIT_PROJECTION_MIN_HISTORY_BYTES, PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES.historyBytes)),
} as const;

const PRD_AUDIT_PROJECTION_TOTAL_LIMIT_BYTES = roundUpPowerOfTwo(
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.planIntentBytes +
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.planTasksBytes +
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.criteriaBytes +
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.prdIntentBytes +
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.coherenceBytes +
  PRD_AUDIT_PROJECTION_COMPONENT_LIMITS.historyBytes +
  PRD_AUDIT_DIFF_EXCERPT_TOTAL_BYTES +
  PRD_AUDIT_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
);

export const PRD_AUDIT_PROJECTION_LIMITS = {
  ...PRD_AUDIT_PROJECTION_COMPONENT_LIMITS,
  totalBytes: PRD_AUDIT_PROJECTION_TOTAL_LIMIT_BYTES,
} as const;

export interface PrdAuditProjectionLimits {
  readonly planIntentBytes: number;
  readonly planTasksBytes: number;
  readonly criteriaBytes: number;
  readonly prdIntentBytes: number;
  readonly coherenceBytes: number;
  readonly historyBytes: number;
  readonly totalBytes: number;
}

export interface PrdAuditProjection {
  readonly version: typeof PRD_AUDIT_PROJECTION_VERSION;
  readonly plan: { readonly intent: string };
  readonly criteria: readonly {
    readonly id: string;
    readonly storyId: string;
    readonly kind: 'happy' | 'negative';
    readonly text: string;
    /** Requirement ids explicitly mapped by this story, never reviewer prose. */
    readonly requirementIds: readonly string[];
  }[];
  readonly tasks: readonly {
    readonly id: string;
    readonly storyIds: readonly string[];
    readonly doneWhen: readonly string[];
  }[];
  readonly prd:
    | { readonly kind: 'absent' }
    | {
        /** Every feature-matching PRD stays available to the reviewer. */
        readonly sources: readonly { readonly path: string; readonly requirements: readonly { readonly id: string; readonly text: string }[] }[];
        /** Compatibility view of the first deterministic source. */
        readonly path: string;
        readonly requirements: readonly { readonly id: string; readonly text: string }[];
      };
  readonly coherence: readonly CoherenceRow[] | { readonly kind: 'absent' };
  readonly changes: {
    readonly base: string;
    readonly head: string;
    readonly changedFiles: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
    readonly excerpts: readonly string[];
    readonly omittedFiles: readonly {
      readonly path: string;
      readonly digest: string;
      readonly locator: {
        readonly kind: 'git-diff';
        readonly range: string;
        readonly path: string;
      };
    }[];
  };
  readonly history:
    | { readonly kind: 'absent' }
  | { readonly decisions: readonly AcceptedWideningDecision[]; readonly cases: readonly RemediationCasePrdWideningRecord[] };
}

export type PrdAuditProjectionResult =
  | { readonly ok: true; readonly projection: PrdAuditProjection }
  | {
      readonly ok: false;
      readonly fault: {
        readonly dimension: string;
        readonly source?: string;
        readonly detail?: string;
        readonly actual?: number;
        readonly limit?: number;
      };
    };

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

function projectionLimitFault(
  projection: PrdAuditProjection,
  limits: PrdAuditProjectionLimits,
): Extract<PrdAuditProjectionResult, { ok: false }> | undefined {
  const sections: readonly { readonly dimension: string; readonly actual: number; readonly limit: number }[] = [
    { dimension: 'plan-intent', actual: serializedBytes(projection.plan), limit: limits.planIntentBytes },
    { dimension: 'plan-tasks', actual: serializedBytes(projection.tasks), limit: limits.planTasksBytes },
    { dimension: 'criteria', actual: serializedBytes(projection.criteria), limit: limits.criteriaBytes },
    { dimension: 'prd-intent', actual: serializedBytes(projection.prd), limit: limits.prdIntentBytes },
    { dimension: 'coherence', actual: serializedBytes(projection.coherence), limit: limits.coherenceBytes },
    { dimension: 'history', actual: serializedBytes(projection.history), limit: limits.historyBytes },
    { dimension: 'total', actual: serializedBytes(projection), limit: limits.totalBytes },
  ];
  const overflow = sections.find(({ actual, limit }) => actual > limit);
  return overflow === undefined ? undefined : { ok: false, fault: overflow };
}

function repoPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function planIntent(plan: string): string | undefined {
  const match = /^##\s+Technical Approach\s*$/im.exec(plan);
  if (!match || match.index === undefined) return undefined;
  const section = plan.slice(match.index + match[0].length).split(/^##\s+/m, 1)[0] ?? '';
  return section.split('\n').map((line) => line.trim()).find(Boolean);
}

function criteriaFromStories(stories: string): {
  readonly criteria: PrdAuditProjection['criteria'];
  readonly malformed: readonly string[];
} {
  const sealedCriteria = readSealedStoryCriteria(stories);
  if (!sealedCriteria.ok) return { criteria: [], malformed: sealedCriteria.diagnostics.map((diagnostic) => diagnostic.detail) };

  const requirementIdsByStory = new Map(splitStoryBlocks(stories)
    .filter((block): block is typeof block & { readonly id: string } => block.id !== undefined)
    .map((block) => [
      block.id,
      [...block.text.matchAll(/^\s*\*\*Requirements?\s*:\*\*\s*(.+?)\s*$/gim)]
        .flatMap((match) => [...match[1].matchAll(/\bFR-\d+[A-Za-z]?\b/gi)].map((id) => id[0].toUpperCase())),
    ]));
  return {
    criteria: sealedCriteria.criteria.map((criterion) => ({
      ...criterion,
      requirementIds: requirementIdsByStory.get(criterion.storyId) ?? [],
    })),
    malformed: [],
  };
}

function prdRequirements(prd: string): { readonly id: string; readonly text: string }[] {
  const heading = /^##\s+Functional Requirements\s*$/im.exec(prd);
  if (!heading || heading.index === undefined) return [];
  const section = prd.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? '';
  const requirements: { id: string; text: string }[] = [];
  for (const line of section.split('\n')) {
    const match = line.match(/\b(FR-\d+[A-Za-z]?)(?:\*\*)?\s*:\s*(.+)$/i);
    if (!match) continue;
    const id = match[1].toUpperCase();
    const text = match[2].replace(/^\*\*|\*\*$/g, '').trim();
    if (text && !requirements.some((requirement) => requirement.id === id)) requirements.push({ id, text });
  }
  return requirements;
}

function parseNumstat(text: string): PrdAuditProjection['changes']['changedFiles'] {
  return text.split('\n').filter(Boolean).map((line) => {
    const [added, deleted, path] = line.split('\t');
    return { path, additions: Number.parseInt(added, 10) || 0, deletions: Number.parseInt(deleted, 10) || 0 };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function decodeGitQuotedPath(encoded: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index]!;
    if (character !== '\\') {
      bytes.push(...Buffer.from(character));
      continue;
    }
    const escaped = encoded[index + 1];
    if (escaped !== undefined && /[0-7]/.test(escaped) && /^[0-7]{3}$/.test(encoded.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    const escapedBytes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
    bytes.push(escaped === undefined ? 92 : escapedBytes[escaped] ?? escaped.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString('utf-8');
}

function diffPathFromHeader(content: string): string | undefined {
  const header = content.match(/^diff --git (.+)$/m)?.[1];
  if (header === undefined) return undefined;
  const quoted = header.match(/^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/);
  if (quoted) return decodeGitQuotedPath(quoted[2]!);
  return header.match(/^a\/.* b\/(.+)$/)?.[1];
}

function boundedDiffExcerpts(
  diffText: string,
  range: string,
): Pick<PrdAuditProjection['changes'], 'excerpts' | 'omittedFiles'> | undefined {
  const excerpts: string[] = [];
  const omittedFiles: PrdAuditProjection['changes']['omittedFiles'][number][] = [];
  const files: { path: string; content: string }[] = [];
  for (const content of diffText.split(/(?=^diff --git )/m).filter(Boolean)) {
    const path = diffPathFromHeader(content);
    if (path === undefined) return undefined;
    files.push({ path, content });
  }

  let includedBytes = 0;
  for (const { path, content } of files.sort((left, right) => left.path.localeCompare(right.path))) {
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > PRD_AUDIT_DIFF_EXCERPT_PER_FILE_BYTES || includedBytes + bytes > PRD_AUDIT_DIFF_EXCERPT_TOTAL_BYTES) {
      omittedFiles.push({
        path,
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        locator: { kind: 'git-diff', range, path },
      });
      continue;
    }
    includedBytes += bytes;
    excerpts.push(content);
  }
  return { excerpts, omittedFiles };
}

async function discoverLocalBase(git: GitRunner): Promise<string> {
  const fromOrigin = await originDefaultBranch(git);
  if (fromOrigin) return fromOrigin;
  const current = (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const branches = (await git(['branch', '--format=%(refname:short)'])).stdout
    .split('\n').map((line) => line.trim()).filter(Boolean);
  for (const candidate of ['main', 'master', 'trunk']) {
    if (branches.includes(candidate) && candidate !== current) return candidate;
  }
  return branches.find((branch) => branch !== current) ?? 'main';
}

async function scopedChanges(projectRoot: string): Promise<Extract<PrdAuditProjectionResult, { ok: true }>['projection']['changes'] | undefined> {
  const git = makeGitRunner(projectRoot);
  const base = await resolveBase(git, await discoverLocalBase(git));
  const [baseSha, headSha] = await Promise.all([git(['rev-parse', base.ref]), git(['rev-parse', 'HEAD'])]);
  if (baseSha.exitCode !== 0 || headSha.exitCode !== 0) return undefined;
  const mergeBase = await git(['merge-base', baseSha.stdout.trim(), headSha.stdout.trim()]);
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) return undefined;
  const range = `${mergeBase.stdout.trim()}..${headSha.stdout.trim()}`;
  const [changes, diff] = await Promise.all([git(['diff', '--numstat', range]), git(['diff', range])]);
  if (changes.exitCode !== 0 || diff.exitCode !== 0) return undefined;
  const excerpts = boundedDiffExcerpts(diff.stdout, range);
  if (excerpts === undefined) return undefined;
  return { base: mergeBase.stdout.trim(), head: headSha.stdout.trim(), changedFiles: parseNumstat(changes.stdout), ...excerpts };
}

type WideningHistoryResult =
  | { readonly kind: 'available'; readonly history: PrdAuditProjection['history'] }
  | { readonly kind: 'fault'; readonly detail: string };

async function wideningHistory(projectRoot: string, activeFeature: string): Promise<WideningHistoryResult> {
  const path = join(projectRoot, '.pipeline', 'accepted-widenings.json');
  const source = '.pipeline/accepted-widenings.json';
  let raw: { feature?: { repository?: unknown; feature?: unknown } } | undefined;
  try {
    raw = JSON.parse(await readFile(path, 'utf-8')) as typeof raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { kind: 'fault', detail: `widening history at ${source} is corrupt` };
  }
  const featureRead = await readRemediationCaseStoreFeature(projectRoot);
  if (!featureRead.ok) return { kind: 'fault', detail: 'widening case history is corrupt' };
  if (featureRead.feature !== undefined && featureRead.feature.feature !== activeFeature) {
    return { kind: 'fault', detail: 'widening case history at .pipeline/remediation-cases.json is foreign to the active feature' };
  }
  if (raw === undefined) {
    if (featureRead.feature === undefined) return { kind: 'available', history: { kind: 'absent' } };
    const cases = await new RemediationCaseStore(projectRoot, featureRead.feature).read();
    if (!cases.ok) return { kind: 'fault', detail: 'widening case history is corrupt' };
    return { kind: 'available', history: { decisions: [], cases: cases.state.version === 'v2' ? cases.state.prdWideningCases : [] } };
  }
  if (typeof raw.feature?.repository !== 'string') return { kind: 'fault', detail: `widening history at ${source} is corrupt` };
  const read = await new AcceptedWideningDecisionStore(projectRoot, {
    version: 1,
    repository: raw.feature.repository,
    feature: activeFeature,
  }).read();
  if (read.kind === 'valid') {
    if (featureRead.feature === undefined) return { kind: 'available', history: { decisions: read.state.decisions, cases: [] } };
    const cases = await new RemediationCaseStore(projectRoot, featureRead.feature).read();
    if (!cases.ok) return { kind: 'fault', detail: 'widening case history is corrupt' };
    return { kind: 'available', history: { decisions: read.state.decisions, cases: cases.state.version === 'v2' ? cases.state.prdWideningCases : [] } };
  }
  if (read.kind === 'foreign-feature') return { kind: 'fault', detail: `widening history at ${source} is foreign to the active feature` };
  if (read.kind === 'unsupported') return { kind: 'fault', detail: `widening history at ${source} has an unsupported version` };
  return { kind: 'fault', detail: `widening history at ${source} is corrupt` };
}

/** Build the engine-owned source projection used by the managed PRD audit. */
export async function buildPrdAuditProjection(
  projectRoot: string,
  featureDesc?: string,
  limitOverrides: Partial<PrdAuditProjectionLimits> = {},
): Promise<PrdAuditProjectionResult> {
  const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (!planPath) return { ok: false, fault: { dimension: 'plan', detail: 'active plan is unavailable' } };

  let plan: string;
  try {
    plan = await readFile(isAbsolute(planPath) ? planPath : join(projectRoot, planPath), 'utf-8');
  } catch {
    return { ok: false, fault: { dimension: 'plan', detail: 'active plan is unreadable' } };
  }
  const intent = planIntent(plan);
  const storiesRepoPath = resolvePlanStoriesPath(repoPath(projectRoot, planPath), plan);
  if (!intent || !storiesRepoPath) return { ok: false, fault: { dimension: 'plan', detail: 'active plan has incomplete audit context' } };

  let stories: string;
  try {
    stories = await readFile(join(projectRoot, storiesRepoPath), 'utf-8');
  } catch {
    return { ok: false, fault: { source: storiesRepoPath, dimension: 'stories', detail: 'sealed stories are unreadable' } };
  }
  const parsedCriteria = criteriaFromStories(stories);
  if (parsedCriteria.malformed.length > 0) {
    return {
      ok: false,
      fault: { source: storiesRepoPath, dimension: 'malformed-criteria', detail: parsedCriteria.malformed.join('; ') },
    };
  }
  const criteria = parsedCriteria.criteria;
  const taskBodies = parsePlanTaskBodies(plan);
  const doneWhen = parsePlanTaskDoneWhen(plan);
  const tasks = [...taskBodies].map(([id, body]) => ({ id, storyIds: parsePlanTaskStoryIds(body), doneWhen: doneWhen.get(id) ?? [] }));
  if (doneWhen.malformedTaskIds.size > 0) {
    return { ok: false, fault: { dimension: 'plan task completion conditions', detail: `tasks with malformed Done when blocks: ${[...doneWhen.malformedTaskIds].join(', ')}` } };
  }
  const tasksWithoutDoneWhen = tasks.filter((task) => task.doneWhen.length === 0).map((task) => task.id);
  if (tasksWithoutDoneWhen.length > 0) {
    return { ok: false, fault: { dimension: 'plan task completion conditions', detail: `tasks missing Done when checks: ${tasksWithoutDoneWhen.join(', ')}` } };
  }
  if (criteria.length === 0 || tasks.length === 0) return { ok: false, fault: { dimension: 'obligations', detail: 'active stories or plan contain no audit obligations' } };

  const coherencePath = join(projectRoot, '.docs', 'coherence', `${basename(planPath, '.md')}.md`);
  let coherence: PrdAuditProjection['coherence'] = { kind: 'absent' };
  try {
    const parsed = parseCoherenceArtifact(await readFile(coherencePath, 'utf-8'));
    if (!parsed.ok) return { ok: false, fault: { dimension: 'coherence', detail: parsed.reason } };
    coherence = parsed.rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, fault: { dimension: 'coherence', detail: 'active coherence is unreadable' } };
  }

  const context = await buildArtifactResolutionContext(projectRoot, { planPath, featureDesc });
  const prdPaths = await resolveFeaturePrdPaths(projectRoot, context);
  if (prdPaths.length === 0 && Array.isArray(coherence) && coherence.some((row) => row.rowClass === 'fr')) {
    return { ok: false, fault: { dimension: 'prd', detail: 'active PRD required by coherence is unavailable' } };
  }
  let prd: PrdAuditProjection['prd'] = { kind: 'absent' };
  if (prdPaths.length > 0) {
    try {
      const sources = await Promise.all(prdPaths.sort().map(async (prdPath) => ({
        path: repoPath(projectRoot, prdPath),
        requirements: prdRequirements(await readFile(prdPath, 'utf-8')),
      })));
      const first = sources[0]!;
      prd = { sources, path: first.path, requirements: first.requirements };
    } catch {
      return { ok: false, fault: { dimension: 'prd', detail: 'active PRD is unreadable' } };
    }
  }

  const [changes, history] = await Promise.all([scopedChanges(projectRoot), wideningHistory(projectRoot, basename(planPath, '.md'))]);
  if (!changes) return { ok: false, fault: { dimension: 'changes', detail: 'scoped git changes are unavailable' } };
  if (history.kind === 'fault') return { ok: false, fault: { dimension: 'history', detail: history.detail } };

  const projection: PrdAuditProjection = {
    version: PRD_AUDIT_PROJECTION_VERSION,
    plan: { intent },
    criteria,
    tasks,
    prd,
    coherence,
    changes,
    history: history.history,
  };
  const fault = projectionLimitFault(projection, { ...PRD_AUDIT_PROJECTION_LIMITS, ...limitOverrides });
  if (fault) return fault;
  return { ok: true, projection };
}
