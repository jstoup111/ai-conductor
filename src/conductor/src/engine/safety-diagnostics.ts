import type { SafetyProtectionScope, SafetyProtectionState } from './safety-boundary.js';

export type SafetyRecoveryClass =
  | 'retry-once'
  | 'restart'
  | 'repair-configuration'
  | 'manual-inspection';

export interface SafetyFailureDiagnostic {
  provider: string | null;
  protection: string | null;
  reason: string;
  stoppedScope: 'attempt' | 'provider-attempt' | 'self-host-run';
  recovery: { class: SafetyRecoveryClass; action: string };
  unverifiable: boolean;
}

export interface SafetyFailureDiagnosticInput {
  provider?: string;
  protection?: {
    name?: string;
    state?: SafetyProtectionState;
    scope?: SafetyProtectionScope;
  };
}

function knownText(value: string | undefined): value is string {
  return value?.trim().length !== 0;
}

/** Remove credential/config values and opaque provider bodies at the safety boundary. */
export function redactSafetyText(value: string): string {
  return value
    .replace(/\b(raw\s+body|body)\s*:\s*[^\n]*/gi, '$1: [REDACTED]')
    .replace(/\bauthorization\s*:\s*bearer\s+[^\s,;]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password|credential)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\bCANARY_SECRET_[A-Za-z0-9_]+\b/g, '[REDACTED]');
}

function unverifiableDiagnostic(): SafetyFailureDiagnostic {
  return {
    provider: null,
    protection: null,
    reason: 'Safety protection failure is unverifiable.',
    stoppedScope: 'attempt',
    recovery: {
      class: 'manual-inspection',
      action: 'Inspect the recorded safety inputs and start a new run after correcting them.',
    },
    unverifiable: true,
  };
}

function recoveryFor(state: SafetyProtectionState): Pick<SafetyFailureDiagnostic, 'reason' | 'recovery'> {
  switch (state) {
    case 'missing':
    case 'disabled':
      return {
        reason: 'Required protection is unavailable.',
        recovery: {
          class: 'repair-configuration',
          action: 'Repair the required protection configuration, then start a new run.',
        },
      };
    case 'stale':
      return {
        reason: 'Required protection verification is stale.',
        recovery: {
          class: 'retry-once',
          action: 'Refresh the protection evidence, then retry this attempt once.',
        },
      };
    case 'corrupt':
      return {
        reason: 'Required protection integrity check failed.',
        recovery: {
          class: 'manual-inspection',
          action: 'Inspect the protection evidence and start a new run after correcting it.',
        },
      };
    case 'unknown':
      return {
        reason: 'Required protection verification is unavailable.',
        recovery: {
          class: 'manual-inspection',
          action: 'Inspect the protection inputs and start a new run after correcting them.',
        },
      };
    case 'passing':
      return unverifiableDiagnostic();
  }
}

/**
 * Produce only bounded, metadata-backed recovery guidance. Unknown or
 * contradictory input is explicit rather than being filled from defaults.
 */
export function createSafetyFailureDiagnostic(
  input: SafetyFailureDiagnosticInput,
): SafetyFailureDiagnostic {
  const protection = input.protection;
  if (
    !knownText(input.provider) ||
    !knownText(protection?.name) ||
    !protection?.state ||
    protection.state === 'passing'
  ) {
    return unverifiableDiagnostic();
  }
  const { reason, recovery } = recoveryFor(protection.state);
  return {
    provider: input.provider,
    protection: protection.name,
    reason,
    stoppedScope: protection.scope === 'self-host' ? 'self-host-run' : 'provider-attempt',
    recovery,
    unverifiable: false,
  };
}
