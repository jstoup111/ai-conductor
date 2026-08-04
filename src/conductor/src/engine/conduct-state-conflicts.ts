import type { ConductState } from '../types/state.js';
import { isDeepStrictEqual } from 'node:util';
import type { StateMutation, StateMutationResult } from './conduct-state-store.js';

const MAX_DIAGNOSTIC_STRING_LENGTH = 256;

export type StateMutationValueSummary =
  | { kind: 'undefined' }
  | { kind: 'null' }
  | { kind: 'string'; length: number; redacted: true; truncated: boolean }
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'bigint' }
  | { kind: 'symbol' }
  | { kind: 'function' }
  | { kind: 'array'; length: number; truncated: boolean }
  | { kind: 'object' };

export interface StateMutationDiagnostic {
  field: string;
  writer: string;
  intent: string;
  disposition: 'conflict' | 'resolved';
  expected: StateMutationValueSummary;
  current: StateMutationValueSummary;
  next: StateMutationValueSummary;
}

/** Injected by callers that own the log or error surface for state mutations. */
export interface StateMutationDiagnostics {
  writer: string;
  emit(diagnostic: StateMutationDiagnostic): void;
}

/** Persisted object fields are re-parsed on every store read, so identity alone is not a stable expectation. */
export function stateMutationValuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || isDeepStrictEqual(left, right);
}

/** Produces metadata-only value descriptions suitable for diagnostics. */
function summarizeStateMutationValue(value: unknown): StateMutationValueSummary {
  if (value === undefined) {
    return { kind: 'undefined' };
  }
  if (value === null) {
    return { kind: 'null' };
  }
  if (typeof value === 'string') {
    return {
      kind: 'string',
      length: Math.min(value.length, MAX_DIAGNOSTIC_STRING_LENGTH),
      redacted: true,
      truncated: value.length > MAX_DIAGNOSTIC_STRING_LENGTH,
    };
  }
  switch (typeof value) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'number':
      return { kind: 'number' };
    case 'bigint':
      return { kind: 'bigint' };
    case 'symbol':
      return { kind: 'symbol' };
    case 'function':
      return { kind: 'function' };
  }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: Math.min(value.length, MAX_DIAGNOSTIC_STRING_LENGTH),
      truncated: value.length > MAX_DIAGNOSTIC_STRING_LENGTH,
    };
  }
  return { kind: 'object' };
}

function emitDiagnostic(
  diagnostics: StateMutationDiagnostics | undefined,
  disposition: StateMutationDiagnostic['disposition'],
  currentValue: unknown,
  mutation: StateMutation<ConductState>,
): void {
  diagnostics?.emit({
    field: mutation.field,
    writer: diagnostics.writer,
    intent: mutation.intent,
    disposition,
    expected: summarizeStateMutationValue(mutation.expected),
    current: summarizeStateMutationValue(currentValue),
    next: summarizeStateMutationValue(mutation.next),
  });
}

/**
 * Determines the outcome of a single intent-bearing state mutation without
 * performing persistence.
 */
export function evaluateConductStateMutation(
  currentValue: unknown,
  mutation: StateMutation<ConductState>,
  diagnostics?: StateMutationDiagnostics,
): StateMutationResult {
  if (stateMutationValuesEqual(currentValue, mutation.expected)) {
    return { kind: 'applied' };
  }

  if (stateMutationValuesEqual(currentValue, mutation.next)) {
    return { kind: 'idempotent' };
  }

  if (mutation.field === 'feature_status' && currentValue === 'complete') {
    emitDiagnostic(diagnostics, 'resolved', currentValue, mutation);
    return { kind: 'resolved' };
  }

  emitDiagnostic(diagnostics, 'conflict', currentValue, mutation);
  return {
    kind: 'conflict',
    message: `Expected ${mutation.field} to match before ${mutation.intent}`,
  };
}
