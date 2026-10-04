import { parseApplicability, type ApplicabilityDeclaration } from './artifacts.js';
import { ALL_STEPS, isFeatureDeclarable } from './steps.js';

export type ApplicabilityValidationFailure = {
  ok: false;
  error: {
    kind: 'capability-disabled' | 'unknown-step' | 'not-declarable' | 'empty-reason' | 'malformed-line' | 'duplicate-declaration';
    line: number;
    step?: string;
  };
};

export type ApplicabilityValidationResult =
  | { ok: true; declarations: ApplicabilityDeclaration[] }
  | ApplicabilityValidationFailure;

export interface ApplicabilityValidationOptions {
  enabled: boolean;
  customStepNames: readonly string[];
}

/** Validate the complete, feature-scoped applicability declaration contract. */
export function validateApplicability(
  content: string,
  { enabled, customStepNames }: ApplicabilityValidationOptions,
): ApplicabilityValidationResult {
  // A marker is an opt-in to the capability, even when it contains only
  // explanatory prose.  Reject it before parsing so an empty marker cannot
  // bypass a disabled capability.
  if (!enabled) {
    return { ok: false, error: { kind: 'capability-disabled', line: 1 } };
  }
  const parsed = parseApplicability(content);
  if (!parsed.ok) return parsed;

  const seen = new Set<string>();
  for (const declaration of parsed.declarations) {
    if (!ALL_STEPS.some(({ name }) => name === declaration.step) && !customStepNames.includes(declaration.step)) {
      return { ok: false, error: { kind: 'unknown-step', line: declaration.line, step: declaration.step } };
    }
    if (seen.has(declaration.step)) {
      return { ok: false, error: { kind: 'duplicate-declaration', line: declaration.line, step: declaration.step } };
    }
    seen.add(declaration.step);

    const declarability = isFeatureDeclarable(declaration.step, customStepNames);
    if (!declarability.ok) {
      return { ok: false, error: { kind: 'not-declarable', line: declaration.line, step: declaration.step } };
    }
  }

  return parsed;
}
