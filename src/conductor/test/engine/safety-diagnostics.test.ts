import { describe, expect, it } from 'vitest';
import { createSafetyFailureDiagnostic, redactSafetyText } from '../../src/engine/safety-diagnostics.js';

describe('createSafetyFailureDiagnostic', () => {
  it('redacts credential/config canaries and raw provider-body labels before output', () => {
    const canary = 'CANARY_SECRET_907';
    const redacted = redactSafetyText(
      `Authorization: Bearer ${canary}; api_key=${canary}; raw body: ${canary}`,
    );

    expect(redacted).not.toContain(canary);
  });

  it.each([
    ['log', 'provider log: CANARY_SECRET_907'],
    ['attempt metadata', 'attempt reason: token=CANARY_SECRET_907'],
    ['HALT/audit', 'audit body: CANARY_SECRET_907'],
    ['provider error', 'Authorization: Bearer CANARY_SECRET_907'],
    ['repository status', 'git status detail: CANARY_SECRET_907'],
    ['partial cleanup', 'cleanup error: credential=CANARY_SECRET_907'],
  ])('removes the canary from a %s diagnostic', (_surface, text) => {
    expect(redactSafetyText(text)).not.toContain('CANARY_SECRET_907');
  });

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
  ] as const)('does not guess missing or contradictory metadata', (input) => {
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
