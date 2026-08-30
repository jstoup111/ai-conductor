// Covers: task:1, task:3, task:6, task:17
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditTrailWriter } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import {
  EVENT_SINKS,
  auditedEventTypes,
  otelEventTypes,
  persistedEventTypes,
  renderedEventTypes,
  type SinkDeclaration,
} from '../../src/engine/event-sinks.js';
import type { SchedulingUnitRef } from '../../src/engine/conductor.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PRE_REFACTOR_PERSISTED_EVENT_TYPES = [
  'step_started',
  'step_completed',
  'step_failed',
  'step_refused',
  'step_status_write_refused',
  'provider_attempt',
  'scratch_cleanup_reclaimed',
  'scratch_cleanup_retained',
  'scratch_cleanup_failed',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'step_retry',
  'checkpoint_reached',
  'recovery_needed',
  'gate_blocked',
  'tier_skip',
  'config_skip',
  'navigation_back',
  'rate_limit',
  'session_reset',
  'credentials_park',
  'credentials_park_progress',
  'feature_complete',
  'dashboard_refresh',
  'auto_heal',
  'mode_skip',
  'build_progress',
  'unattributed_progress',
  'build_no_progress',
  'build_stall',
  'renderer_error',
  'pipeline_tail_diagnostic',
  'when_skip',
  'parallel_started',
  'parallel_completed',
  'parallel_failure',
  'attribution_divergence',
  'acceptance_red',
] satisfies Array<ConductorEvent['type']>;

const BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES = [
  'build_member_evidence_reused',
  'build_member_evidence_recomputed',
] satisfies Array<ConductorEvent['type']>;

const REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES = [
  'remediation_sealed_artifact_redirect',
  'remediation_disposition_rejected',
] satisfies Array<ConductorEvent['type']>;

const REMEDIATION_CASE_LIFECYCLE_EVENT_TYPES = [
  'remediation_adjudication_started',
  'remediation_adjudication_completed',
  'remediation_adjudication_failed',
  'remediation_case_reconciled',
  'remediation_effect_reserved',
  'remediation_effect_applied',
  'remediation_effect_failed',
  'remediation_semantic_repeat_halt',
] satisfies Array<ConductorEvent['type']>;

const RESEAL_EVENT_TYPES = [
  'protected_artifact_reseal',
  'protected_artifact_reseal_refused',
] satisfies Array<ConductorEvent['type']>;

const PRE_SETTLE_DECISION_PERSISTED_EVENT_TYPES = [
  ...PRE_REFACTOR_PERSISTED_EVENT_TYPES,
  'containment_check_unresolved',
  ...REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES,
  'verdict_freshness',
  'operator_park_boundary',
  // Seal-rebaseline decisions are durable telemetry: the record of which
  // inherited seals were rebaselined (and which were refused as genuine
  // DECIDE-artifact violations) has to outlive the run that made it.
  'protected_artifact_rebaseline',
  'protected_artifact_rebaseline_refused',
  'finish_publication_transition',
  'finish_publication_blocked',
  'finish_publication_disposition',
  'kickback',
  'rebase_changed',
  'rebase_gate_invalidated',
  'build_review_repair_context',
  'build_review_rubric_started',
  'build_review_rubric_prompt',
  'build_review_rubric_result',
  'build_review_rubric_skipped',
  'build_review_cache_hit',
  'build_review_cache_discarded',
  'build_review_rubric_infrastructure_failure',
  'build_review_mechanical_allowance_exhausted',
  'build_review_disposition_version_invalidated',
  'build_review_outer_verdict',
  'build_review_stale_aggregate',
  'loop_halt',
  'halt_marker_write_failed',
  'halt_record_written',
  'halt_record_write_failed',
  'halt_record_push_failed',
  'shipment_evidence_refused',
  'rebase_conflict_halt',
] satisfies Array<ConductorEvent['type']>;

// This is deliberately an exact set rather than a volume count: a newly-persisted
// non-halt event must update this contract explicitly.
const PINNED_PERSISTED_EVENT_TYPES = [
  ...PRE_SETTLE_DECISION_PERSISTED_EVENT_TYPES,
  ...BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES,
  'test_suite_verification',
  // S7.5: the budget basis on a post-rebase preservation is only observable
  // if it reaches .pipeline/events.jsonl — its sibling rebase_gate_invalidated
  // is already persisted, so an unpersisted preservation reads as silence.
  'rebase_gate_preserved',
  'operator_rewind',
  'setup_repair',
  'project_setup',
  'plan_growth',
  'coverage_binding_judged',
  'coverage_binding_disabled',
  'config_deprecated_key',
  'contained_live_checkout_drift',
  'provider_stream_progress',
  'self_host_containment_verdict',
  'over_scope_decision',
  ...REMEDIATION_CASE_LIFECYCLE_EVENT_TYPES,
] satisfies Array<ConductorEvent['type']>;

const NON_PERSISTED_REBASE_LIFECYCLE_EVENT_TYPES = [
  'rebase_noop',
  'rebase_mergeable_skip',
  'rebase_gate_reverified',
  'rebase_citation_residue',
  'rebase_resolution_attempt',
  'rebase_resolution_succeeded',
  'rebase_resolution_failed',
  'rebase_resolution_exhausted',
] satisfies Array<ConductorEvent['type']>;

const buildMemberSettleDecisionEventTypes = new Set<ConductorEvent['type']>(
  BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES,
);

const PRE_REFACTOR_AUDITED_EVENT_TYPES = [
  'gate_verdict',
  'step_retry',
  'kickback',
  'loop_halt',
  'step_completed',
  'step_refused',
  'step_status_write_refused',
  'halt_cleared',
  'operator_rewind',
] satisfies Array<ConductorEvent['type']>;

const DAEMON_SWITCH_HANDLED_EVENT_TYPES = [
  'build_review_cache_discarded',
  'operator_rewind',
  'setup_repair',
  'project_setup',
  'plan_growth',
  'contained_live_checkout_drift',
  'self_host_containment_verdict',
  'step_started',
  'step_completed',
  'step_failed',
  'step_refused',
  'step_status_write_refused',
  'step_retry',
  'rate_limit',
  'session_reset',
  'credentials_park_progress',
  'build_progress',
  'unattributed_progress',
  'build_no_progress',
  'build_stall',
  'pipeline_closeout',
  'pipeline_tail_diagnostic',
  'renderer_error',
  'provider_attempt',
  'scratch_cleanup_reclaimed',
  'scratch_cleanup_retained',
  'scratch_cleanup_failed',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'gate_verdict',
  'kickback',
  'navigation_back',
  'loop_halt',
  'loop_converged',
  'rebase_conflict_halt',
  'ci_failed',
  'build_review_base',
  'build_review_stale_mirage_regrade',
  'auto_park_contradiction',
  'verdict_freshness',
  ...BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES,
  'protected_artifact_rebaseline',
  'protected_artifact_rebaseline_refused',
  ...RESEAL_EVENT_TYPES,
  'parallel_started',
  'parallel_completed',
  'when_skip',
  'rebase_mergeable_skip',
  'operator_park_boundary',
  'finish_publication_transition',
  'finish_publication_blocked',
  'finish_publication_disposition',
  ...REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES,
] satisfies Array<ConductorEvent['type']>;

const { verdict_freshness: _omitted, ...missingVerdictFreshness } = EVENT_SINKS;
// @ts-expect-error -- every ConductorEvent type must declare all three sink decisions.
missingVerdictFreshness satisfies Record<ConductorEvent['type'], SinkDeclaration>;

const { coverage_binding_judged: _coverageBindingJudgedOmitted, ...missingCoverageBindingJudged } = EVENT_SINKS;
// @ts-expect-error -- coverage_binding_judged must declare every sink decision.
missingCoverageBindingJudged satisfies Record<ConductorEvent['type'], SinkDeclaration>;

const { coverage_binding_disabled: _coverageBindingDisabledOmitted, ...missingCoverageBindingDisabled } = EVENT_SINKS;
// @ts-expect-error -- coverage_binding_disabled must declare every sink decision.
missingCoverageBindingDisabled satisfies Record<ConductorEvent['type'], SinkDeclaration>;

// @ts-expect-error -- coverage_binding is intentionally terminal-only telemetry.
const coverageBindingStarted: Extract<ConductorEvent, { type: 'coverage_binding_started' }> = { type: 'coverage_binding_started' };
// @ts-expect-error -- coverage_binding halts are represented by the ordinary step outcome.
const coverageBindingHalted: Extract<ConductorEvent, { type: 'coverage_binding_halted' }> = { type: 'coverage_binding_halted' };
void [coverageBindingStarted, coverageBindingHalted];

const deliberatelyNotPersisted = {
  render: false,
  persist: false,
  audit: false,
  otel: false,
} satisfies SinkDeclaration;
void deliberatelyNotPersisted;

// @ts-expect-error -- probe-failure progress requires its closed kind and next disposition.
const probeFailureMissingClosedMetadata = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'probe-failed', elapsedSeconds: 3, degradation: 'probe-failure' } satisfies ConductorEvent;
// @ts-expect-error -- a terminal probe-failure disposition has no next polling delay.
const probeFailureWithPollingDelay = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'probe-failed', elapsedSeconds: 3, degradation: 'probe-failure', probeFailureKind: 'timeout', nextDisposition: 'trial-required', nextProbeDelaySeconds: 4 } satisfies ConductorEvent;
// @ts-expect-error -- recovery progress retains only the closed parser-rejection union, never raw doctor diagnostics.
const probeFailureWithRawParserRejection = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'probe-failed', elapsedSeconds: 3, degradation: 'probe-failure', probeFailureKind: 'unparseable-output', parserRejection: 'sk-live-super-secret-token /private/codex/credentials.json', nextDisposition: 'trial-required' } satisfies ConductorEvent;
// @ts-expect-error -- conclusive credential progress cannot carry probe-only metadata.
const credentialFailureWithProbeMetadata = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'unusable', elapsedSeconds: 3, nextProbeDelaySeconds: 4, degradation: 'credential-failure', probeFailureKind: 'timeout', nextDisposition: 'trial-required' } satisfies ConductorEvent;
// @ts-expect-error -- probe-failure degradation is valid only with probe-failed readiness.
const probeFailureWithConclusiveReadiness = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'ready', elapsedSeconds: 3, degradation: 'probe-failure', probeFailureKind: 'timeout', nextDisposition: 'trial-required' } satisfies ConductorEvent;
// @ts-expect-error -- missing is conclusive readiness, not probe failure.
const probeFailureWithMissingReadiness = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'missing', elapsedSeconds: 3, degradation: 'probe-failure', probeFailureKind: 'timeout', nextDisposition: 'trial-required' } satisfies ConductorEvent;
// @ts-expect-error -- unusable is conclusive readiness, not probe failure.
const probeFailureWithUnusableReadiness = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'unusable', elapsedSeconds: 3, degradation: 'probe-failure', probeFailureKind: 'timeout', nextDisposition: 'trial-required' } satisfies ConductorEvent;
// @ts-expect-error -- probe-failed readiness cannot be represented as credential failure.
const credentialFailureWithProbeFailedReadiness = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'probe-failed', elapsedSeconds: 3, nextProbeDelaySeconds: 4, degradation: 'credential-failure' } satisfies ConductorEvent;
// @ts-expect-error -- probe-failed readiness cannot be represented as unrelated degradation.
const unrelatedDegradationWithProbeFailedReadiness = { type: 'credentials_park_progress', provider: 'codex', source: 'cached-login', readiness: 'probe-failed', elapsedSeconds: 3, nextProbeDelaySeconds: 4, degradation: 'unrelated-diagnostic-degradation' } satisfies ConductorEvent;
void [
  probeFailureMissingClosedMetadata,
  probeFailureWithPollingDelay,
  probeFailureWithRawParserRejection,
  credentialFailureWithProbeMetadata,
  probeFailureWithConclusiveReadiness,
  probeFailureWithMissingReadiness,
  probeFailureWithUnusableReadiness,
  credentialFailureWithProbeFailedReadiness,
  unrelatedDegradationWithProbeFailedReadiness,
];

describe('event sink subscriptions', () => {
  it('persists coverage-binding terminal observations without rendering, audit, or OpenTelemetry', () => {
    expect({
      judged: EVENT_SINKS.coverage_binding_judged,
      disabled: EVENT_SINKS.coverage_binding_disabled,
      persisted: persistedEventTypes(),
      rendered: renderedEventTypes(),
      audited: auditedEventTypes(),
      otel: otelEventTypes(),
    }).toMatchObject({
      judged: { render: false, persist: true, audit: false, otel: false },
      disabled: { render: false, persist: true, audit: false, otel: false },
      persisted: expect.arrayContaining(['coverage_binding_judged', 'coverage_binding_disabled']),
      rendered: expect.not.arrayContaining(['coverage_binding_judged', 'coverage_binding_disabled']),
      audited: expect.not.arrayContaining(['coverage_binding_judged', 'coverage_binding_disabled']),
      otel: expect.not.arrayContaining(['coverage_binding_judged', 'coverage_binding_disabled']),
    });
  });

  it('subscribes OpenTelemetry only to its defined event set', () => {
    expect(new Set(otelEventTypes())).toEqual(new Set([
      'step_started',
      'step_completed',
      'step_failed',
      'provider_attempt',
      'feature_usage_total',
      'feature_cost_snapshot',
      'step_retry',
      'gate_verdict',
      'kickback',
      'loop_halt',
      'feature_complete',
      'build_progress',
      'unattributed_progress',
      'build_no_progress',
      'build_stall',
      'pipeline_closeout',
    ]));
  });

  it('declares feature cost snapshots as OpenTelemetry-only ledger projections', () => {
    expect({
      sinks: EVENT_SINKS.feature_cost_snapshot,
      otel: otelEventTypes().includes('feature_cost_snapshot'),
      rendered: renderedEventTypes().includes('feature_cost_snapshot'),
      persisted: persistedEventTypes().includes('feature_cost_snapshot'),
    }).toEqual({
      sinks: { render: false, persist: false, audit: false, otel: true },
      otel: true,
      rendered: false,
      persisted: false,
    });
  });

  it('renders and persists renderer errors through the shared event spine', () => {
    expect({
      sinks: EVENT_SINKS.renderer_error,
      rendered: renderedEventTypes().includes('renderer_error'),
      persisted: persistedEventTypes().includes('renderer_error'),
    }).toEqual({
      sinks: { render: true, persist: true, audit: false, otel: false },
      rendered: true,
      persisted: true,
    });
  });

  it('persists engine-owned build-review occurrences through the shared ledger exactly once', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-review-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const event = {
      type: 'build_review_outer_verdict' as const,
      lapId: 'lap-current', rawVerdict: 'FAIL' as const, effectiveVerdict: 'PASS' as const,
    };

    try {
      persister.start();
      await events.emit(event);
      persister.stop();
      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(records).toEqual([{ ...event, ts: expect.any(String) }]);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('declares every remediation case lifecycle occurrence for persistence without extra render, audit, or OTel subscriptions', () => {
    const expected = { render: false, persist: true, audit: false, otel: false };

    expect(
      Object.fromEntries(
        REMEDIATION_CASE_LIFECYCLE_EVENT_TYPES.map((type) => [type, EVENT_SINKS[type]]),
      ),
    ).toEqual(Object.fromEntries(
      REMEDIATION_CASE_LIFECYCLE_EVENT_TYPES.map((type) => [type, expected]),
    ));
  });

  it('persists loop_halt events through the emitter into the pipeline ledger', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'loop-halt-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);

    try {
      persister.start();
      expect(persistedEventTypes()).toContain('loop_halt');
      await events.emit({ type: 'loop_halt', reason: 'kickback cap exceeded' });
      persister.stop();

      expect(JSON.parse(await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8'))).toMatchObject({
        type: 'loop_halt',
        reason: 'kickback cap exceeded',
      });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists recorded over-scope decisions and named defects through the shared ledger', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'over-scope-decision-event-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const event = {
      type: 'over_scope_decision' as const,
      criteria: ['S2.1', 'S2.2'],
      decisions: [
        { criterion: 'S2.1', decision: 'accept' as const },
        { criterion: 'S2.2', decision: 'refuse' as const },
      ],
      defects: [{ kind: 'missing-rationale' as const, criterion: 'S2.3' }],
    } satisfies ConductorEvent;

    try {
      persister.start();
      await events.emit(event);
      persister.stop();

      expect(
        JSON.parse(await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8')),
      ).toEqual({ ...event, ts: expect.any(String) });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists and renders rebase conflict halts with their conflict details', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'rebase-conflict-halt-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const halt = {
      type: 'rebase_conflict_halt' as const,
      reason: 'manual resolution required',
      conflicts: ['src/engine/rebase.ts'],
    };

    try {
      persister.start();
      await events.emit(halt);
      persister.stop();

      expect({
        persisted: persistedEventTypes().includes(halt.type),
        rendered: renderedEventTypes().includes(halt.type),
        ledger: JSON.parse(await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8')),
      }).toMatchObject({
        persisted: true,
        rendered: true,
        ledger: { ...halt, ts: expect.any(String) },
      });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists a kickback to the event ledger without changing its audit record', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'kickback-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const auditTrail = new AuditTrailWriter(projectRoot);
    const kickback = {
      type: 'kickback' as const,
      from: 'test_suite' as const,
      to: 'build' as const,
      evidence: 'Task 1: replace stale anchor.',
      count: 1,
    };

    try {
      persister.start();
      auditTrail.subscribe(events);
      await events.emit(kickback);
      persister.stop();

      const ledger = JSON.parse((await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8')).trim());
      const auditRecord = JSON.parse((await readFile(join(projectRoot, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf-8')).trim());

      expect({ ledger, auditRecord }).toMatchObject({
        ledger: { ...kickback, ts: expect.any(String) },
        auditRecord: {
          origin: 'build',
          event: 'kickback',
          cause: 'test_suite evidence: Task 1: replace stale anchor.',
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists an evidence-less kickback as JSON without an evidence field', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'kickback-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);

    try {
      persister.start();
      await events.emit({ type: 'kickback', from: 'test_suite', to: 'build', count: 1 });
      persister.stop();

      const record = JSON.parse((await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8')).trim());
      expect(record).toEqual({
        type: 'kickback',
        from: 'test_suite',
        to: 'build',
        count: 1,
        ts: expect.any(String),
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps probe-failure progress persisted and rendered without widening audit persistence', () => {
    const progress = {
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
    } satisfies ConductorEvent;

    expect({ progress, sinks: EVENT_SINKS.credentials_park_progress }).toEqual({
      progress,
      sinks: { render: true, persist: true, audit: false, otel: false },
    });
  });

  it('renders pipeline closeouts without persisting the pipeline-owned ledger event', () => {
    expect({
      sinks: EVENT_SINKS.pipeline_closeout,
      rendered: renderedEventTypes().includes('pipeline_closeout'),
      persisted: persistedEventTypes().includes('pipeline_closeout'),
    }).toEqual({
      sinks: { render: true, persist: false, audit: false, otel: true },
      rendered: true,
      persisted: false,
    });
  });

  it('renders and persists tail diagnostics without widening audit or OTel sinks', () => {
    expect(EVENT_SINKS.pipeline_tail_diagnostic).toEqual({
      render: true,
      persist: true,
      audit: false,
      otel: false,
    });
  });

  it('renders and persists conditional skips without widening their other sinks', () => {
    expect(EVENT_SINKS.when_skip).toEqual({
      render: true,
      persist: true,
      audit: false,
      otel: false,
    });
  });

  it('keeps externally-owned build-review dispositions off the engine ledger', () => {
    expect({
      accepted: EVENT_SINKS.build_review_disposition_accepted,
      refused: EVENT_SINKS.build_review_disposition_refused,
      persisted: persistedEventTypes(),
    }).toEqual({
      accepted: { render: false, persist: false, audit: false, otel: false },
      refused: { render: false, persist: false, audit: false, otel: false },
      persisted: expect.not.arrayContaining([
        'build_review_disposition_accepted',
        'build_review_disposition_refused',
      ]),
    });
  });

  it('audits engine-reported non-binding build-review dispositions', () => {
    expect(EVENT_SINKS.build_review_disposition_version_invalidated).toEqual({
      render: false, persist: true, audit: true, otel: false,
    });
  });

  it('defines provider-neutral operator park boundary telemetry without completion authority', () => {
    const boundaries = [
      { kind: 'step', name: 'memory' },
      { kind: 'group', name: 'ship-validation' },
      { kind: 'pre-first-unit' },
    ] satisfies SchedulingUnitRef[];
    const events = boundaries.map((boundary) => ({
      type: 'operator_park_boundary' as const,
      featureSlug: 'boundary-aware-operator-parking',
      boundary,
    })) satisfies ConductorEvent[];

    expect({
      events,
      sinks: EVENT_SINKS.operator_park_boundary,
    }).toEqual({
      events: boundaries.map((boundary) => ({
        type: 'operator_park_boundary',
        featureSlug: 'boundary-aware-operator-parking',
        boundary,
      })),
      sinks: {
        render: true,
        persist: true,
        audit: false,
        otel: false,
      },
    });
  });

  it('defines and persists the three closed build-review repair-context provenance cases', () => {
    const provenance = [
      {
        type: 'build_review_repair_context',
        disposition: 'context_available',
        repairCount: 2,
      },
      {
        type: 'build_review_repair_context',
        disposition: 'none_warranted',
      },
      {
        type: 'build_review_repair_context',
        disposition: 'no_join',
      },
    ] satisfies ConductorEvent[];

    expect({
      provenance,
      sink: EVENT_SINKS.build_review_repair_context,
      persisted: persistedEventTypes().includes('build_review_repair_context'),
    }).toEqual({
      provenance,
      sink: { render: false, persist: true, audit: false, otel: false },
      persisted: true,
    });
  });

  // There is deliberately no total-count assertion here. EVENT_SINKS is typed
  // Record<ConductorEvent['type'], SinkDeclaration>, so tsc already rejects a
  // missing or unknown key — the @ts-expect-error probe above proves it. A runtime
  // count only duplicates the compiler and breaks on every added event variant.

  it('routes verdict_freshness to every sink', () => {
    expect(EVENT_SINKS.verdict_freshness).toEqual({
      render: true,
      persist: true,
      audit: true,
      otel: false,
    });
  });

  it('declares performed and refused operator reseals, auditing both outcomes', () => {
    const events = [
      {
        type: 'protected_artifact_reseal',
        paths: [
          {
            path: '.docs/plans/feature.md',
            priorFingerprint: 'old-fingerprint',
            newFingerprint: 'new-fingerprint',
          },
        ],
        reason: 'correct an accepted plan',
        fromCommit: 'abc123',
        toCommit: 'def456',
      },
      {
        type: 'protected_artifact_reseal_refused',
        reason: 'operator rationale',
        condition: 'unlisted-drift',
        path: '.docs/stories/feature.md',
      },
    ] satisfies ConductorEvent[];

    expect({
      events,
      performed: EVENT_SINKS.protected_artifact_reseal,
      refused: EVENT_SINKS.protected_artifact_reseal_refused,
    }).toEqual({
      events,
      performed: { render: true, persist: false, audit: true, otel: false },
      refused: { render: true, persist: false, audit: true, otel: false },
    });
  });

  it('pins the exact persisted event set to halt-class additions', () => {
    expect(new Set(persistedEventTypes())).toEqual(new Set(PINNED_PERSISTED_EVENT_TYPES));
  });

  it('declares sink policies for halt-record outcomes', () => {
    expect({
      written: EVENT_SINKS.halt_record_written,
      writeFailed: EVENT_SINKS.halt_record_write_failed,
      pushFailed: EVENT_SINKS.halt_record_push_failed,
    }).toEqual({
      written: { render: true, persist: true, audit: true, otel: false },
      writeFailed: { render: true, persist: true, audit: true, otel: false },
      pushFailed: { render: true, persist: true, audit: true, otel: false },
    });
  });

  it('keeps non-halt lifecycle events out of the persisted set', () => {
    const neverPersisted = [
      'loop_converged',
      'build_review_base',
      'pipeline_closeout',
      'retry_decision',
      'group_member_step',
      ...NON_PERSISTED_REBASE_LIFECYCLE_EVENT_TYPES,
    ] satisfies Array<ConductorEvent['type']>;

    expect(Object.fromEntries(neverPersisted.map((type) => [type, EVENT_SINKS[type].persist])))
      .toEqual(Object.fromEntries(neverPersisted.map((type) => [type, false])));
  });

  it('derives the audited set without changing prior routing', () => {
    expect(new Set(auditedEventTypes())).toEqual(new Set([
      ...PRE_REFACTOR_AUDITED_EVENT_TYPES,
      'verdict_freshness',
      'halt_marker_write_failed',
      'halt_record_written',
      'halt_record_write_failed',
      'halt_record_push_failed',
      'shipment_evidence_refused',
      'build_review_disposition_version_invalidated',
      'build_review_cache_discarded',
      ...REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES,
      ...RESEAL_EVENT_TYPES,
    ]));
  });

  it('derives the daemon-rendered set from the switch-handled event types', () => {
    expect(new Set(renderedEventTypes())).toEqual(new Set([
      ...DAEMON_SWITCH_HANDLED_EVENT_TYPES,
      'halt_marker_write_failed',
      'halt_record_written',
      'halt_record_write_failed',
      'halt_record_push_failed',
      'shipment_evidence_refused',
    ]));
  });
});
