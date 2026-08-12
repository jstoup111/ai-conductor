import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { resolveFreshBase, type GitRunner } from './rebase.js';
import {
  readTestSuiteRemediations,
  type TestSuiteRemediationRecord,
} from './test-suite-remediation.js';
import type { AcceptedScopeWidening } from './per-task-commit-floor.js';

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
  /** Configured production entry points for the static wiring rubric. */
  entryPoints?: string[];
  /** Engine-recorded aggregate failures exposed after base advances. The
   * grader judges whether diff hunks implement them; they are not exemptions. */
  repairContext?: TestSuiteRemediationRecord[];
  /** Commit-local scope widenings accepted by the containment evaluator. */
  acceptedWidenings?: AcceptedScopeWidening[];
  /** Wiring-check feedback from prior kickbacks in this feature's event ledger.
   * These instructions retain the event's evidence and retry count verbatim so
   * the grader can judge whether the current diff closes the reported gap. */
  gateInstructions?: BuildReviewGateInstruction[];
}

/** A wiring_check → build kickback preserved for build-review context. */
export interface BuildReviewGateInstruction {
  from: 'wiring_check';
  to: 'build';
  evidence: string;
  count: number;
}

function isBuildReviewGateInstruction(value: unknown): value is BuildReviewGateInstruction {
  if (typeof value !== 'object' || value === null) return false;

  const event = value as Record<string, unknown>;
  return event.type === 'kickback'
    && event.from === 'wiring_check'
    && event.to === 'build'
    && typeof event.evidence === 'string'
    && typeof event.count === 'number';
}

/** Read wiring-check kickbacks from the feature's canonical event spine. */
async function readBuildReviewGateInstructions(featureRoot: string): Promise<BuildReviewGateInstruction[]> {
  let ledger: string;
  try {
    ledger = await readFile(join(featureRoot, '.pipeline', 'events.jsonl'), 'utf-8');
  } catch {
    return [];
  }
  const instructions: BuildReviewGateInstruction[] = [];

  for (const line of ledger.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (isBuildReviewGateInstruction(event)) {
      instructions.push({
        from: event.from,
        to: event.to,
        evidence: event.evidence,
        count: event.count,
      });
    }
  }

  return instructions;
}

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
): Promise<BuildReviewInputs> {
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

  return {
    diff: diffResult.stdout,
    planBody,
    mergeBase: mergeBaseSha,
    baseRef,
    baseKind: resolution.kind,
    trackingRefSha: resolution.trackingRefSha,
    remoteHeadSha: resolution.remoteHeadSha,
    fresh: resolution.fresh,
    repairContext:
      planIsInFeatureRoot
        ? await readTestSuiteRemediations(featureRoot)
        : [],
    gateInstructions: planIsInFeatureRoot
      ? await readBuildReviewGateInstructions(featureRoot)
      : [],
  };
}
