import { describe, expect, it } from 'vitest';
import { createSafetyFailureDiagnostic } from '../../src/engine/safety-diagnostics.js';

describe('createSafetyFailureDiagnostic', () => {
  it('reports known provider/protection failures with sanitized scope and bounded recovery', () => {
    expect(createSafetyFailureDiagnostic({
      provider: 'codex',
      protection: { name: 'isolated-home', state: 'missing', scope: 'self-host' },
    })).toEqual({
      provider: 'codex',
      protection: 'isolated-home',
      reason: 'Required protection is unavailable.',
      stoppedScope: 'self-host-run',
      recovery: {
        class: 'repair-configuration',
        action: 'Repair the required protection configuration, then start a new run.',
      },
      unverifiable: false,
    });
  });

  it.each([
    [{ provider: '', protection: { name: 'isolated-home', state: 'missing' } }],
    [{ provider: 'claude', protection: { name: '', state: 'missing' } }],
    [{ provider: 'claude', protection: { name: 'isolated-home', state: 'passing' } }],
  ])('does not guess missing or contradictory metadata', (input) => {
    expect(createSafetyFailureDiagnostic(input)).toEqual({
      provider: null,
      protection: null,
      reason: 'Safety protection failure is unverifiable.',
      stoppedScope: 'attempt',
      recovery: {
        class: 'manual-inspection',
        action: 'Inspect the recorded safety inputs and start a new run after correcting them.',
      },
      unverifiable: true,
    });
  });

  it('keeps non-recoverable guidance bounded and free of bypass suggestions', () => {
    const diagnostic = createSafetyFailureDiagnostic({
      provider: 'claude',
      protection: { name: 'protected-artifact-seal', state: 'corrupt' },
    });

    expect(diagnostic).toMatchObject({
      recovery: {
        class: 'manual-inspection',
        action: 'Inspect the protection evidence and start a new run after correcting it.',
      },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/bypass|broad.*permission|unbounded|indefinite/i);
  });
});
