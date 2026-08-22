import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import { resolveFreshBase, type GitRunner } from './rebase.js';
import {
  readBaseAdvanceHistory,
  readTestSuiteRemediations,
  type TestSuiteRemediationRecord,
} from './test-suite-remediation.js';
import type { AcceptedScopeWidening } from './per-task-commit-floor.js';
import { deriveBuildReviewRemovals, type BuildReviewRemovalContext } from './build-review-removals.js';
import {
  isEngineAppendedRemediationAmendment,
  readOperatorReseals,
  readRecordedAppendedRemediationTaskIds,
  type OperatorReseal,
} from './protected-artifact-seal.js';
import { FullSuiteVerifier, type FullSuiteInspectionResult } from './full-suite-verifier.js';
import type { FullSuitePassEvidence } from './full-suite-evidence.js';
import { parsePlanTaskVerifyOnly } from './autoheal.js';
import { parsePlanTaskPaths, parsePlanTaskPreserves } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { classifyTautologyPaths } from './build-review-test-quality-preflight.js';
import { parseCoversMarkers } from './covers-marker.js';

// ── Grader input assembly (build_review) ────────────────────────────────────
//
// Assembles the ONLY inputs the build_review grader sees: the diff since the
// repo's default branch, and the plan body. No task-status, transcript, or
// maker-summary access here — input isolation is the whole point (the grader
// must judge the diff against the plan, not the maker's narrative about it).

/** Grader inputs: the diff to review and the plan text it must satisfy. */
export interface BuildReviewInputs {
  /** `git diff <merge-base(baseRef, HEAD)>..HEAD`. Empty string signals
   * no changes to grade — the caller must write a FAIL verdict
   * "no diff to grade" rather than dispatch a grader. */
  diff: string;
  /** Raw contents of the plan file at `planPath`. */
  planBody: string;
  /** The resolved `git merge-base <baseRef> HEAD` sha the diff was computed
   * from — the exact commit the grader's diff is anchored to. */
  mergeBase: string;
  /** The ref the diff's merge-base was computed against (`origin/<default>`
   * or a local branch on fallback). */
  baseRef: string;
  /** Where the base came from — origin's discovered default, or the local
   * fallback (no remote / probe failure). */
  baseKind: 'remote' | 'local';
  /** The local tracking ref's sha at resolution time, or `null` on fallback. */
  trackingRefSha: string | null;
  /** The true remote head sha reported by the freshness probe, or `null` on
   * fallback. */
  remoteHeadSha: string | null;
  /** Whether the base was already fresh (tracking ref matched the remote
   * head, no fetch needed) — `false` on both "fetched a stale ref" and the
   * no-remote/probe-failure fallback. */
  fresh: boolean;
  /** Engine-recorded aggregate failures exposed after base advances. The
   * grader judges whether diff hunks implement them; they are not exemptions. */
  repairContext?: TestSuiteRemediationRecord[];
  /** Commit-local scope widenings accepted by the containment evaluator. */
  acceptedWidenings?: AcceptedScopeWidening[];
  /** Diff-derived removal evidence for the grader, never an exemption. */
  removalContext?: BuildReviewRemovalContext;
  /** Engine-parsed verify-only plan task evidence for the grader, never an exemption. */
  verifyOnlyContext?: readonly BuildReviewVerifyOnlyContext[];
  /** Operator-authorized protected-artifact reseals from the feature seal. */
  operatorReseals?: OperatorReseal[];
  /**
   * Grading provenance: which of the three repair-context cases this grading
   * ran under. Returned rather than emitted here so assembly stays strictly
   * `(git, planPath)` — the conductor turns it into one
   * `build_review_repair_context` event, exactly as it does for
   * `baseFreshness`/`build_review_base`. A plan outside a feature root has
   * no ledgers to join, so it classifies as `none_warranted`; the field is
   * absent only when classification itself failed.
   */
  repairProvenance?: BuildReviewRepairProvenance;
  /** The process-free, current green proof build_review is bound to. */
  testSuiteProof?: FullSuitePassEvidence;
  /** Immutable identity of every source value shared by the rubric fan-out. */
  sourceSnapshot?: BuildReviewSourceSnapshot;
}

/** One plan task declared as verify-only, with compact parser-derived review anchors. */
export interface BuildReviewVerifyOnlyContext {
  readonly taskId: string;
  readonly paths: readonly string[];
}

/** One behavior a plan task declares must retain equivalent coverage. */
export interface BuildReviewPreservationContext {
  readonly taskId: string;
  readonly behavior: string;
}

/** Inputs returned after the proof gate has frozen a source snapshot. */
export interface BuildReviewFrozenInputs extends BuildReviewInputs {
  readonly testSuiteProof: FullSuitePassEvidence;
  readonly sourceSnapshot: BuildReviewSourceSnapshot;
}

/** One frozen source view. Rubric branches receive projections of this value, never live reads. */
export interface BuildReviewSourceSnapshot {
  readonly digest: string;
  /** Stable identity of review content, independent of the checked-out commit provenance. */
  readonly contentDigest: string;
  readonly baseRef: string;
  readonly mergeBase: string;
  readonly headSha: string;
  readonly diff: string;
  readonly planBody: string;
  readonly repairContext: readonly TestSuiteRemediationRecord[];
  /** Accepted containment widenings sealed with the source read for Scope alone. */
  readonly acceptedWidenings: readonly AcceptedScopeWidening[];
  /** Operator-authorized reseals frozen with the source read for Scope alone; excluded from shared identity. */
  readonly operatorReseals?: readonly BuildReviewOperatorResealSnapshot[];
  readonly removalContext: {
    readonly deletedFiles: readonly string[];
    readonly removedDeclarations: readonly string[];
    readonly removedMembers: readonly { readonly declaration: string; readonly member: string }[];
    readonly removedTestAssertions?: readonly { readonly path: string; readonly line: string }[];
  };
  /** Engine-parsed verify-only plan task evidence frozen with the source read. */
  readonly verifyOnlyContext?: readonly BuildReviewVerifyOnlyContext[];
  /** Engine-parsed preserved-behavior plan evidence frozen with the source read. */
  readonly preservationContext?: readonly BuildReviewPreservationContext[];
  /** Static title evidence read from the graded HEAD, never the live worktree. */
  readonly changedTestTitles?: readonly BuildReviewChangedTestTitle[];
  /** Test-quality's closed, feature-local selector set. */
  readonly testQuality?: BuildReviewTestQualityScope;
}

/** One executable changed-test selector's declared title evidence. */
export interface BuildReviewChangedTestTitle {
  readonly selector: string;
  readonly titleText: string;
  /** True when static parsing could not safely recover every declared title. */
  readonly staticExtractionFallback: boolean;
}

/** A changed test whose declared Covers reference does not bind to this feature. */
export interface BuildReviewUnresolvedMarker {
  readonly selector: string;
  readonly reference: string;
}

/** Closed test-quality scope derived from the feature's active artifacts and graded diff. */
export interface BuildReviewTestQualityScope {
  /** Changed executable tests with at least one Covers reference bound to this feature. */
  readonly inScopeTests: readonly string[];
  /** Changed-test markers that name no criterion, FR, or task in this feature. */
  readonly unresolvedMarkers: readonly BuildReviewUnresolvedMarker[];
}

/** Immutable operator reseal record captured in a source snapshot. */
export interface BuildReviewOperatorResealSnapshot {
  readonly fromCommit: string;
  readonly toCommit: string;
  readonly paths: readonly string[];
  readonly reason: string;
}

/** Process-free proof inspection seam; it must never launch the aggregate suite. */
export interface BuildReviewInputOptions {
  readonly inspectTestSuite?: () => Promise<FullSuiteInspectionResult>;
  readonly acceptedWidenings?: readonly AcceptedScopeWidening[];
}

/** The three distinguishable grading-provenance cases (Task 24). */
export type BuildReviewRepairProvenance =
  | { disposition: 'context_available'; repairCount: number }
  | { disposition: 'no_join' }
  | { disposition: 'none_warranted' };

/**
 * Repo-relative paths that the scope floor always permits: engine-authored
 * pipeline/shipped state plus routine documentation and generated changelog
 * output. They are excluded from the graded diff because grading them against
 * the plan is incoherent — no plan task can ever describe harness machinery
 * output, so their presence reads to the Scope rubric as unplanned work and
 * kicks the build back over a file the builder did not write (observed on
 * `build-review-ci-watch-partial-block-1002`, whose engine-stamped
 * `.docs/shipped/<slug>.md` was cited as an out-of-scope finding).
 *
 * Deliberately narrow: only engine output plus the routine docs/generated
 * artifacts named above belong here. Other agent-authored paths stay in the
 * graded diff.
 */
export const MACHINERY_AUTHORED_PATHS: readonly string[] = [
  '.docs/shipped/',
  '.pipeline/',
  'docs/',
  'CHANGELOG.md',
];

/** Raised when the default branch's merge-base with HEAD cannot be computed. */
export class MergeBaseError extends Error {
  constructor(message: string, readonly ref: string) {
    super(message);
    this.name = 'MergeBaseError';
  }
}

/** A missing, failed, or stale aggregate proof blocks review before source reads or dispatch. */
export class TestSuiteProofError extends Error {
  constructor(readonly inspection: Exclude<FullSuiteInspectionResult, { status: 'CURRENT' }>) {
    super(`build_review requires CURRENT test_suite proof (got ${inspection.status})`);
    this.name = 'TestSuiteProofError';
  }
}

/**
 * The graded-diff pathspec exclusion for the feature's own plan, present only
 * when the plan's divergence from the graded base is EXACTLY the engine's own
 * recorded remediation-task append.
 *
 * The engine appends `### Task rem-*` blocks to the approved plan during
 * remediation and commits them as feature commits, so the graded diff showed
 * them as an amendment to an approved DECIDE artifact and Scope failed them as
 * an out-of-plan change — a finding no authority can grant and the feature
 * cannot remove, because the engine requires the blocks. The protected-artifact
 * seal already tolerates exactly this case; this reuses that same rule
 * (`isEngineAppendedRemediationAmendment` over the same recorded ids) rather
 * than inventing a second, drift-prone notion of "the engine wrote it".
 *
 * When the rule holds, the plan diff is by construction nothing but those
 * recorded blocks, so excluding the path removes engine bookkeeping and no
 * reviewable work. Any other amendment — an edited earlier line, an
 * unrecorded task id, prose — fails the rule and stays fully graded.
 * Fail-closed everywhere else: no recorded ids, or either side unreadable at
 * its commit, means no exclusion.
 */
async function engineAppendedPlanExclusion(
  git: GitRunner,
  mergeBaseSha: string,
  projectRoot: string,
  planPath: string,
): Promise<readonly string[]> {
  const recorded = await readRecordedAppendedRemediationTaskIds(projectRoot);
  if (recorded.length === 0) return [];
  const pathspec = relative(projectRoot, planPath);
  if (pathspec === '' || pathspec.startsWith('..')) return [];
  // Both ends of the graded diff exactly: `<mergeBase>..HEAD`.
  const [base, head] = await Promise.all([
    git(['show', `${mergeBaseSha}:${pathspec}`]),
    git(['show', `HEAD:${pathspec}`]),
  ]);
  if (base.exitCode !== 0 || head.exitCode !== 0) return [];
  return isEngineAppendedRemediationAmendment(
    Buffer.from(base.stdout, 'utf-8'),
    Buffer.from(head.stdout, 'utf-8'),
    recorded,
  )
    ? [`:(exclude)${pathspec}`]
    : [];
}

function projectRootForPlan(planPath: string): string {
  return basename(dirname(planPath)) === 'plans' && basename(dirname(dirname(planPath))) === '.docs'
    ? dirname(dirname(dirname(planPath)))
    : dirname(planPath);
}

function snapshotDigest(snapshot: Omit<BuildReviewSourceSnapshot, 'digest' | 'contentDigest'>): string {
  const { operatorReseals: _scopeOnlyReseals, ...sharedSnapshot } = snapshot;
  return `sha256:${createHash('sha256').update(JSON.stringify(sharedSnapshot)).digest('hex')}`;
}

function contentSnapshotDigest(snapshot: Pick<
  BuildReviewSourceSnapshot,
  'diff' | 'planBody' | 'repairContext' | 'removalContext' | 'verifyOnlyContext' | 'preservationContext' | 'testQuality'
>): string {
  const { diff, planBody, repairContext, removalContext, verifyOnlyContext, preservationContext, testQuality } = snapshot;
  return `sha256:${createHash('sha256').update(JSON.stringify({
    diff: withoutDiffBlobIdentities(diff),
    planBody,
    repairContext: semanticRepairContext(repairContext),
    removalContext,
    verifyOnlyContext,
    preservationContext,
    testQuality,
  })).digest('hex')}`;
}

/** Git's index header anchors a patch to blob objects without changing its reviewed bytes. */
function withoutDiffBlobIdentities(diff: string): string {
  return diff.replace(
    /^index [0-9a-f]+(?:,[0-9a-f]+)?\.\.[0-9a-f]+(?:,[0-9a-f]+)?(?= \d+$|$)/gmi,
    'index <blob>..<blob>',
  );
}

/** Repair-record identity and invalidation timing explain provenance, not remediation meaning. */
function semanticRepairContext(repairs: readonly TestSuiteRemediationRecord[]) {
  return repairs.map(({ gate, reason, diagnostic }) => ({ gate, reason, diagnostic }));
}

function changedPathsFromDiff(diff: string): readonly string[] {
  return [...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => match[2]!);
}

function activeStoriesPath(projectRoot: string, planPath: string, planBody: string): string | undefined {
  const planRepoPath = relative(projectRoot, planPath).replaceAll('\\', '/');
  const storiesRepoPath = resolvePlanStoriesPath(planRepoPath, planBody);
  return storiesRepoPath === null ? undefined : join(projectRoot, storiesRepoPath);
}

function markerReference(reference: { readonly kind: string; readonly id: string }): string {
  return reference.kind === 'task' ? `task:${reference.id}` : reference.id;
}

/**
 * Intersect changed executable tests with Covers references bound to the
 * feature's own active plan and its plan-selected stories artifact. The
 * artifact lookup is intentionally direct: a docs-directory scan could let
 * another feature's criterion silently widen this review.
 */
async function snapshotTestQualityScope(
  git: GitRunner,
  headSha: string,
  diff: string,
  projectRoot: string,
  planPath: string,
  planBody: string,
): Promise<BuildReviewTestQualityScope> {
  const storiesPath = activeStoriesPath(projectRoot, planPath, planBody);
  const storiesBody = storiesPath === undefined
    ? ''
    : await readFile(storiesPath, 'utf-8').catch(() => '');
  const criterionIds = new Set(
    [...storiesBody.matchAll(/\bS\d+\.\d+\b/gi)].map((match) => match[0].toUpperCase()),
  );
  const frIds = new Set(
    [...storiesBody.matchAll(/\bFR-\d+\b/gi)].map((match) => match[0].toUpperCase()),
  );
  const taskIds = new Set(parsePlanTaskPaths(planBody).keys());
  const selectors = classifyTautologyPaths(changedPathsFromDiff(diff)).tests;
  const sources = await Promise.all(selectors.map(async (selector) => {
    const result = await git(['show', `${headSha}:${selector}`]);
    return { selector, source: result.exitCode === 0 ? result.stdout : undefined };
  }));
  const inScopeTests: string[] = [];
  const unresolvedMarkers: BuildReviewUnresolvedMarker[] = [];

  for (const { selector, source } of sources) {
    if (source === undefined) continue;
    let bound = false;
    for (const reference of parseCoversMarkers(source)) {
      const resolved = reference.kind === 'criterion'
        ? criterionIds.has(reference.id.toUpperCase())
        : reference.kind === 'fr'
          ? frIds.has(reference.id.toUpperCase())
          : taskIds.has(reference.id);
      if (resolved) bound = true;
      else unresolvedMarkers.push({ selector, reference: markerReference(reference) });
    }
    if (bound) inScopeTests.push(selector);
  }

  return Object.freeze({
    inScopeTests: Object.freeze(inScopeTests),
    unresolvedMarkers: Object.freeze(unresolvedMarkers.sort((left, right) =>
      `${left.selector}\u0000${left.reference}`.localeCompare(`${right.selector}\u0000${right.reference}`),
    )),
  });
}

type StaticTestTitle = Pick<BuildReviewChangedTestTitle, 'titleText' | 'staticExtractionFallback'>;

const TEST_DECLARATION = /\b(describe|context|suite|it|test|specify)\s*\(/y;
const TEST_SUITE_NAMES = new Set(['describe', 'context', 'suite']);

function skipQuotedSource(source: string, index: number): number | undefined {
  const quote = source[index]!;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
    } else if (source[cursor] === quote) {
      return cursor + 1;
    }
  }
  return undefined;
}

function skipRegexLiteral(source: string, index: number): number | undefined {
  let inCharacterClass = false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
    } else if (source[cursor] === '[') {
      inCharacterClass = true;
    } else if (source[cursor] === ']') {
      inCharacterClass = false;
    } else if (source[cursor] === '/' && !inCharacterClass) {
      cursor += 1;
      while (/[a-z]/i.test(source[cursor] ?? '')) cursor += 1;
      return cursor;
    } else if (source[cursor] === '\n' || source[cursor] === '\r') {
      return undefined;
    }
  }
  return undefined;
}

function regexCanStartAt(source: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor]!)) cursor -= 1;
  if (cursor < 0) return true;
  if (/[([{:;,=!?&|^~+\-*%<>]/.test(source[cursor]!)) return true;
  const precedingWord = source.slice(0, cursor + 1).match(/[A-Za-z_$][\w$]*$/)?.[0];
  return precedingWord === 'return' || precedingWord === 'throw' || precedingWord === 'case';
}

/** Skip source trivia and literals so static extraction never treats their text as executable. */
function skipNonCodeSource(source: string, index: number): number | undefined {
  if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
    return skipQuotedSource(source, index);
  }
  if (source[index] === '/' && source[index + 1] === '/') {
    const newline = source.indexOf('\n', index + 2);
    return newline < 0 ? source.length : newline + 1;
  }
  if (source[index] === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2);
    return end < 0 ? undefined : end + 2;
  }
  if (source[index] === '/' && regexCanStartAt(source, index)) {
    return skipRegexLiteral(source, index);
  }
  return index;
}

function balancedSourceEnd(source: string, start: number, open: string, close: string): number | undefined {
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const next = skipNonCodeSource(source, cursor);
    if (next === undefined) return undefined;
    if (next !== cursor) {
      cursor = next - 1;
    } else if (source[cursor] === open) {
      depth += 1;
    } else if (source[cursor] === close && --depth === 0) {
      return cursor;
    }
  }
  return undefined;
}

function staticTitleArgument(source: string, index: number): { title?: string; next: number } {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  if (source[cursor] !== "'" && source[cursor] !== '"' && source[cursor] !== '`') return { next: cursor };
  const end = skipQuotedSource(source, cursor);
  if (end === undefined) return { next: source.length };
  const raw = source.slice(cursor + 1, end - 1);
  return raw.includes('${')
    ? { next: end }
    : { title: raw.replace(/\\(.)/g, '$1'), next: end };
}

function callbackBody(source: string, callStart: number, callEnd: number): { start: number; end: number } | undefined {
  const callbackSource = source.slice(callStart, callEnd);
  const arrowOffset = callbackSource.indexOf('=>');
  const functionOffset = /\bfunction\b/.exec(callbackSource)?.index;
  const isFunctionCallback = functionOffset !== undefined && (arrowOffset < 0 || functionOffset < arrowOffset);
  const callbackOffset = isFunctionCallback
    ? functionOffset + callbackSource.slice(functionOffset).indexOf('{')
    : arrowOffset;
  if (callbackOffset < 0) return undefined;
  let start = callStart + callbackOffset + (isFunctionCallback ? 0 : 2);
  while (/\s/.test(source[start] ?? '')) start += 1;
  if (source[start] !== '{') return { start, end: callEnd };
  const end = balancedSourceEnd(source, start, '{', '}');
  return end === undefined || end > callEnd ? undefined : { start: start + 1, end };
}

function staticTestTitles(source: string): readonly StaticTestTitle[] {
  const titles: StaticTestTitle[] = [];
  let malformed = false;
const collect = (start: number, end: number, ancestors: readonly string[], inheritedFallback: boolean): void => {
    for (let cursor = start; cursor < end;) {
      const next = skipNonCodeSource(source, cursor);
      if (next === undefined) {
        malformed = true;
        return;
      }
      if (next !== cursor) {
        cursor = next;
        continue;
      }
      TEST_DECLARATION.lastIndex = cursor;
      const match = TEST_DECLARATION.exec(source);
      if (match === null || match.index >= end) {
        cursor += 1;
        continue;
      }
      const callStart = cursor;
      const callEnd = balancedSourceEnd(source, TEST_DECLARATION.lastIndex - 1, '(', ')');
      if (callEnd === undefined || callEnd > end) {
        malformed = true;
        return;
      }
      const title = staticTitleArgument(source, TEST_DECLARATION.lastIndex);
      const fallback = inheritedFallback || title.title === undefined;
      if (TEST_SUITE_NAMES.has(match[1]!)) {
        const body = callbackBody(source, title.next, callEnd);
        if (body === undefined) malformed = true;
        else collect(body.start, body.end, title.title === undefined ? ancestors : [...ancestors, title.title], fallback);
      } else {
        titles.push(fallback
          ? { titleText: '', staticExtractionFallback: true }
          : { titleText: [...ancestors, title.title!].join(' > '), staticExtractionFallback: false });
      }
      cursor = callEnd + 1;
    }
  };
  collect(0, source.length, [], false);
  return malformed || titles.length === 0
    ? [{ titleText: '', staticExtractionFallback: true }]
    : titles;
}

async function snapshotChangedTestTitles(
  git: GitRunner,
  headSha: string,
  diff: string,
): Promise<readonly BuildReviewChangedTestTitle[]> {
  const selectors = classifyTautologyPaths(changedPathsFromDiff(diff)).tests;
  const titles = await Promise.all(selectors.map(async (selector) => {
    const result = await git(['show', `${headSha}:${selector}`]);
    const extracted = result.exitCode === 0
      ? staticTestTitles(result.stdout)
      : [{ titleText: '', staticExtractionFallback: true }];
    return extracted.map((title) => Object.freeze({ selector, ...title }));
  }));
  return Object.freeze(titles.flat());
}

function freezeAcceptedWidenings(widenings: readonly AcceptedScopeWidening[]): readonly AcceptedScopeWidening[] {
  return Object.freeze(widenings.map((widening) => Object.freeze({
    path: widening.path,
    rationale: widening.rationale,
    taskId: widening.taskId,
    sha: widening.sha,
    derived: widening.derived,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

/**
 * Assemble the build_review grader's inputs: the diff since the merge-base
 * of a freshly-resolved base ref and HEAD, plus the plan body. Inputs are
 * strictly `(git, planPath)` — no conductor state.
 *
 * Base resolution goes through `resolveFreshBase` (Task 2): when the local
 * tracking ref is stale relative to the true remote head, it fetches before
 * computing the merge-base, so build_review never grades a diff against a
 * stale origin snapshot. On no-remote/probe-failure, it falls back to the
 * pre-existing local-branch behavior — degraded, but still functional — and
 * emits one advisory log so operators can see why the base wasn't fresh.
 */
export async function assembleBuildReviewInputs(
  git: GitRunner,
  planPath: string,
  options: BuildReviewInputOptions = {},
): Promise<BuildReviewFrozenInputs> {
  const inspection = await (
    options.inspectTestSuite?.() ?? new FullSuiteVerifier({ projectRoot: projectRootForPlan(planPath) }).inspect()
  );
  if (inspection.status !== 'CURRENT') throw new TestSuiteProofError(inspection);

  const resolution = await resolveFreshBase(git);

  if (resolution.kind === 'local') {
    console.warn(
      `[build_review] base resolution degraded to local fallback (ref=${resolution.ref}); ` +
        'grading against a possibly stale base. No origin remote, or the freshness probe/fetch failed.',
    );
  }

  const baseRef = resolution.ref;

  const mergeBase = await git(['merge-base', baseRef, 'HEAD']);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || !mergeBaseSha) {
    throw new MergeBaseError(
      `git merge-base ${baseRef} HEAD failed: ${mergeBase.stderr || 'no merge base found'}`,
      baseRef,
    );
  }

  const planExclusion = await engineAppendedPlanExclusion(
    git,
    mergeBaseSha,
    projectRootForPlan(planPath),
    planPath,
  );

  const diffResult = await git([
    'diff',
    `${mergeBaseSha}..HEAD`,
    '--',
    '.',
    ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
    ...planExclusion,
  ]);
  if (diffResult.exitCode !== 0) {
    throw new MergeBaseError(
      `git diff ${mergeBaseSha}..HEAD failed: ${diffResult.stderr || 'unknown error'}`,
      baseRef,
    );
  }

  const planBody = await readFile(planPath, 'utf-8');

  const planTaskPaths = parsePlanTaskPaths(planBody);
  const verifyOnlyContext = [...parsePlanTaskVerifyOnly(planBody)]
    .filter(([, verifyOnly]) => verifyOnly)
    .map(([taskId]) => ({
      taskId,
      paths: [...(planTaskPaths.get(taskId) ?? [])],
    }));
  const preservationContext = [...parsePlanTaskPreserves(planBody)]
    .flatMap(([taskId, behaviors]) => behaviors.map((behavior) => ({ taskId, behavior })));

  const featureRoot = dirname(dirname(dirname(planPath)));
  const planIsInFeatureRoot =
    basename(dirname(planPath)) === 'plans' && basename(dirname(dirname(planPath))) === '.docs';

  const repairContext = planIsInFeatureRoot
    ? await readTestSuiteRemediations(featureRoot)
    : [];
  const operatorReseals = planIsInFeatureRoot
    ? await readOperatorReseals(featureRoot)
    : [];

  // Provenance is advisory: a failure to classify never fails input assembly,
  // it just leaves the grading unattributed.
  let repairProvenance: BuildReviewRepairProvenance | undefined;
  try {
    repairProvenance = repairContext.length > 0
      ? { disposition: 'context_available', repairCount: repairContext.length }
      : planIsInFeatureRoot && (await readBaseAdvanceHistory(featureRoot)).length > 0
        ? { disposition: 'no_join' }
        : { disposition: 'none_warranted' };
  } catch {
    repairProvenance = undefined;
  }

  const removalContext = deriveBuildReviewRemovals(diffResult.stdout);
  const changedTestTitles = await snapshotChangedTestTitles(git, inspection.evidence.provenanceHeadSha, diffResult.stdout);
  const testQuality = await snapshotTestQualityScope(
    git,
    inspection.evidence.provenanceHeadSha,
    diffResult.stdout,
    projectRootForPlan(planPath),
    planPath,
    planBody,
  );
  const snapshotWithoutDigest = {
    baseRef,
    mergeBase: mergeBaseSha,
    headSha: inspection.evidence.provenanceHeadSha,
    diff: diffResult.stdout,
    planBody,
    repairContext: Object.freeze([...repairContext]),
    acceptedWidenings: freezeAcceptedWidenings(options.acceptedWidenings ?? []),
    operatorReseals: Object.freeze(operatorReseals.map((reseal) => Object.freeze({
      fromCommit: reseal.fromCommit,
      toCommit: reseal.toCommit,
      paths: Object.freeze([...reseal.paths]),
      reason: reseal.reason,
    }))),
    removalContext: Object.freeze({
      deletedFiles: Object.freeze([...removalContext.deletedFiles]),
      removedDeclarations: Object.freeze([...removalContext.removedDeclarations]),
      removedMembers: Object.freeze([...removalContext.removedMembers]),
      removedTestAssertions: Object.freeze((removalContext.removedTestAssertions ?? []).map((assertion) => Object.freeze({
        path: assertion.path,
        line: assertion.line,
      }))),
    }),
    verifyOnlyContext: Object.freeze(verifyOnlyContext.map((context) => Object.freeze({
      taskId: context.taskId,
      paths: Object.freeze([...context.paths]),
    }))),
    preservationContext: Object.freeze(preservationContext.map((context) => Object.freeze({
      taskId: context.taskId,
      behavior: context.behavior,
    }))),
    changedTestTitles,
    testQuality,
  } satisfies Omit<BuildReviewSourceSnapshot, 'digest' | 'contentDigest'>;
  const sourceSnapshot = Object.freeze({
    ...snapshotWithoutDigest,
    digest: snapshotDigest(snapshotWithoutDigest),
    contentDigest: contentSnapshotDigest(snapshotWithoutDigest),
  });

  return {
    diff: diffResult.stdout,
    planBody,
    mergeBase: mergeBaseSha,
    baseRef,
    baseKind: resolution.kind,
    trackingRefSha: resolution.trackingRefSha,
    remoteHeadSha: resolution.remoteHeadSha,
    fresh: resolution.fresh,
    removalContext: sourceSnapshot.removalContext,
    verifyOnlyContext,
    repairContext,
    acceptedWidenings: [...sourceSnapshot.acceptedWidenings],
    operatorReseals,
    repairProvenance,
    testSuiteProof: inspection.evidence,
    sourceSnapshot,
  };
}
