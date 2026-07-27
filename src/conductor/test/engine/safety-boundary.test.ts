import { describe, expect, it } from 'vitest';
import {
  SafetyAttemptCache,
  evaluateSafetyBoundary,
  type SafetyAttributionTelemetry,
  type SafetyAttemptIdentity,
  type SafetyVerdict,
} from '../../src/engine/safety-boundary.js';

describe('evaluateSafetyBoundary', () => {
  it('fails when an applicable required protection is missing', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [
        {
          name: 'protected-artifacts',
          criticality: 'required',
          applicability: 'applicable',
          state: 'missing',
        },
      ],
    });

    expect(verdict.passed).toBe(false);
  });

  it('fails closed when an applicable required protection is unknown', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [
        { name: 'task-identity', criticality: 'required', applicability: 'applicable', state: 'unknown' },
      ],
    });

    expect(verdict.passed).toBe(false);
  });

  it('fails closed when a required protection has unknown applicability', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [
        { name: 'self-host-isolation', criticality: 'required', applicability: 'unknown', state: 'passing' },
      ],
    });

    expect(verdict.passed).toBe(false);
  });

  it('distinguishes an explicitly inapplicable required protection from a missing one', () => {
    const verdict = evaluateSafetyBoundary({
      context: { selfHost: false },
      protections: [
        {
          name: 'self-host-isolation',
          criticality: 'required',
          scope: 'self-host',
          applicability: 'not-applicable',
          state: 'unknown',
        },
      ],
    });

    expect(verdict.passed).toBe(true);
  });

  it('fails closed when a self-host protection is falsely marked inapplicable during a self-host attempt', () => {
    const verdict = evaluateSafetyBoundary({
      context: { selfHost: true },
      protections: [
        {
          name: 'self-host-isolation',
          criticality: 'required',
          scope: 'self-host',
          applicability: 'not-applicable',
          state: 'passing',
        },
      ],
    });

    expect(verdict.passed).toBe(false);
  });

  it('fails closed when the run context needed to classify a self-host protection is unavailable', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [{
        name: 'self-host-isolation',
        criticality: 'required',
        scope: 'self-host',
        applicability: 'not-applicable',
        state: 'passing',
      }],
    });

    expect(verdict.passed).toBe(false);
  });

  it('reports diagnostic gaps without allowing them to override a required failure', () => {
    const verdict = evaluateSafetyBoundary({
      provider: 'claude',
      protections: [
        { name: 'protected-artifacts', criticality: 'required', applicability: 'applicable', state: 'missing' },
        {
          name: 'native-observability',
          criticality: 'diagnostic',
          classification: 'diagnostic-only',
          applicability: 'applicable',
          state: 'missing',
        },
      ],
    });

    expect(verdict).toMatchObject({
      passed: false,
      requiredFailures: [{ name: 'protected-artifacts' }],
      failures: [{
        provider: 'claude',
        protection: 'protected-artifacts',
        reason: 'Required protection is unavailable.',
        stoppedScope: 'provider-attempt',
      }],
      diagnosticGaps: [{ name: 'native-observability' }],
    });
  });

  it('passes only when every applicable required protection is passing', () => {
    const verdict = evaluateSafetyBoundary({
      provider: 'claude',
      protections: [
        { name: 'task-identity', criticality: 'required', applicability: 'applicable', state: 'passing' },
        { name: 'protected-artifacts', criticality: 'required', applicability: 'applicable', state: 'passing' },
        {
          name: 'native-observability',
          criticality: 'diagnostic',
          classification: 'diagnostic-only',
          applicability: 'applicable',
          state: 'missing',
        },
      ],
    });

    expect(verdict).toMatchObject({
      passed: true,
      requiredFailures: [],
      diagnosticGaps: [{ name: 'native-observability' }],
    });
  });

  it('permits an explicitly declared diagnostic-only provider gap only after required protections pass', () => {
    const verdict = evaluateSafetyBoundary({
      provider: 'codex',
      protections: [
        { name: 'protected-artifacts', criticality: 'required', applicability: 'applicable', state: 'passing' },
        {
          name: 'native-observability',
          criticality: 'diagnostic',
          classification: 'diagnostic-only',
          applicability: 'applicable',
          state: 'missing',
        },
      ],
    });

    expect(verdict).toMatchObject({
      passed: true,
      requiredFailures: [],
      diagnosticGaps: [{
        provider: 'codex',
        name: 'native-observability',
        classification: 'diagnostic-only',
        state: 'missing',
      }],
    });
  });

  it('fails closed for missing or contradictory capability classifications', () => {
    const verdict = evaluateSafetyBoundary({
      provider: 'claude',
      protections: [
        { name: 'task-identity', criticality: 'required', applicability: 'applicable', state: 'passing' },
        { name: 'unclassified-observability', criticality: 'diagnostic', applicability: 'applicable', state: 'missing' },
        {
          name: 'contradictory-observability',
          criticality: 'diagnostic',
          classification: 'required',
          applicability: 'applicable',
          state: 'missing',
        },
      ],
    });

    expect(verdict).toMatchObject({
      passed: false,
      requiredFailures: [
        { name: 'unclassified-observability' },
        { name: 'contradictory-observability' },
      ],
      diagnosticGaps: [],
    });
  });

  it.each([
    { label: 'present', attribution: { status: 'valid', taskId: '8' } },
    { label: 'absent', attribution: { status: 'absent' } },
    { label: 'concurrent', attribution: { status: 'valid', taskId: '8', concurrentTaskIds: ['7', '9'] } },
    { label: 'stale', attribution: { status: 'stale', taskId: '8' } },
    { label: 'mismatched', attribution: { status: 'mismatched', taskId: '8' } },
  ] satisfies Array<{ label: string; attribution: SafetyAttributionTelemetry }>)(
    'keeps $label attribution advisory for both allowed and forbidden mutations',
    ({ attribution }) => {
      const allowed = evaluateSafetyBoundary({
        attribution,
        protections: [{ name: 'workspace-mutation', criticality: 'required', applicability: 'applicable', state: 'passing' }],
      });
      const forbidden = evaluateSafetyBoundary({
        attribution,
        protections: [{ name: 'workspace-mutation', criticality: 'required', applicability: 'applicable', state: 'missing' }],
      });

      expect(allowed).toMatchObject({ passed: true, attribution });
      expect(forbidden).toMatchObject({ passed: false, attribution });
    },
  );
});

describe('SafetyAttemptCache', () => {
  const identity: SafetyAttemptIdentity = {
    taskId: '17',
    provider: 'claude',
    phase: 'BUILD',
    workspace: '/worktrees/feature-907',
    baseline: 'approved-decide-commit',
    terminalRun: 'run-1',
  };
  const verdict: SafetyVerdict = { passed: true, requiredFailures: [], failures: [], diagnosticGaps: [] };

  it('permits a same-attempt retry to reuse its verified safety state', () => {
    const cache = new SafetyAttemptCache();
    cache.record(identity, verdict);

    expect(cache.reuse({ ...identity })).toBe(verdict);
  });

  it.each([
    ['task', { taskId: '18' }],
    ['provider', { provider: 'codex' }],
    ['phase', { phase: 'SHIP' }],
    ['workspace', { workspace: '/worktrees/other' }],
    ['baseline', { baseline: 'other-approved-commit' }],
    ['terminal run', { terminalRun: 'run-2' }],
  ] as const)('invalidates rather than reuses state for a different %s identity', (_label, mismatch) => {
    const cache = new SafetyAttemptCache();
    cache.record(identity, verdict);

    expect([cache.reuse({ ...identity, ...mismatch }), cache.reuse(identity)]).toEqual([undefined, undefined]);
  });

  it('drops reusable state during terminal cleanup', () => {
    const cache = new SafetyAttemptCache();
    cache.record(identity, verdict);
    cache.clear();

    expect(cache.reuse(identity)).toBeUndefined();
  });
});
