import type { ConductState } from '../types/state.js';

/**
 * Result of evaluating a `when:` expression. When `result` is false and the
 * expression contained an undefined state-key reference, `undefinedKey` is
 * set so the caller can emit a descriptive `when_skip` event.
 */
export interface WhenResult {
  result: boolean;
  undefinedKey?: string;
}

/**
 * Supported `when:` grammar — five forms:
 *
 *   1. `tier == L`            current complexity_tier equals literal
 *   2. `tier in [M, L]`       tier is member of literal set
 *   3. `phase == BUILD`       current phase equals literal (matched against
 *                             a `current_phase` key in state, if present)
 *   4. `${key} == value`      state key equals literal; undefined key → false
 *   5. `A && B`               conjunction of any two of the above forms
 *
 * Evaluation is intentionally minimal and side-effect-free. No mutation of
 * state occurs. Unknown operators or malformed expressions → false (safe
 * default: skip the step rather than mis-dispatch).
 */
export function evaluateWhen(
  expression: string,
  state: ConductState,
): WhenResult {
  const expr = expression.trim();

  // Form 5: A && B (split on first &&)
  const andIdx = expr.indexOf('&&');
  if (andIdx !== -1) {
    const left = expr.slice(0, andIdx).trim();
    const right = expr.slice(andIdx + 2).trim();
    const leftResult = evaluateWhen(left, state);
    if (!leftResult.result) return leftResult; // short-circuit
    const rightResult = evaluateWhen(right, state);
    return rightResult;
  }

  // Form 2: tier in [M, L]
  const inMatch = expr.match(/^tier\s+in\s+\[([^\]]+)\]$/);
  if (inMatch) {
    const members = inMatch[1].split(',').map((s) => s.trim());
    const tier = state.complexity_tier ?? '';
    return { result: members.includes(tier) };
  }

  // Form 1: tier == <literal>
  const tierEqMatch = expr.match(/^tier\s*==\s*(\S+)$/);
  if (tierEqMatch) {
    const expected = tierEqMatch[1];
    const tier = state.complexity_tier ?? '';
    return { result: tier === expected };
  }

  // Form 3: phase == <literal>
  const phaseEqMatch = expr.match(/^phase\s*==\s*(\S+)$/);
  if (phaseEqMatch) {
    const expected = phaseEqMatch[1];
    // `current_phase` is an optional metadata key; undefined → false.
    const currentPhase = (state as Record<string, unknown>)['current_phase'];
    if (currentPhase === undefined) {
      return { result: false, undefinedKey: 'current_phase' };
    }
    return { result: String(currentPhase) === expected };
  }

  // Form 4: ${key} == value
  const stateKeyMatch = expr.match(/^\$\{([^}]+)\}\s*==\s*(.+)$/);
  if (stateKeyMatch) {
    const key = stateKeyMatch[1].trim();
    const expected = stateKeyMatch[2].trim();
    const value = (state as Record<string, unknown>)[key];
    if (value === undefined) {
      return { result: false, undefinedKey: key };
    }
    return { result: String(value) === expected };
  }

  // Unknown / malformed — safe default: evaluate to false.
  return { result: false };
}

/**
 * Validate a `when:` expression at config-load time (before any execution).
 * Returns null when the expression is syntactically valid, or an error
 * message string if it is not.
 *
 * Validation does NOT evaluate the expression (no state is available at
 * config-load time). It only checks that the expression matches one of the
 * five supported grammar forms.
 */
export function validateWhenSyntax(expression: string): string | null {
  const expr = expression.trim();
  if (!expr) return 'when expression must not be empty';
  return validateWhenAtom(expr);
}

/**
 * Recursively validate a `when:` expression. Handles the `&&` conjunction by
 * splitting and validating each side independently.
 */
function validateWhenAtom(expr: string): string | null {
  const andIdx = expr.indexOf('&&');
  if (andIdx !== -1) {
    const left = expr.slice(0, andIdx).trim();
    const right = expr.slice(andIdx + 2).trim();
    if (!left) return '"&&" must have a left-hand operand';
    if (!right) return '"&&" must have a right-hand operand';
    const leftErr = validateWhenAtom(left);
    if (leftErr) return leftErr;
    const rightErr = validateWhenAtom(right);
    if (rightErr) return rightErr;
    return null;
  }

  // tier in [...]
  if (/^tier\s+in\s+\[([^\]]+)\]$/.test(expr)) return null;

  // tier == <literal>
  if (/^tier\s*==\s*\S+$/.test(expr)) return null;

  // phase == <literal>
  if (/^phase\s*==\s*\S+$/.test(expr)) return null;

  // ${key} == value
  if (/^\$\{[^}]+\}\s*==\s*.+$/.test(expr)) return null;

  return `unsupported when expression: "${expr}". ` +
    'Supported forms: "tier == L", "tier in [M, L]", "phase == BUILD", ' +
    '"${key} == value", "A && B"';
}
