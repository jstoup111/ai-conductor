// ── Re-dispatch code-validity decision (gate-code-validity-on-redispatch,
// .docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md)
// ──
//
// Generalizes ADR-2026-07-20's post-rebase delta-aware gate preservation
// (`GATE_SURFACE` + `partitionDelta` in `gate-invalidation.ts`) to the
// re-dispatch/resume path: a judged gate verdict stamped with the HEAD SHA
// it was formed against (`codeStamp`, Task 1) should be preserved across
// re-dispatch if the code hasn't actually changed in that gate's surface
// since. Nothing calls `gateVerdictStillValid` yet — later tasks (5, 6, 7)
// wire it into the completion predicates.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StepName } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import type { GateVerdict, ReplayEvidence } from './gate-verdicts.js';
import {
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  MANUAL_TEST_CODE_STAMP,
  PRD_AUDIT_CODE_STAMP,
} from './artifacts.js';
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
    left.expectedTree === right.expectedTree;
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
  const { transition, replay } = operation;
  if (!nonEmptyString(operation.id) || !transition || !replay ||
    !Array.isArray(transition.preserved) || !Array.isArray(transition.invalidated) ||
    !Array.isArray(transition.reverified) ||
    ![replay.preRebaseHead, replay.mergeBase, replay.target, replay.completedHead, replay.expectedTree]
      .every(nonEmptyString)) {
    return 'rebase transition record is malformed or inconsistent; reconcile it before publication';
  }
  const named = [...transition.preserved, ...transition.invalidated, ...transition.reverified];
  if (new Set(named).size !== named.length) {
    return 'rebase transition record has overlapping gate effects; reconcile it before publication';
  }
  for (const gate of named) {
    const verdict = await persistedVerdict(projectRoot, gate);
    if (!verdict?.satisfied) {
      return `rebase transition still has an outstanding ${gate} repair or re-verification`;
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
      !Array.isArray(authority.relevantInputIdentities)) return false;

    const replay = authority.replay;
    if (!nonEmptyString(replay.preRebaseHead) || !nonEmptyString(replay.mergeBase) ||
      !nonEmptyString(replay.target) || !nonEmptyString(replay.completedHead) ||
      !nonEmptyString(replay.expectedTree)) return false;

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
): Promise<GateVerdictValidity> {
  if (!codeStamp) return 'rerun';

  const surface = GATE_SURFACE[gate];
  if (!surface) return 'rerun';

  // A valid replay record proves that the original review's feature
  // contribution was reproduced byte-for-byte. It precedes the old path
  // comparison, which cannot distinguish an upstream edit in the same file
  // from a changed replay contribution.
  if (await replayBoundAuthorityStillValid(ctx, gate, codeStamp)) return 'preserve';

  const ancestry = await ctx.git(['merge-base', '--is-ancestor', codeStamp, 'HEAD']);
  let diffRange = `${codeStamp}..HEAD`;
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
    const translatedAncestry = await ctx.git(['merge-base', '--is-ancestor', translated, 'HEAD']);
    if (translatedAncestry.exitCode !== 0) return 'rerun';
    diffRange = `${codeStamp} HEAD`;
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
