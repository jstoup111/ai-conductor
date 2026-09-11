// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  resolveExecutionIdentity,
  type ExecutionScope,
} from '../../src/engine/execution-identity.js';
import type { ConductorEvent, ExecutionContext } from '../../src/types/events.js';

const featureOneRunOne: ExecutionScope = {
  featureId: 'feature-one',
  runId: 'run-one',
};

function configuredMember(
  executionId: string,
  parentGroup: string,
  member: string,
): ExecutionContext {
  return {
    executionId,
    subject: { kind: 'configured-member', parentGroup, member },
  };
}

describe('engine/execution-identity', () => {
  it('accepts optional execution context on lifecycle, retry, provider, and member-result events', () => {
    const context = configuredMember('execution-1', 'quality/audit', 'reviewer');
    const events = [
      { type: 'step_started', step: 'build', index: 0, executionContext: context },
      { type: 'step_completed', step: 'build', status: 'done', executionContext: context },
      { type: 'step_failed', step: 'build', error: 'failed', retryCount: 1, executionContext: context },
      { type: 'step_refused', step: 'build', kind: 'seal', reason: 'sealed', executionContext: context },
      { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'retry', executionContext: context },
      {
        type: 'provider_attempt', step: 'build', provider: 'codex', invoked: true, outcome: 'success', executionContext: context,
      },
      {
        type: 'group_member_step', member: 'reviewer', skill: 'review', phase: 'result', outcome: 'completed', executionContext: context,
      },
    ] satisfies ConductorEvent[];

    expect(events).toHaveLength(7);
  });

  it('correlates configured members by execution and feature/run scope', () => {
    const first = resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build',
      executionContext: configuredMember('execution-1', 'quality/audit', 'review/er'),
    });
    const differentParent = resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build',
      executionContext: configuredMember('execution-1', 'security/audit', 'review/er'),
    });
    const differentScope = resolveExecutionIdentity({
      scope: { featureId: 'feature-two', runId: 'run-two' },
      legacyStep: 'build',
      executionContext: configuredMember('execution-1', 'quality/audit', 'review/er'),
    });
    const differentExecution = resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build',
      executionContext: configuredMember('execution-2', 'quality/audit', 'review/er'),
    });

    expect(first).toMatchObject({
      subjectLabel: 'configured:quality%2Faudit/review%2Fer',
      metricLabel: 'configured:quality%2Faudit/review%2Fer',
    });
    expect(first?.correlationKey).not.toBe(differentParent?.correlationKey);
    expect(first?.correlationKey).not.toBe(differentScope?.correlationKey);
    expect(first?.correlationKey).not.toBe(differentExecution?.correlationKey);
    expect(first?.metricLabel).not.toContain('execution-1');
  });

  it('keeps lifecycle labels stable and puts context-free records in the legacy namespace', () => {
    expect(resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build_review',
      executionContext: { executionId: 'execution-2', subject: { kind: 'lifecycle-step', step: 'build_review' } },
    })).toMatchObject({
      subjectLabel: 'build_review',
      metricLabel: 'build_review',
    });

    const legacy = resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build_review',
    });
    const correlated = resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build_review',
      executionContext: { executionId: 'execution-2', subject: { kind: 'lifecycle-step', step: 'build_review' } },
    });

    expect(legacy?.correlationKey).toMatch(/^legacy\u0000/);
    expect(legacy?.correlationKey).not.toBe(correlated?.correlationKey);
  });

  it('rejects malformed explicit context rather than pairing it as a legacy execution', () => {
    expect(resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build',
      executionContext: {
        executionId: '',
        subject: { kind: 'configured-member', parentGroup: 'quality', member: 'reviewer' },
      },
    })).toBeUndefined();
    expect(resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'build',
      executionContext: {
        executionId: 'execution-3',
        subject: { kind: 'lifecycle-step', step: 'plan' },
      },
    })).toBeUndefined();
    expect(resolveExecutionIdentity({
      scope: featureOneRunOne,
      legacyStep: 'not-a-step',
      executionContext: {
        executionId: 'execution-4',
        subject: { kind: 'lifecycle-step', step: 'not-a-step' },
      },
    })).toBeUndefined();
  });
});
