import {
  createSafetyFailureDiagnostic,
  type SafetyFailureDiagnostic,
} from './safety-diagnostics.js';

/** Whether a protection applies to the current provider attempt. */
export type SafetyApplicability = 'applicable' | 'not-applicable' | 'unknown';

/** The verified state of a protection that applies to an attempt. */
export type SafetyProtectionState =
  | 'passing'
  | 'missing'
  | 'corrupt'
  | 'stale'
  | 'disabled'
  | 'unknown';

/** Required protections gate work; diagnostic protections only report gaps. */
export type SafetyCriticality = 'required' | 'diagnostic';

/** How the provider declares a protection's capability significance. */
export type SafetyCapabilityClassification = 'required' | 'diagnostic-only';

/** The run class in which a protection is required. */
export type SafetyProtectionScope = 'all' | 'self-host';

/** Facts supplied by the live dispatch path, not by provider configuration. */
export interface SafetyRunContext {
  selfHost: boolean;
}

/** One provider-neutral protection observation. */
export interface SafetyProtection {
  name: string;
  criticality: SafetyCriticality;
  /** Diagnostic gaps are tolerated only when this is explicitly diagnostic-only. */
  classification?: SafetyCapabilityClassification;
  /** Required protections must declare where they are authoritative. */
  scope?: SafetyProtectionScope;
  applicability: SafetyApplicability;
  state: SafetyProtectionState;
}

export interface SafetyBoundaryInput {
  protections: readonly SafetyProtection[];
  /** Provider that produced these observations; required for diagnostic labels. */
  provider?: string;
  /** Actual dispatch context used to verify claimed applicability. */
  context?: SafetyRunContext;
  /** Diagnostic task-local context; deliberately excluded from safety authority. */
  attribution?: SafetyAttributionTelemetry;
}

/** Sanitized task telemetry; it never grants or denies a safety verdict. */
export type SafetyAttributionTelemetry =
  | { status: 'absent' }
  | { status: 'valid' | 'stale' | 'mismatched'; taskId: string; concurrentTaskIds?: readonly string[] };

/** An observed capability gap which does not itself authorize work. */
export interface SafetyDiagnosticGap {
  provider: string;
  name: string;
  classification: 'diagnostic-only';
  applicability: SafetyApplicability;
  state: SafetyProtectionState;
}

/** Aggregate safety decision for one provider attempt. */
export interface SafetyVerdict {
  passed: boolean;
  requiredFailures: readonly SafetyProtection[];
  failures: readonly SafetyFailureDiagnostic[];
  diagnosticGaps: readonly SafetyDiagnosticGap[];
  /** Copied observability context, never an authorization signal. */
  attribution?: SafetyAttributionTelemetry;
}

/** The full identity of one safety-verification lifetime. */
export interface SafetyAttemptIdentity {
  taskId: string;
  provider: string;
  phase: string;
  workspace: string;
  baseline: string;
  terminalRun: string;
}

function sameSafetyAttempt(
  left: SafetyAttemptIdentity,
  right: SafetyAttemptIdentity,
): boolean {
  return (
    left.taskId === right.taskId &&
    left.provider === right.provider &&
    left.phase === right.phase &&
    left.workspace === right.workspace &&
    left.baseline === right.baseline &&
    left.terminalRun === right.terminalRun
  );
}

/**
 * Holds a verified verdict only for the exact active attempt identity. A
 * mismatch clears it before callers can begin a new preflight, preventing a
 * prior task/provider/workspace/run from authorizing later work.
 */
export class SafetyAttemptCache {
  private entry?: { identity: SafetyAttemptIdentity; verdict: SafetyVerdict };

  record(identity: SafetyAttemptIdentity, verdict: SafetyVerdict): void {
    this.entry = { identity: { ...identity }, verdict };
  }

  reuse(identity: SafetyAttemptIdentity): SafetyVerdict | undefined {
    if (!this.entry) return undefined;
    if (!sameSafetyAttempt(this.entry.identity, identity)) {
      this.clear();
      return undefined;
    }
    return this.entry.verdict;
  }

  clear(): void {
    this.entry = undefined;
  }
}

function requiredProtectionFails(
  protection: SafetyProtection,
  context: SafetyRunContext | undefined,
): boolean {
  if (protection.criticality !== 'required') return false;

  const scope = protection.scope ?? 'all';
  if (scope === 'self-host' && !context) return true;
  const requiredHere = scope === 'all' || context?.selfHost === true;
  if (!requiredHere) return protection.applicability !== 'not-applicable';

  return protection.applicability !== 'applicable' || protection.state !== 'passing';
}

function hasProviderLabel(provider: string | undefined): provider is string {
  return provider?.trim().length !== 0;
}

function isDeclaredDiagnosticOnly(
  protection: SafetyProtection,
  provider: string | undefined,
): boolean {
  return (
    protection.criticality === 'diagnostic' &&
    protection.classification === 'diagnostic-only' &&
    hasProviderLabel(provider)
  );
}

function capabilityClassificationFails(
  protection: SafetyProtection,
  provider: string | undefined,
): boolean {
  if (protection.criticality === 'required') {
    return protection.classification === 'diagnostic-only';
  }
  return !isDeclaredDiagnosticOnly(protection, provider);
}

/**
 * Classify a provider attempt without provider-specific assumptions.
 * Required protections fail closed unless explicitly not applicable and every
 * diagnostic gap remains visible without changing that required verdict.
 */
export function evaluateSafetyBoundary(input: SafetyBoundaryInput): SafetyVerdict {
  const requiredFailures = input.protections.filter(
    (protection) =>
      requiredProtectionFails(protection, input.context) ||
      capabilityClassificationFails(protection, input.provider),
  );
  const diagnosticGaps = input.protections
    .filter(
      (protection) =>
        isDeclaredDiagnosticOnly(protection, input.provider) &&
        !(protection.applicability === 'not-applicable' || protection.state === 'passing'),
    )
    .map(({ name, applicability, state }) => ({
      provider: input.provider!,
      name,
      classification: 'diagnostic-only' as const,
      applicability,
      state,
    }));
  const failures = requiredFailures.map((protection) =>
    createSafetyFailureDiagnostic({
      provider: input.provider,
      protection: {
        name: protection.name,
        state: protection.state,
        scope: protection.scope,
      },
    }),
  );

  return {
    passed: requiredFailures.length === 0,
    requiredFailures,
    failures,
    diagnosticGaps,
    ...(input.attribution ? { attribution: input.attribution } : {}),
  };
}
