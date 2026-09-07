import { createHash } from 'node:crypto';
import { basename, dirname, relative } from 'node:path';
import { resolveFreshBase, type GitRunner } from './rebase.js';
import {
  readBaseAdvanceHistory,
  readTestSuiteRemediations,
  type TestSuiteRemediationRecord,
} from './test-suite-remediation.js';
import { deriveBuildReviewRemovals, type BuildReviewRemovalContext } from './build-review-removals.js';
import {
  isEngineAppendedRemediationAmendment,
  readRecordedAppendedRemediationTaskIds,
} from './protected-artifact-seal.js';
import { FullSuiteVerifier, type FullSuiteInspectionResult } from './full-suite-verifier.js';
import type { FullSuitePassEvidence } from './full-suite-evidence.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import {
  analyzeBuildReviewTestScope,
  type BuildReviewTestScope,
  type BuildReviewTestScopeInput,
  type BuildReviewTestSourceReference,
  unavailableBuildReviewTestScope,
} from './build-review-test-scope.js';
import type { TestDeclarationSpan } from './build-review-test-declarations.js';
import { discoverBuildReviewScopeDependencies } from './build-review-scope-dependencies.js';
import {
  BuildReviewScopeSource,
  safeRepoRelativePath,
  type BuildReviewPathChange,
} from './build-review-scope-source.js';

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
  /** Diff-derived removal evidence for the grader, never an exemption. */
  removalContext?: BuildReviewRemovalContext;
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
  readonly removalContext: {
    readonly deletedFiles: readonly string[];
    readonly removedDeclarations: readonly string[];
    readonly removedMembers: readonly { readonly declaration: string; readonly member: string }[];
    readonly removedTestAssertions?: readonly { readonly path: string; readonly line: string }[];
  };
  /** Static title evidence read from the graded HEAD, never the live worktree. */
  readonly changedTestTitles?: readonly BuildReviewChangedTestTitle[];
  /** Test-quality's closed, feature-local selector set. */
  readonly testQuality?: BuildReviewTestQualityScope;
  /**
   * Typed, source-bound test-quality analysis.  This is the authoritative
   * assembly result; the compact legacy selector/title fields remain only
   * until the v3 projection consumes this value directly.
   */
  readonly testScope?: BuildReviewTestScope;
  /** Version of the syntax/binding analysis contract that produced testScope. */
  readonly testScopeAnalysisVersion?: string;
  /**
   * Region bytes read from the same pinned blobs as `testScope`. Projection
   * consumes these records directly; it must never refill them from HEAD or
   * the worktree while deriving its identity.
   */
  readonly testScopeEvidence?: readonly BuildReviewPinnedScopeEvidence[];
  /** Machine-readable changed paths from the pinned diff, retaining rename pairs. */
  readonly sourceChanges?: readonly BuildReviewPathChange[];
}

/** One executable changed-test selector's declared title evidence. */
export interface BuildReviewChangedTestTitle {
  readonly selector: string;
  readonly titleText: string;
  /** True when static parsing could not safely recover every declared title. */
  readonly staticExtractionFallback: boolean;
}

/** One compact, deduplicated source region that a v3 scope record references. */
export interface BuildReviewPinnedScopeEvidence {
  readonly id: string;
  readonly source: { readonly fileName: string; readonly side: 'base' | 'head' };
  readonly region: TestDeclarationSpan;
  /** One-based source lines for the exact pinned character region. */
  readonly startLine?: number;
  readonly endLine?: number;
  readonly content: string;
  readonly contentHash: string;
}

/** A changed test whose declared Covers reference does not bind to this feature. */
export interface BuildReviewUnresolvedMarker {
  readonly selector: string;
  readonly reference: string;
}

/** Closed test-quality scope derived from the feature's active artifacts and graded diff. */
export interface BuildReviewTestQualityScope {
  /** Changed executable tests with an established Covers binding in this feature. */
  readonly inScopeTests: readonly string[];
  /** Conservative file union for counterfactual execution, including concrete candidates. */
  readonly counterfactualFileSelectors: readonly string[];
  /** Changed-test markers that name no criterion, FR, or task in this feature. */
  readonly unresolvedMarkers: readonly BuildReviewUnresolvedMarker[];
}

/** Process-free proof inspection seam; it must never launch the aggregate suite. */
export interface BuildReviewInputOptions {
  readonly inspectTestSuite?: () => Promise<FullSuiteInspectionResult>;
  /** Test seam for a parser/analyzer failure; consumer source is never loaded. */
  readonly analyzeTestScope?: (input: BuildReviewTestScopeInput) => BuildReviewTestScope;
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
  source: BuildReviewScopeSource,
  mergeBaseSha: string,
  projectRoot: string,
  planRepoPath: string,
  headSha: string,
): Promise<readonly string[]> {
  const recorded = await readRecordedAppendedRemediationTaskIds(projectRoot);
  if (recorded.length === 0) return [];
  let pathspec: string;
  try {
    pathspec = safeRepoRelativePath(planRepoPath);
  } catch {
    return [];
  }
  // Both ends of the graded diff exactly: `<mergeBase>..HEAD`.
  const [base, head] = await Promise.all([
    source.readAtOptional(mergeBaseSha, pathspec),
    source.readAtOptional(headSha, pathspec),
  ]);
  if (base.kind === 'absent' || head.kind === 'absent') return [];
  return isEngineAppendedRemediationAmendment(
    Buffer.from(base.value, 'utf-8'),
    Buffer.from(head.value, 'utf-8'),
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
  return `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
}

function contentSnapshotDigest(snapshot: Pick<
  BuildReviewSourceSnapshot,
  'diff' | 'planBody' | 'repairContext' | 'removalContext' | 'testQuality' | 'testScope' | 'testScopeAnalysisVersion' | 'testScopeEvidence'
>): string {
  const { diff, planBody, repairContext, removalContext, testQuality, testScope, testScopeAnalysisVersion, testScopeEvidence } = snapshot;
  return `sha256:${createHash('sha256').update(JSON.stringify({
    diff: withoutDiffBlobIdentities(diff),
    planBody,
    repairContext: semanticRepairContext(repairContext),
    removalContext,
    testQuality,
    testScope,
    testScopeAnalysisVersion,
    testScopeEvidence,
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

function activeStoriesPath(planRepoPath: string, planBody: string): string | undefined {
  const storiesRepoPath = resolvePlanStoriesPath(planRepoPath, planBody);
  return storiesRepoPath === null ? undefined : storiesRepoPath;
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:test|tests)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function markerReferenceForScope(reference: { readonly kind: string; readonly id: string }): string {
  return reference.kind === 'task' ? `task:${reference.id}` : reference.id;
}

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeRecursively((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

interface ScopedTestFile {
  readonly path: string;
  readonly basePath: string;
  readonly baseText: string;
  readonly headText: string;
  readonly scope: BuildReviewTestScope;
}

function mergeTestScopes(scopes: readonly BuildReviewTestScope[]): BuildReviewTestScope {
  return freezeRecursively({
    changedDeclarations: scopes.flatMap((scope) => scope.changedDeclarations),
    targets: scopes.flatMap((scope) => scope.targets),
    candidates: scopes.flatMap((scope) => scope.candidates),
    notes: scopes.flatMap((scope) => scope.notes),
    affectedGroups: scopes.flatMap((scope) => scope.affectedGroups),
    sharedSources: scopes.flatMap((scope) => scope.sharedSources),
  });
}

type PinnedScopeSourceSide = 'base' | 'head';

interface PinnedScopeRegion {
  readonly source: { readonly fileName: string; readonly side: PinnedScopeSourceSide };
  readonly region?: TestDeclarationSpan;
}

function scopeEvidenceKey(reference: PinnedScopeRegion): string {
  const { source, region } = reference;
  return `${source.side}\u0000${source.fileName}\u0000${region?.start ?? 0}\u0000${region?.end ?? -1}`;
}

function frozenScopeReference(
  fileName: string,
  region: TestDeclarationSpan,
  side: PinnedScopeSourceSide = 'head',
): PinnedScopeRegion {
  return { source: { fileName, side }, region };
}

function associationSide(kind: 'added' | 'removed'): PinnedScopeSourceSide {
  return kind === 'removed' ? 'base' : 'head';
}

/**
 * Extract every region the typed scope itself can cite, then capture its bytes
 * from the assembly's immutable blob reader. This is intentionally a data
 * copy, not a later source read by projection or a provider.
 */
async function pinScopeEvidence(
  files: readonly ScopedTestFile[],
  source: BuildReviewScopeSource,
  mergeBaseSha: string,
): Promise<readonly BuildReviewPinnedScopeEvidence[]> {
  const references = new Map<string, PinnedScopeRegion>();
  const add = (reference: PinnedScopeRegion): void => {
    references.set(scopeEvidenceKey(reference), reference);
  };
  const addSourceReference = (reference: BuildReviewTestSourceReference): void => add(reference);
  const addBinding = (binding: { readonly marker: { readonly span: TestDeclarationSpan }; readonly owner?: { readonly declaration: { readonly span: TestDeclarationSpan } } }, fileName: string, side: PinnedScopeSourceSide): void => {
    add(frozenScopeReference(fileName, binding.marker.span, side));
    if (binding.owner) add(frozenScopeReference(fileName, binding.owner.declaration.span, side));
  };

  for (const file of files) {
    for (const target of file.scope.targets) {
      add(frozenScopeReference(file.path, target.declaration.span));
      for (const binding of target.bindings) addBinding(binding, file.path, 'head');
      for (const change of target.associationChanges) addBinding(change.binding, file.path, associationSide(change.kind));
    }
    for (const candidate of file.scope.candidates) {
      // Candidate evidence is identified by the analyzer's frozen source,
      // not by its containing per-file assembly record. A merged scope may
      // contain equal offsets from different paths; keeping this identity
      // makes later candidate resolution source-bound rather than offset-only.
      const candidateSource = candidate.source;
      if (candidate.declaration) add(frozenScopeReference(
        candidateSource.fileName,
        candidate.declaration.span,
        candidateSource.side,
      ));
      if (candidate.diagnostic) add(frozenScopeReference(
        candidateSource.fileName,
        candidate.diagnostic.span,
        candidateSource.side,
      ));
      for (const marker of candidate.markers) add(frozenScopeReference(
        candidateSource.fileName,
        marker.span,
        candidateSource.side,
      ));
      for (const change of candidate.associationChanges) {
        addBinding(change.binding, candidateSource.fileName, associationSide(change.kind));
      }
      if (candidate.affectedGroup) {
        add(frozenScopeReference(
          candidateSource.fileName,
          candidate.affectedGroup.suite.span,
          candidateSource.side,
        ));
        addSourceReference(candidate.affectedGroup.setup);
        candidate.affectedGroup.sharedSources.forEach(addSourceReference);
        candidate.affectedGroup.unchangedDescendantBodies.forEach(addSourceReference);
      }
      if (candidate.affectedDependencies) {
        for (const effect of candidate.affectedDependencies) for (const dependency of [...effect.chain, ...effect.changedSources]) {
          add({ source: dependency.source });
        }
      }
    }
    for (const group of file.scope.affectedGroups) {
      add(frozenScopeReference(file.path, group.suite.span));
      addSourceReference(group.setup);
      group.sharedSources.forEach(addSourceReference);
      group.unchangedDescendantBodies.forEach(addSourceReference);
    }
    file.scope.sharedSources.forEach(addSourceReference);
    for (const note of file.scope.notes) {
      if (note.kind === 'declaration-uncertainty') add(frozenScopeReference(file.path, note.diagnostic.span));
      else {
        add(frozenScopeReference(file.path, note.declaration.span));
        if (note.kind === 'unresolved-reference') add(frozenScopeReference(file.path, note.marker.span));
      }
    }
  }

  const records = await Promise.all([...references.values()].map(async (reference) => {
    const commitSha = reference.source.side === 'base' ? mergeBaseSha : source.headSha;
    const sourceRead = await source.readAtOptional(commitSha, reference.source.fileName);
    // A missing optional base side (for example an added helper) has no
    // invented empty payload. The concrete candidate still retains its source
    // reference and later validation can classify unavailable evidence.
    if (sourceRead.kind === 'absent') return undefined;
    const sourceText = sourceRead.value;
    const region = reference.region ?? { start: 0, end: sourceText.length };
    const content = sourceText.slice(region.start, region.end);
    return Object.freeze({
      id: `source:${reference.source.side}:${reference.source.fileName}:${region.start}:${region.end}`,
      source: Object.freeze({ ...reference.source }),
      region: Object.freeze({ ...region }),
      startLine: sourceText.slice(0, region.start).split('\n').length,
      endLine: sourceText.slice(0, Math.max(region.start, region.end - 1)).split('\n').length,
      content,
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    } satisfies BuildReviewPinnedScopeEvidence);
  }));
  return Object.freeze(records
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id)));
}

/**
 * Assemble test-quality evidence from the same immutable blob reader used by
 * the plan and diff.  The analyzer receives bytes only; neither declaration
 * discovery nor dependency traversal ever imports consumer source.
 */
async function snapshotTypedTestScope(
  source: BuildReviewScopeSource,
  changes: readonly BuildReviewPathChange[],
  mergeBaseSha: string,
  planBody: string,
  storiesBody: string,
  analyzer: (input: BuildReviewTestScopeInput) => BuildReviewTestScope,
): Promise<{
  readonly scope: BuildReviewTestScope;
  readonly scopeEvidence: readonly BuildReviewPinnedScopeEvidence[];
  readonly testQuality: BuildReviewTestQualityScope;
  readonly changedTestTitles: readonly BuildReviewChangedTestTitle[];
}> {
  const renamedFrom = new Map(changes.flatMap((change) => change.kind === 'R' || change.kind === 'C'
    ? [[change.path, change.oldPath] as const]
    : []));
  const changedPaths = new Set(changes.filter((change) => change.kind !== 'D').map((change) => change.path));
  const changeByPath = new Map(changes.filter((change) => change.kind !== 'D').map((change) => [change.path, change]));
  const paths = new Set([
    ...changedPaths,
    ...[...parsePlanTaskPaths(planBody).values()].flatMap((taskPaths) => [...taskPaths]),
  ].filter(isTestPath));
  const initial: ScopedTestFile[] = [];
  for (const path of paths) {
    const basePath = renamedFrom.get(path) ?? path;
    const changed = changeByPath.get(path);
    const [baseRead, headRead] = await Promise.all([
      changed && changed.kind !== 'A'
        ? source.readAtRequired(mergeBaseSha, basePath).then((value) => ({ kind: 'present' as const, value }))
        : source.readAtOptional(mergeBaseSha, basePath),
      changedPaths.has(path)
        ? source.readRequired(path).then((value) => ({ kind: 'present' as const, value }))
        : source.readOptional(path),
    ]);
    // A plan Files hint whose pinned HEAD source is absent is evidence of
    // nothing. Changed paths are required frozen evidence and reject above.
    if (headRead.kind === 'absent') continue;
    const baseText = baseRead.kind === 'present' ? baseRead.value : undefined;
    const headText = headRead.value;
    const input: BuildReviewTestScopeInput = {
      base: { source: { fileName: basePath, bytes: Buffer.from(baseText ?? '', 'utf-8') }, storiesText: storiesBody, planText: planBody },
      head: { source: { fileName: path, bytes: Buffer.from(headText, 'utf-8') }, storiesText: storiesBody, planText: planBody },
    };
    let scope: BuildReviewTestScope;
    try {
      scope = analyzer(input);
    } catch (error) {
      scope = unavailableBuildReviewTestScope(input, error);
    }
    initial.push({ path, basePath, baseText: baseText ?? '', headText, scope });
  }

  const dependencies = await discoverBuildReviewScopeDependencies({
    reader: {
      read: async (side, path) => {
        const result = await source.readAtOptional(side === 'base' ? mergeBaseSha : source.headSha, path);
        return result.kind === 'present' ? result.value : undefined;
      },
    },
    changedTestPaths: initial.filter((file) => file.scope.changedDeclarations.length > 0).map((file) => file.path),
    planText: planBody,
  });
  const files = initial.map((file) => {
    const input: BuildReviewTestScopeInput = {
      base: { source: { fileName: file.basePath, bytes: Buffer.from(file.baseText, 'utf-8') }, storiesText: storiesBody, planText: planBody },
      head: { source: { fileName: file.path, bytes: Buffer.from(file.headText, 'utf-8') }, storiesText: storiesBody, planText: planBody },
      dependencyEffects: dependencies.effects,
    };
    try {
      return { ...file, scope: analyzer(input) };
    } catch (error) {
      return { ...file, scope: unavailableBuildReviewTestScope(input, error) };
    }
  });
  const scope = mergeTestScopes(files.map((file) => file.scope));
  const scopeEvidence = await pinScopeEvidence(files, source, mergeBaseSha);
  const establishedTargetFiles = files.filter((file) => file.scope.targets.length > 0);
  const counterfactualFileSelectors = files
    .filter((file) => file.scope.targets.length > 0 || file.scope.candidates.length > 0)
    .map((file) => file.path)
    .sort();
  const unresolvedMarkers = files.flatMap((file) => file.scope.notes.flatMap((note) => note.kind === 'unresolved-reference'
    ? [Object.freeze({ selector: file.path, reference: markerReferenceForScope(note.marker.reference) })]
    : []));
  // Kept as a compatibility projection until no live consumer remains. Its
  // title regions must be the same established targets that v3 projects,
  // never every changed declaration in a file that happens to contain one.
  // Parser uncertainty remains a marked fallback only when this file has no
  // established direct target at all.
  const changedTestTitles: BuildReviewChangedTestTitle[] = files.flatMap<BuildReviewChangedTestTitle>((file) => {
    const targets = file.scope.targets.filter((target) => target.declaration.kind === 'test');
    if (targets.length > 0) return targets.map((target) => Object.freeze({
      selector: target.source.fileName,
      titleText: target.declaration.titleChain.join(' > '),
      staticExtractionFallback: false,
    }));
    // No established target leaves legacy consumers with their pre-v3
    // changed-declaration behavior; it must not weaken an existing target
    // file by appending its unbound siblings.
    const declarations = file.scope.changedDeclarations.filter((declaration) => declaration.kind === 'test');
    if (declarations.length > 0) return declarations.map((declaration) => Object.freeze({
      selector: file.path,
      titleText: declaration.titleChain.join(' > '),
      staticExtractionFallback: false,
    }));
    return file.scope.notes.some((note) => note.kind === 'declaration-uncertainty')
      ? [Object.freeze({ selector: file.path, titleText: '', staticExtractionFallback: true })]
      : [];
  });
  return Object.freeze({
    scope,
    scopeEvidence,
    testQuality: Object.freeze({
      inScopeTests: Object.freeze(establishedTargetFiles.map((file) => file.path)),
      counterfactualFileSelectors: Object.freeze(counterfactualFileSelectors),
      unresolvedMarkers: Object.freeze(unresolvedMarkers.sort((left, right) =>
        `${left.selector}\u0000${left.reference}`.localeCompare(`${right.selector}\u0000${right.reference}`),
      )),
    }),
    changedTestTitles: Object.freeze(changedTestTitles),
  });
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

  // Freeze the graded tree before any diff or source reads. Every later Git
  // revision expression uses this immutable identity rather than the mutable
  // symbolic HEAD/worktree.
  const headResult = await git(['rev-parse', 'HEAD']);
  const liveHeadSha = headResult.stdout.trim();
  if (headResult.exitCode !== 0 || !liveHeadSha) {
    throw new MergeBaseError(
      `git rev-parse HEAD failed: ${headResult.stderr || 'no HEAD found'}`,
      baseRef,
    );
  }
  const source = new BuildReviewScopeSource(git, liveHeadSha);
  const projectRoot = projectRootForPlan(planPath);
  const planRepoPath = safeRepoRelativePath(relative(projectRoot, planPath).replaceAll('\\', '/'));

  const mergeBase = await git(['merge-base', baseRef, liveHeadSha]);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || !mergeBaseSha) {
    throw new MergeBaseError(
      `git merge-base ${baseRef} HEAD failed: ${mergeBase.stderr || 'no merge base found'}`,
      baseRef,
    );
  }

  const planExclusion = await engineAppendedPlanExclusion(
    source,
    mergeBaseSha,
    projectRoot,
    planRepoPath,
    liveHeadSha,
  );

  const diffArgs = [
    '--',
    '.',
    ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
    ...planExclusion,
  ];
  const diffResult = await git([
    'diff', `${mergeBaseSha}..${liveHeadSha}`,
    ...diffArgs,
  ]);
  if (diffResult.exitCode !== 0) {
    throw new MergeBaseError(
      `git diff ${mergeBaseSha}..${liveHeadSha} failed: ${diffResult.stderr || 'unknown error'}`,
      baseRef,
    );
  }
  const changes = await source.inventory(mergeBaseSha, diffArgs);

  // Source artifacts are review evidence. The plan is required; a selected
  // stories artifact is optional only for legacy/no-artifact plans, never a
  // fallback to the live checkout.
  const planBody = await source.readRequired(planRepoPath);

  /*
   * The snapshot's headSha anchors what the grader actually looks at — the
   * pinned HEAD above — and is what the lap identity derives from. It must
   * NOT come from test-suite evidence provenance.
   */

  const featureRoot = dirname(dirname(dirname(planPath)));
  const planIsInFeatureRoot =
    basename(dirname(planPath)) === 'plans' && basename(dirname(dirname(planPath))) === '.docs';

  const repairContext = planIsInFeatureRoot
    ? await readTestSuiteRemediations(featureRoot)
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
  const storiesPath = activeStoriesPath(planRepoPath, planBody);
  const storiesRead = storiesPath === undefined ? undefined : await source.readOptional(storiesPath);
  const storiesBody = storiesRead?.kind === 'present' ? storiesRead.value : '';
  const typedTestScope = await snapshotTypedTestScope(
    source,
    changes,
    mergeBaseSha,
    planBody,
    storiesBody,
    options.analyzeTestScope ?? analyzeBuildReviewTestScope,
  );
  const snapshotWithoutDigest = {
    baseRef,
    mergeBase: mergeBaseSha,
    headSha: liveHeadSha,
    diff: diffResult.stdout,
    planBody,
    repairContext: Object.freeze([...repairContext]),
    removalContext: Object.freeze({
      deletedFiles: Object.freeze([...removalContext.deletedFiles]),
      removedDeclarations: Object.freeze([...removalContext.removedDeclarations]),
      removedMembers: Object.freeze([...removalContext.removedMembers]),
      removedTestAssertions: Object.freeze((removalContext.removedTestAssertions ?? []).map((assertion) => Object.freeze({
        path: assertion.path,
        line: assertion.line,
      }))),
    }),
    // Legacy title identity remains readable until result-v3 consumers move
    // to the source-bound scope; it is not the v3 target set.
    changedTestTitles: typedTestScope.changedTestTitles,
    testQuality: typedTestScope.testQuality,
    testScope: typedTestScope.scope,
    testScopeAnalysisVersion: 'test-scope-v1',
    testScopeEvidence: typedTestScope.scopeEvidence,
    sourceChanges: changes,
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
    repairContext,
    repairProvenance,
    testSuiteProof: inspection.evidence,
    sourceSnapshot,
  };
}
