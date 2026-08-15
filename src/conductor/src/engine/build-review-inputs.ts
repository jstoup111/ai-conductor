import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { resolveFreshBase, type GitRunner } from './rebase.js';
import {
  readBaseAdvanceHistory,
  readTestSuiteRemediations,
  type TestSuiteRemediationRecord,
} from './test-suite-remediation.js';
import type { AcceptedScopeWidening } from './per-task-commit-floor.js';
import { deriveBuildReviewRemovals, type BuildReviewRemovalContext } from './build-review-removals.js';
import { readOperatorReseals, type OperatorReseal } from './protected-artifact-seal.js';
import { FullSuiteVerifier, type FullSuiteInspectionResult } from './full-suite-verifier.js';
import type { FullSuitePassEvidence } from './full-suite-evidence.js';

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
  };
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
 * Repo-relative prefixes the ENGINE authors, never the build agent: the
 * finish-stamped shipped record and the per-feature pipeline state. They are
 * excluded from the graded diff because grading them against the plan is
 * incoherent — no plan task can ever describe harness machinery output, so
 * their presence reads to the Scope rubric as unplanned work and kicks the
 * build back over a file the builder did not write (observed on
 * `build-review-ci-watch-partial-block-1002`, whose engine-stamped
 * `.docs/shipped/<slug>.md` was cited as an out-of-scope finding).
 *
 * Deliberately narrow: only paths written by engine code paths belong here.
 * Anything an agent can author stays in the graded diff.
 */
export const MACHINERY_AUTHORED_PATHS: readonly string[] = ['.docs/shipped/', '.pipeline/'];

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
  'diff' | 'planBody' | 'repairContext' | 'removalContext'
>): string {
  const { diff, planBody, repairContext, removalContext } = snapshot;
  return `sha256:${createHash('sha256').update(JSON.stringify({
    diff,
    planBody,
    repairContext: semanticRepairContext(repairContext),
    removalContext,
  })).digest('hex')}`;
}

/** Repair-record identity and invalidation timing explain provenance, not remediation meaning. */
function semanticRepairContext(repairs: readonly TestSuiteRemediationRecord[]) {
  return repairs.map(({ gate, reason, diagnostic }) => ({ gate, reason, diagnostic }));
}

function freezeAcceptedWidenings(widenings: readonly AcceptedScopeWidening[]): readonly AcceptedScopeWidening[] {
  return Object.freeze(widenings.map((widening) => Object.freeze({
    path: widening.path,
    rationale: widening.rationale,
    taskId: widening.taskId,
    sha: widening.sha,
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

  const diffResult = await git([
    'diff',
    `${mergeBaseSha}..HEAD`,
    '--',
    '.',
    ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
  ]);
  if (diffResult.exitCode !== 0) {
    throw new MergeBaseError(
      `git diff ${mergeBaseSha}..HEAD failed: ${diffResult.stderr || 'unknown error'}`,
      baseRef,
    );
  }

  const planBody = await readFile(planPath, 'utf-8');

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
    }),
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
    removalContext,
    repairContext,
    acceptedWidenings: [...sourceSnapshot.acceptedWidenings],
    operatorReseals,
    repairProvenance,
    testSuiteProof: inspection.evidence,
    sourceSnapshot,
  };
}
