import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditTrailWriter } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import {
  EVENT_SINKS,
  auditedEventTypes,
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
  'provider_attempt',
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
  'when_skip',
  'parallel_started',
  'parallel_completed',
  'parallel_failure',
  'attribution_divergence',
] satisfies Array<ConductorEvent['type']>;

const BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES = [
  'build_member_evidence_reused',
  'build_member_evidence_recomputed',
] satisfies Array<ConductorEvent['type']>;

const REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES = [
  'remediation_sealed_artifact_redirect',
] satisfies Array<ConductorEvent['type']>;

const RESEAL_EVENT_TYPES = [
  'protected_artifact_reseal',
  'protected_artifact_reseal_refused',
] satisfies Array<ConductorEvent['type']>;

const PRE_SETTLE_DECISION_PERSISTED_EVENT_TYPES = [
  ...PRE_REFACTOR_PERSISTED_EVENT_TYPES,
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
  'halt_cleared',
] satisfies Array<ConductorEvent['type']>;

const DAEMON_SWITCH_HANDLED_EVENT_TYPES = [
  'step_started',
  'step_completed',
  'step_failed',
  'step_retry',
  'rate_limit',
  'session_reset',
  'credentials_park_progress',
  'build_progress',
  'unattributed_progress',
  'build_no_progress',
  'build_stall',
  'pipeline_closeout',
  'provider_attempt',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'gate_verdict',
  'kickback',
  'navigation_back',
  'loop_halt',
  'loop_converged',
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

const deliberatelyNotPersisted = {
  render: false,
  persist: false,
  audit: false,
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
  it('persists a kickback to the event ledger without changing its audit record', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'kickback-event-sinks-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const auditTrail = new AuditTrailWriter(projectRoot);
    const kickback = {
      type: 'kickback' as const,
      from: 'wiring_check' as const,
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
          step: 'build',
          event: 'kickback',
          cause: 'wiring_check evidence: Task 1: replace stale anchor.',
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
      await events.emit({ type: 'kickback', from: 'wiring_check', to: 'build', count: 1 });
      persister.stop();

      const record = JSON.parse((await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8')).trim());
      expect(record).toEqual({
        type: 'kickback',
        from: 'wiring_check',
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
      sinks: { render: true, persist: true, audit: false },
    });
  });

  it('renders pipeline closeouts without persisting the pipeline-owned ledger event', () => {
    expect({
      sinks: EVENT_SINKS.pipeline_closeout,
      rendered: renderedEventTypes().includes('pipeline_closeout'),
      persisted: persistedEventTypes().includes('pipeline_closeout'),
    }).toEqual({
      sinks: { render: true, persist: false, audit: false },
      rendered: true,
      persisted: false,
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
      },
    });
  });

  it('is total over all 72 ConductorEvent types', () => {
    expect(Object.keys(EVENT_SINKS)).toHaveLength(72);
  });

  it('routes verdict_freshness to every sink', () => {
    expect(EVENT_SINKS.verdict_freshness).toEqual({
      render: true,
      persist: true,
      audit: true,
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
      performed: { render: true, persist: false, audit: true },
      refused: { render: true, persist: false, audit: true },
    });
  });

  it('keeps persisted routing equivalent over pre-settle types while including settle decisions', () => {
    const persisted = persistedEventTypes();

    expect(new Set(persisted.filter((type) =>
      !buildMemberSettleDecisionEventTypes.has(type),
    ))).toEqual(new Set(PRE_SETTLE_DECISION_PERSISTED_EVENT_TYPES));
    expect(persisted).toEqual(expect.arrayContaining(BUILD_MEMBER_SETTLE_DECISION_EVENT_TYPES));
    expect(persisted).not.toEqual(Object.keys(EVENT_SINKS));
  });

  it('derives the audited set without changing prior routing', () => {
    expect(new Set(auditedEventTypes())).toEqual(new Set([
      ...PRE_REFACTOR_AUDITED_EVENT_TYPES,
      'verdict_freshness',
      ...REMEDIATION_SEALED_ARTIFACT_REDIRECT_EVENT_TYPES,
      ...RESEAL_EVENT_TYPES,
    ]));
  });

  it('derives the daemon-rendered set from the switch-handled event types', () => {
    expect(new Set(renderedEventTypes())).toEqual(new Set(DAEMON_SWITCH_HANDLED_EVENT_TYPES));
  });
});
