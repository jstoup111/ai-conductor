import { describe, expect, it } from 'vitest';
import { evaluateSafetyBoundary } from '../../src/engine/safety-boundary.js';

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
      protections: [
        { name: 'self-host-isolation', criticality: 'required', applicability: 'not-applicable', state: 'unknown' },
      ],
    });

    expect(verdict.passed).toBe(true);
  });

  it('reports diagnostic gaps without allowing them to override a required failure', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [
        { name: 'protected-artifacts', criticality: 'required', applicability: 'applicable', state: 'missing' },
        { name: 'native-observability', criticality: 'diagnostic', applicability: 'applicable', state: 'missing' },
      ],
    });

    expect(verdict).toMatchObject({
      passed: false,
      requiredFailures: [{ name: 'protected-artifacts' }],
      diagnosticGaps: [{ name: 'native-observability' }],
    });
  });

  it('passes only when every applicable required protection is passing', () => {
    const verdict = evaluateSafetyBoundary({
      protections: [
        { name: 'task-identity', criticality: 'required', applicability: 'applicable', state: 'passing' },
        { name: 'protected-artifacts', criticality: 'required', applicability: 'applicable', state: 'passing' },
        { name: 'native-observability', criticality: 'diagnostic', applicability: 'applicable', state: 'missing' },
      ],
    });

    expect(verdict).toMatchObject({
      passed: true,
      requiredFailures: [],
      diagnosticGaps: [{ name: 'native-observability' }],
    });
  });
});
