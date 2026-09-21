// ── Re-dispatch code-validity decision (gate-code-validity-on-redispatch,
// .docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md)
// ──
//
// Generalizes ADR-2026-07-20's post-rebase delta-aware gate preservation
// (`GATE_SURFACE` + `partitionDelta` in `gate-invalidation.ts`) to the
// re-dispatch/resume path: a judged gate verdict stamped with the HEAD SHA
// it was formed against (`codeStamp`, Task 1) should be preserved across
// re-dispatch if the code hasn't actually changed in that gate's surface
// since. `artifacts.ts` calls `gateVerdictStillValid` when deciding whether a
// stamped gate verdict remains current; `conductor.ts` imports
// `verdictProducedByRun` for its run-identity checks.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StepName } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { validRebaseOperationRecord, type GateVerdict, type ReplayEvidence } from './gate-verdicts.js';
import {
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  MANUAL_TEST_CODE_STAMP,
  MANUAL_TEST_FAIL_EVIDENCE,
  PRD_AUDIT_CODE_STAMP,
} from './artifacts.js';
import { COVERAGE_BINDING_CODE_STAMP } from './coverage-binding-envelope.js';
import type { GitRunner } from './rebase.js';
import { originDefaultBranch, changedPathsBetween, resolveReviewInputs } from './rebase.js';
import { featureTestPaths, GATE_SURFACE, partitionDelta, projectGateSurfaces } from './gate-invalidation.js';
import { resolveGateCodeValidityConfig } from './config.js';
import { resolveThroughMap } from './rebase-translate.js';

/** Minimal context the decision helper needs: an injected git runner rooted
 * at the project's working directory. Mirrors the `GitRunner` convention
 * used throughout `rebase.ts`/`gate-invalidation.ts` so tests can drive a
 * real scratch repo without a new git call-site pattern. */
export interface GateCodeValidityContext {
  projectRoot: string;
  git: GitRunner;
}

export type GateVerdictValidity = 'preserve' | 'rerun';

/** A replay preservation is deliberately a bounded exception to the older
 * path-only comparison. Keep its validation beside the normal re-dispatch
 * decision so every reader gets the same fail-closed authority. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sameReplay(left: ReplayEvidence, right: ReplayEvidence): boolean {
  return left.preRebaseHead === right.preRebaseHead &&
    left.mergeBase === right.mergeBase &&
    left.target === right.target &&
    left.completedHead === right.completedHead &&
    left.expectedTree === right.expectedTree && left.kind === right.kind;
}

function relevantInputPath(identity: unknown): string | null {
  if (!nonEmptyString(identity)) return null;
  const separator = identity.lastIndexOf('@');
  const path = separator > 0 ? identity.slice(0, separator) : '';
  return path && !path.startsWith('/') && !path.split('/').includes('..') ? path : null;
}

function parsedGateVerdict(value: unknown): GateVerdict | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof (value as { satisfied?: unknown }).satisfied === 'boolean'
    ? value as GateVerdict
    : null;
}

async function persistedVerdict(projectRoot: string, gate: StepName): Promise<GateVerdict | null> {
  try {
    return parsedGateVerdict(JSON.parse(await readFile(join(projectRoot, '.pipeline', 'gates', `${gate}.json`), 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * A rebase transition spans the gate records and conduct-state, so an
 * interrupted descriptor must be a publication fence even for consumers that
 * do not happen to read a preserved review.  This deliberately checks only
 * the durable rebase operation and its outstanding effects; individual
 * preserved-review provenance remains the responsibility of
 * `replayBoundAuthorityStillValid` above.
 */
export async function rebaseOperationPublicationBlocker(projectRoot: string): Promise<string | null> {
  const rebase = await persistedVerdict(projectRoot, 'rebase');
  const operation = rebase?.rebaseOperation;
  if (!operation) return null;
  if (operation.status !== 'applied') {
    return 'rebase transition is still applying; reconcile the persisted rebase operation before publication';
  }
  if (!validRebaseOperationRecord(operation)) {
    return 'rebase transition record is malformed or inconsistent; reconcile it before publication';
  }
  const { transition } = operation;
  // This fence owns only preservation records: they are the cross-file
  // authority that otherwise lets an old PASS survive the replay. Invalidated
  // and reverified entries are lifecycle effects (not every step has a gate
  // verdict file — notably `build` and disabled `coverage_binding`), and their
  // normal completion predicates remain the authority at finish.
  const named = transition.preserved;
  for (const gate of named) {
    const verdict = await persistedVerdict(projectRoot, gate);
    if (!verdict?.satisfied) {
      return `rebase transition still has an outstanding ${gate} repair or re-verification`;
    }
    if (transition.preserved.includes(gate) &&
      (verdict.preservation?.gate !== gate || verdict.preservation.operationId !== operation.id)) {
      return `rebase transition preserved ${gate} without its replay-bound authority`;
    }
  }
  return null;
}

/**
 * Replay authority explains one prior judge result; it cannot outrank an
 * outstanding repair elsewhere in the verification tail.  In particular a
 * failed or kicked-back aggregate suite is newer authority for every review
 * that follows it.  Read the durable gate record rather than conduct-state:
 * a restart may see the verdict before the state sweep has selected it.
 */
async function hasOutstandingVerificationRepair(projectRoot: string): Promise<boolean> {
  const suite = await persistedVerdict(projectRoot, 'test_suite');
  return suite?.satisfied === false || suite?.kickback !== undefined;
}

const PRESERVED_GATE_ARTIFACTS: Partial<Record<StepName, string>> = {
  coverage_binding: '.pipeline/coverage-binding.json',
  build_review: '.pipeline/build-review.json',
  test_suite: '.pipeline/test-suite-evidence.json',
  manual_test: '.pipeline/manual-test-results.md',
  prd_audit: '.pipeline/prd-audit.md',
  architecture_review_as_built: '.pipeline/architecture-review-as-built.md',
};

/** Re-read the same artifact and engine-owned stamp that the rebase writer
 * bound into a preservation record. A record is not authority by itself. */
/** Read the immutable identity owned by a gate's durable artifact. Shared by
 * the rebase writer and readers; conduct-session-id is intentionally not
 * replay authority because every step replaces that compatibility scalar. */
export async function currentPreservedJudgeIdentity(
  projectRoot: string,
  gate: StepName,
): Promise<{ artifactDigest: string; attemptId: string; runId: string; codeStamp: string } | null> {
  const artifactPath = PRESERVED_GATE_ARTIFACTS[gate];
  if (!artifactPath) return null;
  try {
    const artifact = await readFile(join(projectRoot, artifactPath), 'utf-8');
    let codeStamp: unknown;
    let runId: unknown;
    if (gate === 'manual_test') {
      const [stamp, identity] = await Promise.all([
        readFile(join(projectRoot, MANUAL_TEST_FAIL_EVIDENCE), 'utf-8'),
        readFile(join(projectRoot, MANUAL_TEST_CODE_STAMP), 'utf-8'),
      ]);
      codeStamp = (JSON.parse(stamp) as { codeStamp?: unknown }).codeStamp;
      runId = (JSON.parse(identity) as { runId?: unknown }).runId;
    } else if (gate === 'prd_audit' || gate === 'architecture_review_as_built') {
      const sidecar = await readFile(join(projectRoot,
        gate === 'prd_audit' ? PRD_AUDIT_CODE_STAMP : ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
      ), 'utf-8');
      const parsed = JSON.parse(sidecar) as { codeStamp?: unknown; runId?: unknown };
      codeStamp = parsed.codeStamp;
      runId = parsed.runId;
    } else if (gate === 'build_review' || gate === 'test_suite') {
      const parsed = JSON.parse(artifact) as { codeStamp?: unknown; provenanceHeadSha?: unknown; lapId?: unknown };
      codeStamp = gate === 'build_review' ? parsed.codeStamp : parsed.provenanceHeadSha;
      // Build-review's lap and the suite proof's provenance head are durable,
      // source-bound judge identities. Do not substitute the mutable session.
      runId = gate === 'build_review' ? parsed.lapId : parsed.provenanceHeadSha;
    } else if (gate === 'coverage_binding') {
      // The envelope's closed schema carries the run; the runner's sidecar
      // carries the judged HEAD. A stamp from another run is not this
      // envelope's identity.
      const envelope = JSON.parse(artifact) as { runId?: unknown };
      const stamp = JSON.parse(await readFile(join(projectRoot, COVERAGE_BINDING_CODE_STAMP), 'utf-8')) as { codeStamp?: unknown; runId?: unknown };
      if (stamp.runId !== envelope.runId) return null;
      codeStamp = stamp.codeStamp;
      runId = envelope.runId;
    }
    if (!nonEmptyString(codeStamp) || !nonEmptyString(runId)) return null;
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return null;
    return {
      artifactDigest: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
      attemptId: normalizedRunId,
      runId: normalizedRunId,
      codeStamp,
    };
  } catch {
    return null;
  }
}

async function replayBoundAuthorityStillValid(
  ctx: GateCodeValidityContext,
  gate: string,
  codeStamp: string,
): Promise<boolean> {
  try {
    const preserved = await persistedVerdict(ctx.projectRoot, gate as StepName);
    if (!preserved?.satisfied || preserved.kickback || !preserved.preservation) return false;
    if (await hasOutstandingVerificationRepair(ctx.projectRoot)) return false;

    const authority = preserved.preservation;
    if (authority.gate !== gate || authority.original.codeStamp !== codeStamp ||
      !nonEmptyString(authority.original.artifactDigest) ||
      !nonEmptyString(authority.original.attemptId) ||
      !nonEmptyString(authority.original.runId) ||
      !nonEmptyString(authority.operationId) ||
      !Array.isArray(authority.relevantInputIdentities) ||
      authority.relevantInputIdentities.length === 0) return false;

    const currentIdentity = await currentPreservedJudgeIdentity(ctx.projectRoot, gate as StepName);
    if (!currentIdentity ||
      authority.original.artifactDigest !== currentIdentity.artifactDigest ||
      authority.original.attemptId !== currentIdentity.attemptId ||
      authority.original.runId !== currentIdentity.runId ||
      authority.original.codeStamp !== currentIdentity.codeStamp) {
      return false;
    }

    const replay = authority.replay;
    if (!nonEmptyString(replay.preRebaseHead) || !nonEmptyString(replay.mergeBase) ||
      !nonEmptyString(replay.target) || !nonEmptyString(replay.completedHead) ||
      !nonEmptyString(replay.expectedTree) || replay.kind === 'unproved') return false;

    const rebase = await persistedVerdict(ctx.projectRoot, 'rebase');
    const operation = rebase?.rebaseOperation;
    if (!operation || operation.status !== 'applied' || operation.id !== authority.operationId ||
      !operation.transition.preserved.includes(gate as StepName) || !sameReplay(operation.replay, replay)) return false;

    for (const object of [replay.preRebaseHead, replay.mergeBase, replay.target, replay.completedHead]) {
      if ((await ctx.git(['cat-file', '-e', `${object}^{commit}`])).exitCode !== 0) return false;
    }
    if ((await ctx.git(['cat-file', '-e', `${replay.expectedTree}^{tree}`])).exitCode !== 0) return false;
    const actualTree = await ctx.git(['rev-parse', `${replay.completedHead}^{tree}`]);
    if (actualTree.exitCode !== 0 || actualTree.stdout.trim() !== replay.expectedTree) return false;
    if ((await ctx.git(['merge-base', '--is-ancestor', replay.completedHead, 'HEAD'])).exitCode !== 0) return false;

    const inputs = authority.relevantInputIdentities.map(relevantInputPath);
    if (inputs.some((path) => path === null)) return false;
    // Binding the capture-time list alone cannot notice a newly introduced
    // governing decision. Re-resolve the declared authority before the
    // replay fast-path, using the same resolver as the writer.
    const declaredInputs = await resolveReviewInputs(ctx.projectRoot, [], true);
    const storedDecisions = inputs.filter((path): path is string => path!.startsWith('.docs/decisions/'));
    const currentDecisions = declaredInputs.filter((path) => path.startsWith('.docs/decisions/'));
    if (storedDecisions.length !== currentDecisions.length || currentDecisions.some((path) => !storedDecisions.includes(path))) return false;
    const changed = await ctx.git(['diff', '--name-only', replay.completedHead, 'HEAD']);
    if (changed.exitCode !== 0) return false;
    const changedPaths = new Set(changed.stdout.split('\n').map((path) => path.trim()).filter(Boolean));
    return !inputs.some((path) => changedPaths.has(path!));
  } catch {
    return false;
  }
}

/**
 * A satisfied gate record is not automatically a judged PASS: skip records
 * and kickback-shaped records deliberately share the durable verdict format.
 * Rebase preservation may use only a real, currently satisfied judgement.
 */
export function isApplicableOriginalPass(
  verdict: { satisfied: boolean; reason?: string; kickback?: unknown } | null | undefined,
): boolean {
  return verdict?.satisfied === true &&
    verdict.kickback === undefined &&
    !verdict.reason?.startsWith('skipped: ');
}

/** The identity comparison result for a SHIP-tail verdict sidecar. */
export type VerdictRunIdentity =
  | { state: 'match'; runId: string }
  | {
      state: 'stale-run-identity';
      expectedRunId: string;
      foundRunId: string;
    }
  | { state: 'unstamped' };

function verdictRunIdentitySidecar(gate: StepName): string | undefined {
  switch (gate) {
    case 'prd_audit':
      return PRD_AUDIT_CODE_STAMP;
    case 'architecture_review_as_built':
      return ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP;
    case 'manual_test':
      return MANUAL_TEST_CODE_STAMP;
    default:
      return undefined;
  }
}

/**
 * Answers whether a SHIP-tail gate's verdict was produced by `expectedRunId`.
 *
 * A valid engine stamp is authoritative: a matching stamp is current and a
 * different stamp is a typed stale identity. Missing, malformed, or legacy
 * sidecars deliberately remain `unstamped`, so callers retain their existing
 * mtime fallback unchanged.
 */
export async function verdictProducedByRun(
  dir: string,
  gate: StepName,
  expectedRunId: string | undefined,
  config?: Pick<HarnessConfig, 'gate_code_validity'>,
): Promise<VerdictRunIdentity> {
  if (!resolveGateCodeValidityConfig(config).enabled) return { state: 'unstamped' };
  if (!expectedRunId) return { state: 'unstamped' };

  const sidecar = verdictRunIdentitySidecar(gate);
  if (!sidecar) return { state: 'unstamped' };

  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, sidecar), 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: 'unstamped' };
    }
    const runId = (parsed as { runId?: unknown }).runId;
    if (typeof runId !== 'string' || runId.length === 0) return { state: 'unstamped' };
    return runId === expectedRunId
      ? { state: 'match', runId }
      : { state: 'stale-run-identity', expectedRunId, foundRunId: runId };
  } catch {
    return { state: 'unstamped' };
  }
}

/**
 * Derive the feature's own claimed runtime surface `F` for `partitionDelta`:
 * the paths introduced/touched by the current branch relative to its
 * merge-base with the LOCAL copy of origin's default branch (no fetch — this
 * runs on the re-dispatch hot path, unlike `resolveBase`, which fetches).
 * Fails open to an empty surface (`[]`) on any discovery/compute failure —
 * that only widens `foreignSrc` at the expense of `featureSrc`, which is
 * conservative for `feature-runtime` gates (more likely to re-run, never
 * silently preserved on a real feature-surface change since `any-codetest`/
 * `all-runtime` gates don't consult `F` at all).
 */
async function deriveFeatureSurface(ctx: GateCodeValidityContext): Promise<string[]> {
  try {
    const branch = await originDefaultBranch(ctx.git);
    if (!branch) return [];
    const baseRef = `origin/${branch}`;
    const mergeBase = await ctx.git(['merge-base', baseRef, 'HEAD']);
    if (mergeBase.exitCode !== 0) return [];
    const base = mergeBase.stdout.trim();
    if (!base) return [];
    return await changedPathsBetween(ctx.git, base, 'HEAD');
  } catch {
    return [];
  }
}

/**
 * Decide whether a judged gate's verdict — stamped with `codeStamp`, the
 * HEAD SHA it was formed against — can be trusted (`preserve`) without a
 * re-run, or must be re-judged (`rerun`), given the CURRENT HEAD.
 *
 * Decision order (each step short-circuits to `rerun`; there is exactly one
 * `preserve` exit, the final surface check — invariant C5):
 *   1. No `codeStamp` (absent/null) → `rerun` (legacy/opt-out verdicts keep
 *      governing by mtime, unaffected by this helper).
 *   2. `codeStamp` unreachable in current history (orphaned by amend/rebase/
 *      reset, or not a real object at all) → `rerun` (#766 orphan guard —
 *      never wedge on a baseline that no longer exists).
 *   3. `git diff --name-only codeStamp..HEAD` uncomputable → `rerun`.
 *   4. Partition the delta by the gate's `GATE_SURFACE` kind: surface MISS →
 *      `preserve`; surface HIT → `rerun`.
 *
 * An unknown `gate` (not in `GATE_SURFACE`) fails closed to `rerun`.
 */
/**
 * Resolve a stamped baseline through `.pipeline/rebase-rewrites.json` (written
 * by the engine's own rebase step, see `rebase-translate.ts`). Returns the
 * rewritten sha when the map knows the stamp, otherwise null. Missing or
 * unreadable map → null (fail closed: nothing explains the orphan).
 */
async function translateThroughRebaseRewrites(
  projectRoot: string,
  codeStamp: string,
): Promise<string | null> {
  try {
    const raw = await readFile(join(projectRoot, '.pipeline', 'rebase-rewrites.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map = parsed as Record<string, unknown>;
    const hit = map[codeStamp];
    if (typeof hit !== 'string' || hit.length === 0 || hit === codeStamp) return null;
    return resolveThroughMap(codeStamp, map as Record<string, string>);
  } catch {
    return null;
  }
}

export async function gateVerdictStillValid(
  ctx: GateCodeValidityContext,
  gate: string,
  codeStamp: string | null | undefined,
  head = 'HEAD',
): Promise<GateVerdictValidity> {
  if (!codeStamp) return 'rerun';

  const surface = GATE_SURFACE[gate];
  if (!surface) return 'rerun';

  // A valid replay record proves that the original review's feature
  // contribution was reproduced byte-for-byte. It precedes the old path
  // comparison, which cannot distinguish an upstream edit in the same file
  // from a changed replay contribution.
  if (await replayBoundAuthorityStillValid(ctx, gate, codeStamp)) return 'preserve';

  const ancestry = await ctx.git(['merge-base', '--is-ancestor', codeStamp, head]);
  let diffRange = `${codeStamp}..${head}`;
  if (ancestry.exitCode !== 0) {
    // The stamped baseline is not in the current history. That is the #766
    // fail-closed case (an amend/reset orphaned it) UNLESS the engine's own
    // `rebase` step rewrote it: `.pipeline/rebase-rewrites.json` records every
    // old→new sha the play-forward produced. A stamp that translates to a
    // reachable rewritten commit is the same reviewed content replayed onto a
    // new base, so the verdict is judged on the tree delta between the
    // stamped tree and HEAD (which surfaces the base's own changes as foreign
    // paths for the partition below). Anything the map cannot explain stays
    // fail-closed.
    const translated = await translateThroughRebaseRewrites(ctx.projectRoot, codeStamp);
    if (translated === null) return 'rerun';
    const translatedAncestry = await ctx.git(['merge-base', '--is-ancestor', translated, head]);
    if (translatedAncestry.exitCode !== 0) return 'rerun';
    diffRange = `${codeStamp} ${head}`;
  }

  const diffResult = await ctx.git(['diff', '--name-only', ...diffRange.split(' ')]);
  if (diffResult.exitCode !== 0) return 'rerun';

  const delta = diffResult.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const F =
    surface === 'feature-runtime' ||
    surface === 'feature-codetest' ||
    surface === 'feature-runtime-or-prd-inputs' ||
    surface === 'feature-runtime-or-coverage-inputs' ||
    surface === 'all-runtime'
      ? await deriveFeatureSurface(ctx)
      : [];

  const { test, featureSrc, foreignSrc } = partitionDelta(delta, F);

  let isSurfaceMiss: boolean;
  switch (surface) {
    case 'feature-runtime':
      isSurfaceMiss = featureSrc.length === 0;
      break;
    case 'feature-codetest':
      // Fail closed on an underivable surface. `deriveFeatureSurface` fails
      // open to `[]`, which would make every path "foreign" and preserve a
      // verdict across a real feature-surface change (e.g. a kickback fix
      // commit). With no F to compare against, fall back to 'any-codetest'
      // semantics: any code/test delta re-runs.
      isSurfaceMiss =
        F.length === 0
          ? test.length === 0 && featureSrc.length === 0 && foreignSrc.length === 0
          : featureSrc.length === 0 && featureTestPaths(delta, F).length === 0;
      break;
    case 'feature-runtime-or-prd-inputs':
    case 'feature-runtime-or-coverage-inputs':
      isSurfaceMiss = projectGateSurfaces(delta, F, await resolveReviewInputs(ctx.projectRoot, delta))[surface].matchedPaths.length === 0;
      break;
    case 'all-runtime':
      isSurfaceMiss = featureSrc.length === 0 && foreignSrc.length === 0;
      break;
    case 'any-codetest':
      isSurfaceMiss = test.length === 0 && featureSrc.length === 0 && foreignSrc.length === 0;
      break;
    default:
      return 'rerun';
  }

  return isSurfaceMiss ? 'preserve' : 'rerun';
}
