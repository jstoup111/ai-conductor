// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Every executed step leaves positive evidence —
// including non-verdict steps" (Story 3,
// .docs/stories/audit-trail-write-completeness-for-retro-under-fre.md).
//
// `src/conductor/src/engine/audit-trail.ts` (`AuditTrailWriter`) does not exist
// yet — every test below dynamically imports it so a missing module RREDs only
// that test with "Cannot find module" (the correct pre-implementation RED; a
// top-level static import would instead fail the whole file at collection,
// which writing-system-tests §6 disallows as a RED substitute).
//
// These specs drive the REAL `Conductor` engine (`src/engine/conductor.ts`)
// through a full multi-step run — the "executed ⊆ recorded" invariant is a
// property of a whole run, not any single mapped-event unit test, so it
// belongs at this acceptance layer per §3a (2+ steps/operations in sequence).
// Per-event-type mapping content (gate_pass/gate_fail fields, kickback cause,
// retry attempt/reason) is unit-covered in the writer's own test suite
// (audit-trail.test.ts, plan tasks 1–12) and is NOT re-asserted here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName, ConductState, ConductorEvent } from '../../src/types/index.js';
import { EVENT_SINKS, auditedEventTypes, persistedEventTypes } from '../../src/engine/event-sinks.js';
import { writeState } from '../../src/engine/state.js';

/**
 * Compile-time drift guard (writing-system-tests §3 / plan Task 18(b)):
 * a `Record` keyed by every literal of `ConductorEvent['type']` — TypeScript
 * fails to compile this file if the union in `src/types/events.ts` grows a
 * new member without a classification being added here. The event-sinks
 * registry is the subscription authority; this independent total
 * classification remains useful because the test notices when the writer's
 * observed behavior disagrees with the intended audit disposition.
 *
 * 'friction-mapped'      — ADR 2026-07-07 lists this as a friction event the
 *                           writer allowlists; the fixture below MUST produce
 *                           a record.
 * 'not-audited-by-design' — UI-only, transport-only, or out-of-ADR-scope
 *                           (e.g. tier/config/mode/when skips deliberately
 *                           leave zero audit records per the "skipped ⇒
 *                           absent" invariant); the fixture below MUST NOT
 *                           produce a record.
 */
type AuditedEventType = Exclude<ConductorEvent['type'], 'containment_check_unresolved'>;

const EVENT_TYPE_CLASSIFICATION: Record<
  AuditedEventType,
  'friction-mapped' | 'not-audited-by-design'
> = {
  config_deprecated_key: 'not-audited-by-design',
  contained_live_checkout_drift: 'not-audited-by-design',
  self_host_containment_verdict: 'not-audited-by-design',
  build_review_rubric_started: 'not-audited-by-design',
  build_review_rubric_prompt: 'not-audited-by-design',
  build_review_rubric_result: 'not-audited-by-design',
  build_review_rubric_skipped: 'not-audited-by-design',
  build_review_cache_hit: 'not-audited-by-design',
  build_review_rubric_infrastructure_failure: 'not-audited-by-design',
  build_review_mechanical_allowance_exhausted: 'not-audited-by-design',
  build_review_disposition_accepted: 'not-audited-by-design',
  build_review_reduced_coverage_accepted: 'not-audited-by-design',
  build_review_disposition_refused: 'not-audited-by-design',
  build_review_disposition_version_invalidated: 'friction-mapped',
  build_review_outer_verdict: 'not-audited-by-design',
  build_review_stale_aggregate: 'not-audited-by-design',
  step_started: 'not-audited-by-design',
  deprecated_step: 'not-audited-by-design',
  step_completed: 'friction-mapped', // positive evidence (gate_pass) when no verdict already recorded
  step_failed: 'not-audited-by-design', // superseded by step_retry / gate_verdict on the same step
  provider_attempt: 'not-audited-by-design',
  provider_stream_progress: 'not-audited-by-design',
  scratch_cleanup_reclaimed: 'not-audited-by-design',
  scratch_cleanup_retained: 'not-audited-by-design',
  scratch_cleanup_failed: 'not-audited-by-design',
  // Whole-feature cost telemetry: durable in events.jsonl, but it describes no
  // friction — it is a summation of dispatches already mapped elsewhere.
  feature_usage_total: 'not-audited-by-design',
  provider_fallback: 'not-audited-by-design',
  session_policy: 'not-audited-by-design',
  step_retry: 'friction-mapped',
  retry_decision: 'not-audited-by-design',
  checkpoint_reached: 'not-audited-by-design',
  recovery_needed: 'not-audited-by-design',
  gate_blocked: 'not-audited-by-design',
  tier_skip: 'not-audited-by-design', // skipped steps must have zero records
  config_skip: 'not-audited-by-design', // skipped steps must have zero records
  navigation_back: 'not-audited-by-design',
  rate_limit: 'not-audited-by-design',
  session_reset: 'not-audited-by-design',
  credentials_park: 'not-audited-by-design',
  // Durable event-log telemetry, but deliberately outside the retro friction schema.
  credentials_park_progress: 'not-audited-by-design',
  finish_publication_transition: 'not-audited-by-design',
  finish_publication_blocked: 'not-audited-by-design',
  finish_publication_disposition: 'not-audited-by-design',
  feature_complete: 'not-audited-by-design',
  dashboard_refresh: 'not-audited-by-design',
  protected_artifact_rebaseline: 'not-audited-by-design',
  protected_artifact_rebaseline_refused: 'not-audited-by-design',
  // Operator-initiated reseals and refusals are auditable friction events.
  protected_artifact_reseal: 'friction-mapped',
  protected_artifact_reseal_refused: 'friction-mapped',
  auto_heal: 'not-audited-by-design',
  remediation_sealed_artifact_redirect: 'not-audited-by-design',
  verdict_freshness: 'friction-mapped',
  build_review_base: 'not-audited-by-design',
  build_review_stale_mirage_regrade: 'not-audited-by-design',
  build_review_repair_context: 'not-audited-by-design',
  mode_skip: 'not-audited-by-design', // skipped steps must have zero records
  build_stall: 'not-audited-by-design',
  build_progress: 'not-audited-by-design',
  build_no_progress: 'not-audited-by-design',
  pipeline_closeout: 'not-audited-by-design',
  renderer_error: 'not-audited-by-design',
  when_skip: 'not-audited-by-design', // skipped steps must have zero records
  parallel_started: 'not-audited-by-design',
  parallel_completed: 'not-audited-by-design',
  parallel_failure: 'not-audited-by-design',
  group_member_step: 'not-audited-by-design',
  gate_verdict: 'friction-mapped',
  test_suite_verification: 'not-audited-by-design',
  build_member_evidence_reused: 'not-audited-by-design',
  build_member_evidence_recomputed: 'not-audited-by-design',
  kickback: 'friction-mapped',
  loop_halt: 'friction-mapped',
  halt_marker_write_failed: 'friction-mapped',
  loop_converged: 'not-audited-by-design',
  rebase_noop: 'not-audited-by-design',
  rebase_mergeable_skip: 'not-audited-by-design',
  rebase_changed: 'not-audited-by-design',
  rebase_gate_reverified: 'not-audited-by-design',
  rebase_gate_preserved: 'not-audited-by-design',
  rebase_gate_invalidated: 'not-audited-by-design',
  rebase_conflict_halt: 'not-audited-by-design',
  rebase_citation_residue: 'not-audited-by-design',
  rebase_resolution_attempt: 'not-audited-by-design',
  rebase_resolution_succeeded: 'not-audited-by-design',
  rebase_resolution_failed: 'not-audited-by-design',
  rebase_resolution_exhausted: 'not-audited-by-design',
  auto_park: 'not-audited-by-design',
  operator_park_boundary: 'not-audited-by-design',
  auto_park_contradiction: 'not-audited-by-design',
  zero_work_product: 'not-audited-by-design',
  unattributed_dispatch: 'not-audited-by-design',
  // Retry-loop liveness telemetry: the attempt it describes is already
  // friction-mapped via `step_retry`, so it writes no record of its own.
  unattributed_progress: 'not-audited-by-design',
  halt_cleared: 'friction-mapped',
  operator_rewind: 'friction-mapped',
  ci_failed: 'not-audited-by-design',
  attribution_divergence: 'not-audited-by-design',
  acceptance_red: 'not-audited-by-design',
};

/** One minimally-valid fixture per `ConductorEvent` member, keyed by type. */
const EVENT_FIXTURES: { [K in ConductorEvent['type']]: Extract<ConductorEvent, { type: K }> } = {
  config_deprecated_key: {
    type: 'config_deprecated_key',
    key: 'build_review.rubrics.scope',
    adr: 'adr-2026-08-22-build-review-opt-in-rubric-container',
  },
  contained_live_checkout_drift: {
    type: 'contained_live_checkout_drift',
    evidence: 'live root read-only; worktree writable',
    attribution: 'concurrent-operator',
    summary: '1 added, 0 removed, 0 changed: added operator-edit.txt',
  },
  self_host_containment_verdict: {
    type: 'self_host_containment_verdict',
    contained: true,
    evidence: 'live root read-only; worktree writable',
  },
  containment_check_unresolved: {
    type: 'containment_check_unresolved',
    failure: 'evaluation-failed',
    taskId: '1',
    ts: 1755300000000,
  },
  build_review_rubric_started: { type: 'build_review_rubric_started', rubric: 'scope', lapId: 'lap-1' },
  build_review_rubric_prompt: { type: 'build_review_rubric_prompt', rubric: 'scope', lapId: 'lap-1', promptBytes: 4096 },
  build_review_rubric_result: { type: 'build_review_rubric_result', rubric: 'scope', lapId: 'lap-1', verdict: 'FAIL' },
  build_review_rubric_skipped: { type: 'build_review_rubric_skipped', rubric: 'scope', lapId: 'lap-1', reason: 'disabled' },
  build_review_cache_hit: { type: 'build_review_cache_hit', rubric: 'scope', lapId: 'lap-1' },
  build_review_rubric_infrastructure_failure: { type: 'build_review_rubric_infrastructure_failure', rubric: 'scope', lapId: 'lap-1', reason: 'provider-error' },
  build_review_mechanical_allowance_exhausted: { type: 'build_review_mechanical_allowance_exhausted', lapId: 'lap-1', rubric: 'scope', reason: 'provider-error', consumed: 3, allowance: 3 },
  build_review_disposition_accepted: { type: 'build_review_disposition_accepted', feature: 'feature', lapId: 'lap-1', findingId: 'sha256:x', operator: 'operator' },
  build_review_reduced_coverage_accepted: { type: 'build_review_reduced_coverage_accepted', feature: 'feature', lapId: 'lap-1', rubric: 'scope', reason: 'provider-error', operator: 'operator' },
  build_review_disposition_refused: { type: 'build_review_disposition_refused', feature: 'feature', reason: 'non-tty' },
  build_review_disposition_version_invalidated: { type: 'build_review_disposition_version_invalidated', feature: 'feature', findingId: 'sha256:x', rubric: 'scope', contractVersion: 'v1' },
  build_review_outer_verdict: { type: 'build_review_outer_verdict', lapId: 'lap-1', rawVerdict: 'FAIL', effectiveVerdict: 'PASS' },
  build_review_stale_aggregate: { type: 'build_review_stale_aggregate', storedLapId: 'lap-old', currentLapId: 'lap-new' },
  step_started: { type: 'step_started', step: 'build', index: 0 },
  deprecated_step: {
    type: 'deprecated_step',
    step: 'wiring_check',
    adr: 'adr-2026-08-11-wiring-judged-in-build-review',
  },
  step_completed: { type: 'step_completed', step: 'build', status: 'done' },
  step_failed: { type: 'step_failed', step: 'build', error: 'boom', retryCount: 1 },
  provider_attempt: {
    type: 'provider_attempt',
    step: 'build',
    provider: 'claude',
    outcome: 'success',
    invoked: true,
  },
  provider_stream_progress: {
    type: 'provider_stream_progress',
    step: 'build',
    provider: 'claude',
    childObservability: 'observed',
    activeChildren: 1,
    uncachedInputTokens: 12,
    outputTokens: 3,
    ts: '2026-08-20T12:00:00.000Z',
  },
  scratch_cleanup_reclaimed: {
    type: 'scratch_cleanup_reclaimed',
    repository: 'owner/repository',
    featureSlug: 'provider-scratch',
    runId: 'R',
    attempt: 1,
    path: '/worktree/.daemon/scratch/R/1-codex',
    reason: 'dead-owner',
  },
  scratch_cleanup_retained: {
    type: 'scratch_cleanup_retained',
    repository: 'owner/repository',
    featureSlug: 'provider-scratch',
    runId: 'R',
    attempt: 1,
    path: '/worktree/.daemon/scratch/R/1-codex',
    reason: 'live-owner',
  },
  scratch_cleanup_failed: {
    type: 'scratch_cleanup_failed',
    repository: 'owner/repository',
    featureSlug: 'provider-scratch',
    runId: 'R',
    attempt: 1,
    path: '/worktree/.daemon/scratch/R/1-codex',
    reason: 'removal blocked',
  },
  feature_usage_total: {
    type: 'feature_usage_total',
    dispatches: 1,
    meteredDispatches: 1,
    unmeteredDispatches: 0,
    costUsd: 1.5,
    inputTokens: 100,
    outputTokens: 20,
  },
  provider_fallback: {
    type: 'provider_fallback',
    step: 'build',
    failedProvider: 'claude',
    reason: 'unavailable',
    nextProvider: 'codex',
  },
  session_policy: {
    type: 'session_policy',
    step: 'build',
    provider: 'codex',
    reason: 'session resume unsupported',
  },
  step_retry: { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'tests failed' },
  retry_decision: { type: 'retry_decision', step: 'build', attempt: 2, decision: 'rerun' },
  checkpoint_reached: { type: 'checkpoint_reached', step: 'build' },
  recovery_needed: { type: 'recovery_needed', step: 'build', options: ['retry'] },
  gate_blocked: { type: 'gate_blocked', step: 'build', reason: 'blocked' },
  tier_skip: { type: 'tier_skip', step: 'conflict_check', tier: 'S' },
  config_skip: { type: 'config_skip', step: 'conflict_check' },
  navigation_back: { type: 'navigation_back', from: 'build', to: 'plan' },
  rate_limit: { type: 'rate_limit', waitSeconds: 30 },
  session_reset: { type: 'session_reset', reason: 'restart' },
  credentials_park: { type: 'credentials_park', reason: 'no creds' },
  credentials_park_progress: {
    type: 'credentials_park_progress',
    provider: 'codex',
    source: 'cached-login',
    readiness: 'probe-failed',
    elapsedSeconds: 3,
    degradation: 'probe-failure',
    probeFailureKind: 'timeout',
    nextDisposition: 'trial-required',
  },
  finish_publication_transition: {
    type: 'finish_publication_transition', phase: 'started', transition: 'write_shipped_record',
  },
  finish_publication_blocked: {
    type: 'finish_publication_blocked', condition: 'release_readiness_missing',
  },
  finish_publication_disposition: {
    type: 'finish_publication_disposition', disposition: 'retry_finish',
  },
  feature_complete: { type: 'feature_complete' },
  dashboard_refresh: { type: 'dashboard_refresh' },
  protected_artifact_rebaseline: {
    type: 'protected_artifact_rebaseline',
    trigger: 'defensive-history-rewrite',
    fromCommit: 'abc123',
    toCommit: 'def456',
    paths: ['.docs/plans/feature.md'],
  },
  protected_artifact_rebaseline_refused: {
    type: 'protected_artifact_rebaseline_refused',
    condition: 'feature-authored:head-differs-from-base',
    verdictCondition: 'head-differs-from-base',
    path: '.docs/plans/feature.md',
  },
  protected_artifact_reseal: {
    type: 'protected_artifact_reseal',
    paths: [{
      path: '.docs/plans/feature.md',
      priorFingerprint: 'old-fingerprint',
      newFingerprint: 'new-fingerprint',
    }],
    reason: 'correct an accepted plan',
    fromCommit: 'abc123',
    toCommit: 'def456',
  },
  protected_artifact_reseal_refused: {
    type: 'protected_artifact_reseal_refused',
    reason: 'operator rationale',
    condition: 'unlisted-drift',
    path: '.docs/stories/feature.md',
  },
  auto_heal: { type: 'auto_heal', step: 'build', healed: 1, skipped: 0 },
  remediation_sealed_artifact_redirect: {
    type: 'remediation_sealed_artifact_redirect',
    gapId: 'gap-1',
    artifact: '.docs/stories/another-feature.md',
  },
  verdict_freshness: {
    type: 'verdict_freshness',
    step: 'build_review',
    artifact: '.docs/build-review.md',
    outcome: 'rewritten',
    fresh: true,
    floorSource: 'attempt',
  },
  build_review_base: {
    type: 'build_review_base',
    mergeBase: 'abc123',
    trackingRefSha: 'def456',
    remoteHeadSha: 'def456',
    fresh: true,
  },
  build_review_stale_mirage_regrade: {
    type: 'build_review_stale_mirage_regrade',
    mergeBase: 'abc123',
    regradeCount: 1,
  },
  build_review_repair_context: {
    type: 'build_review_repair_context',
    disposition: 'context_available',
    repairCount: 1,
  },
  mode_skip: { type: 'mode_skip', step: 'bootstrap', mode: 'fresh', reason: 'already bootstrapped' },
  build_stall: {
    type: 'build_stall',
    step: 'build',
    reason: 'no_task_progress',
    resolvedBefore: 0,
    resolvedAfter: 1,
  },
  build_progress: { type: 'build_progress', step: 'build', resolved: 1, total: 3 },
  build_no_progress: { type: 'build_no_progress', step: 'build', quietMinutes: 5, resolved: 1, total: 3 },
  pipeline_closeout: {
    type: 'pipeline_closeout',
    obligation: 'evaluator',
    startedAt: 100,
    endedAt: 140,
    ts: 140,
  },
  renderer_error: { type: 'renderer_error', rendererName: 'console', error: 'oops' },
  when_skip: { type: 'when_skip', step: 'build', expression: '${foo}' },
  parallel_started: { type: 'parallel_started', step: 'build', branches: ['a', 'b'] },
  parallel_completed: { type: 'parallel_completed', step: 'build', branches: ['a', 'b'] },
  parallel_failure: { type: 'parallel_failure', step: 'build', branch: 'a', error: 'boom' },
  group_member_step: { type: 'group_member_step', member: 'a', skill: 'build', phase: 'dispatch' },
  gate_verdict: { type: 'gate_verdict', step: 'build', satisfied: true },
  test_suite_verification: { type: 'test_suite_verification', freshness: { status: 'CURRENT' } },
  build_member_evidence_reused: {
    type: 'build_member_evidence_reused',
    member: 'test_suite',
    decision: 'reuse',
    basis: 'fingerprint-match',
  },
  build_member_evidence_recomputed: {
    type: 'build_member_evidence_recomputed',
    member: 'wiring_check',
    decision: 'recompute',
    basis: 'recorded-head-versus-current-head',
  },
  kickback: { type: 'kickback', from: 'conflict_check', to: 'architecture_review', evidence: 'missing seam', count: 1 },
  loop_halt: { type: 'loop_halt', reason: 'kickback cap exceeded' },
  halt_marker_write_failed: {
    type: 'halt_marker_write_failed',
    path: '/tmp/project/.pipeline/HALT',
    reason: 'disk full',
  },
  loop_converged: { type: 'loop_converged' },
  rebase_noop: { type: 'rebase_noop' },
  rebase_mergeable_skip: { type: 'rebase_mergeable_skip' },
  rebase_changed: {
    type: 'rebase_changed',
    changedPaths: ['a.ts'],
    allChangedPaths: ['a.ts', 'docs/guide.md'],
  },
  rebase_gate_reverified: { type: 'rebase_gate_reverified', step: 'build_review', skippedDispatch: false },
  rebase_gate_preserved: {
    type: 'rebase_gate_preserved',
    gate: 'build_review',
    surface: ['src/a.ts'],
    deltaConsidered: ['src/b.ts'],
  },
  rebase_gate_invalidated: {
    type: 'rebase_gate_invalidated',
    gate: 'build_review',
    matchedPaths: ['src/a.ts'],
  },
  rebase_conflict_halt: { type: 'rebase_conflict_halt', reason: 'conflict', conflicts: ['a.ts'] },
  rebase_citation_residue: {
    type: 'rebase_citation_residue',
    residue: [{ sha: 'abc123', citingTaskIds: ['1'], reason: 'no patch-id match' }],
  },
  rebase_resolution_attempt: { type: 'rebase_resolution_attempt', index: 1, cap: 3 },
  rebase_resolution_succeeded: { type: 'rebase_resolution_succeeded' },
  rebase_resolution_failed: { type: 'rebase_resolution_failed' },
  rebase_resolution_exhausted: { type: 'rebase_resolution_exhausted' },
  auto_park: { type: 'auto_park', slug: 'my-feature', reason: 'no evidence' },
  operator_park_boundary: {
    type: 'operator_park_boundary',
    featureSlug: 'my-feature',
    boundary: { kind: 'pre-first-unit' },
  },
  auto_park_contradiction: {
    type: 'auto_park_contradiction',
    slug: 'my-feature',
    verdict: 'empty/missing plan',
    evidence: { summaryTasksCompleted: 1, evidenceStamps: 1, resolvedTasks: 1 },
  },
  zero_work_product: { type: 'zero_work_product', step: 'build', dispatchCount: 1, headSha: 'abc123' },
  unattributed_dispatch: { type: 'unattributed_dispatch', step: 'build', unattributedCount: 1 },
  unattributed_progress: {
    type: 'unattributed_progress',
    step: 'build',
    attempt: 1,
    resolvedCount: 0,
    headBefore: 'a'.repeat(40),
    headAfter: 'b'.repeat(40),
  },
  halt_cleared: { type: 'halt_cleared', step: 'build', cause: 'operator' },
  operator_rewind: { type: 'operator_rewind', operator: 'operator', target: 'build', demoted: ['build', 'test_suite'] },
  ci_failed: {
    type: 'ci_failed',
    prUrl: 'https://github.com/acme/repo/pull/1',
    slug: 'my-feature',
    checks: ['lint'],
    attempts: 1,
    phase: 'detected',
  },
  attribution_divergence: { type: 'attribution_divergence', feature: 'my-feature', taskId: '1' },
  acceptance_red: {
    type: 'acceptance_red',
    state: 'required',
    step: 'acceptance_specs',
    viaException: false,
  },
};

async function loadWriter(): Promise<Record<string, any>> {
  return import('../../src/engine/audit-trail.js');
}

async function readRecords(root: string): Promise<Array<Record<string, unknown>>> {
  try {
    const content = await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

describe('Acceptance: audit-trail completeness — executed steps leave positive evidence', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'audit-trail-completeness-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a full clean run (tier S) records every executed step and NO skipped step', async () => {
    // Tier S skips conflict_check and architecture_diagram (proven in
    // conductor.test.ts's own tier-S tests) — the invariant is executed ⊆
    // recorded, so those two must be provably absent, not merely unchecked.
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    const stepsRun: StepName[] = [];
    const deprecatedSteps: Array<Extract<ConductorEvent, { type: 'deprecated_step' }>> = [];
    events.on('deprecated_step', (event) => {
      if (event.type === 'deprecated_step') deprecatedSteps.push(event);
    });
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    expect(deprecatedSteps).toEqual([
      {
        type: 'deprecated_step',
        step: 'wiring_check',
        adr: 'adr-2026-08-11-wiring-judged-in-build-review',
      },
    ]);

    expect(stepsRun).not.toContain('conflict_check');
    expect(stepsRun).not.toContain('architecture_diagram');

    const records = await readRecords(dir);
    expect(records.some((record) => record.event === 'deprecated_step')).toBe(false);
    const recordedSteps = new Set(records.map((r) => r.origin));

    // executed ⊆ recorded
    const uniqueExecuted = new Set(stepsRun);
    for (const step of uniqueExecuted) {
      expect(recordedSteps.has(step), `expected a record for executed step "${step}"`).toBe(true);
    }

    // skipped steps must not fabricate evidence
    expect(recordedSteps.has('conflict_check')).toBe(false);
    expect(recordedSteps.has('architecture_diagram')).toBe(false);
  });

  it('a step that fails then succeeds on retry still ends up with positive evidence, not just the retry record', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    let calls = 0;
    let flakyStep: StepName | undefined;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls++;
        if (calls === 1) {
          flakyStep = step;
          return { success: false, output: 'transient error' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 3,
    });

    await conductor.run();

    const records = await readRecords(dir);
    expect(records.some((r) => r.origin === flakyStep && r.event === 'retry')).toBe(true);
    expect(
      records.some((r) => r.origin === flakyStep && r.event === 'gate_pass'),
      'the eventually-successful step must leave positive evidence, not only its retry record',
    ).toBe(true);
  });

  it('drift guard: every audit-owned event type is classified, and the writer honors that classification', async () => {
    // Enumeration-driven (writing-system-tests §3): EVENT_TYPE_CLASSIFICATION
    // above is a `Record` keyed by the audit-writer-owned event union —
    // TypeScript itself refuses to compile this file if a new event type is
    // added without a classification, which is the actual drift guard (a
    // hand-written fixture list can silently go stale; a missing `Record`
    // key cannot). This test then checks the writer's runtime behavior
    // agrees with each classification, one event type at a time, so a
    // failure names the exact offending type instead of an aggregate count.
    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    for (const [type, classification] of Object.entries(EVENT_TYPE_CLASSIFICATION) as Array<
      [AuditedEventType, 'friction-mapped' | 'not-audited-by-design']
    >) {
      const before = (await readRecords(dir)).length;
      await events.emit(EVENT_FIXTURES[type]);
      const after = (await readRecords(dir)).length;

      if (classification === 'friction-mapped') {
        expect(
          after,
          `expected event type "${type}" (classified friction-mapped) to append a record — the writer's allowlist no longer matches this test's classification`,
        ).toBeGreaterThan(before);
      } else {
        expect(
          after,
          `expected event type "${type}" (classified not-audited-by-design) to append NO record, but one was written — either update the writer's allowlist or this classification`,
        ).toBe(before);
      }
    }

    // These variants are intentionally off the audit trail: their runtime sink
    // declarations must agree with the writer observation above.  The engine
    // rubric events stay durable; externally-owned disposition events do not
    // re-enter events.jsonl when the closeout tail re-emits them.
    const buildReviewSinkExpectations = {
      build_review_rubric_started: { render: false, persist: true, audit: false },
      build_review_rubric_result: { render: false, persist: true, audit: false },
      build_review_rubric_skipped: { render: false, persist: true, audit: false },
      build_review_cache_hit: { render: false, persist: true, audit: false },
      build_review_rubric_infrastructure_failure: { render: false, persist: true, audit: false },
      build_review_mechanical_allowance_exhausted: { render: false, persist: true, audit: false },
      build_review_disposition_accepted: { render: false, persist: false, audit: false },
      build_review_reduced_coverage_accepted: { render: false, persist: false, audit: false },
      build_review_disposition_refused: { render: false, persist: false, audit: false },
      build_review_disposition_version_invalidated: { render: false, persist: true, audit: true },
      build_review_outer_verdict: { render: false, persist: true, audit: false },
    } satisfies Partial<Record<ConductorEvent['type'], { render: boolean; persist: boolean; audit: boolean }>>;
    expect(Object.fromEntries(Object.keys(buildReviewSinkExpectations).map((type) => [
      type,
      EVENT_SINKS[type as ConductorEvent['type']],
    ]))).toEqual(buildReviewSinkExpectations);
    expect(persistedEventTypes()).toEqual(expect.arrayContaining([
      'build_review_rubric_started',
      'build_review_rubric_result',
      'build_review_rubric_skipped',
      'build_review_cache_hit',
      'build_review_rubric_infrastructure_failure',
      'build_review_mechanical_allowance_exhausted',
      'build_review_outer_verdict',
    ]));
    expect(persistedEventTypes()).not.toEqual(expect.arrayContaining([
      'build_review_disposition_accepted',
      'build_review_reduced_coverage_accepted',
      'build_review_disposition_refused',
    ]));
    expect(auditedEventTypes()).not.toEqual(expect.arrayContaining(Object.keys(buildReviewSinkExpectations)));
  });

  it('a UI-only event with no writer mapping produces no record and no error (allowlist, not a catch-all)', async () => {
    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    await events.emit({ type: 'step_started', step: 'build', index: 0 });
    await events.emit({ type: 'dashboard_refresh' });

    const records = await readRecords(dir);
    expect(records).toHaveLength(0);
  });

  it('a persisted but unaudited containment check produces no audit record', async () => {
    const { EVENT_SINKS } = await import('../../src/engine/event-sinks.js');
    expect(EVENT_SINKS.containment_check_unresolved).toMatchObject({
      persist: true,
      audit: false,
    });

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    new AuditTrailWriter(dir).subscribe(events);

    await events.emit({
      type: 'containment_check_unresolved',
      failure: 'evaluation-failed',
      taskId: '3',
      ts: 1_000,
    });

    expect(await readRecords(dir)).toHaveLength(0);
  });
});
