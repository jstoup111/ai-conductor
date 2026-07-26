/** Whether a protection applies to the current provider attempt. */
export type SafetyApplicability = 'applicable' | 'not-applicable' | 'unknown';

/** The verified state of a protection that applies to an attempt. */
export type SafetyProtectionState = 'passing' | 'missing' | 'unknown';

/** Required protections gate work; diagnostic protections only report gaps. */
export type SafetyCriticality = 'required' | 'diagnostic';

/** One provider-neutral protection observation. */
export interface SafetyProtection {
  name: string;
  criticality: SafetyCriticality;
  applicability: SafetyApplicability;
  state: SafetyProtectionState;
}

export interface SafetyBoundaryInput {
  protections: readonly SafetyProtection[];
  /** Diagnostic task-local context; deliberately excluded from safety authority. */
  attribution?: SafetyAttributionTelemetry;
}

/** Sanitized task telemetry; it never grants or denies a safety verdict. */
export type SafetyAttributionTelemetry =
  | { status: 'absent' }
  | { status: 'valid' | 'stale' | 'mismatched'; taskId: string; concurrentTaskIds?: readonly string[] };

/** An observed capability gap which does not itself authorize work. */
export interface SafetyDiagnosticGap {
  name: string;
  applicability: SafetyApplicability;
  state: SafetyProtectionState;
}

/** Aggregate safety decision for one provider attempt. */
export interface SafetyVerdict {
  passed: boolean;
  requiredFailures: readonly SafetyProtection[];
  diagnosticGaps: readonly SafetyDiagnosticGap[];
  /** Copied observability context, never an authorization signal. */
  attribution?: SafetyAttributionTelemetry;
}

/**
 * Classify a provider attempt without provider-specific assumptions.
 * Required protections fail closed unless explicitly not applicable and every
 * diagnostic gap remains visible without changing that required verdict.
 */
export function evaluateSafetyBoundary(input: SafetyBoundaryInput): SafetyVerdict {
  const requiredFailures = input.protections.filter(
    (protection) =>
      protection.criticality === 'required' &&
      protection.applicability !== 'not-applicable' &&
      !(protection.applicability === 'applicable' && protection.state === 'passing'),
  );
  const diagnosticGaps = input.protections
    .filter(
      (protection) =>
        protection.criticality === 'diagnostic' &&
        !(protection.applicability === 'not-applicable' || protection.state === 'passing'),
    )
    .map(({ name, applicability, state }) => ({ name, applicability, state }));

  return {
    passed: requiredFailures.length === 0,
    requiredFailures,
    diagnosticGaps,
    ...(input.attribution ? { attribution: input.attribution } : {}),
  };
}
