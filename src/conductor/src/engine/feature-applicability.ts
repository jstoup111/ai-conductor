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
  const parsed = parseApplicability(content);
  if (!parsed.ok) return parsed;

  if (parsed.declarations.length > 0 && !enabled) {
    return { ok: false, error: { kind: 'capability-disabled', line: parsed.declarations[0].line } };
  }

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
