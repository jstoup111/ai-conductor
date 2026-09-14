/**
 * The only vocabulary a reconciliation provider may return.  This module is
 * deliberately independent of provider output parsing: adapters return an
 * unknown terminal value and the engine validates it here before it can alter
 * durable finding history.
 */
export const PRD_WIDENING_RECONCILIATION_VERSION = 'v1' as const;

export interface PrdWideningReconciliationSource {
  readonly id: string;
}

export interface PrdWideningReconciliationCase {
  readonly id: string;
}

export type PrdWideningReconciliationOutcome =
  | { readonly sourceId: string; readonly kind: 'same-case'; readonly caseId: string; readonly reason: string }
  | { readonly sourceId: string; readonly kind: 'different'; readonly reason: string }
  | { readonly sourceId: string; readonly kind: 'uncertain'; readonly candidateCaseIds: readonly string[]; readonly reason: string };

export interface PrdWideningReconciliationResult {
  readonly version: typeof PRD_WIDENING_RECONCILIATION_VERSION;
  readonly results: readonly PrdWideningReconciliationOutcome[];
}

export type PrdWideningReconciliationRejection =
  | 'invalid-json'
  | 'invalid-shape'
  | 'unknown-field'
  | 'invalid-version'
  | 'invalid-source'
  | 'duplicate-source'
  | 'missing-source'
  | 'unknown-case'
  | 'invalid-outcome';

export type ValidatePrdWideningReconciliationResult =
  | { readonly ok: true; readonly value: PrdWideningReconciliationResult }
  | { readonly ok: false; readonly reason: PrdWideningReconciliationRejection };

const MAX_REFERENCE = 256;
const MAX_REASON = 8_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= maximum;
}

function parseOutcome(value: unknown, sourceIds: ReadonlySet<string>, caseIds: ReadonlySet<string>):
  | { ok: true; value: PrdWideningReconciliationOutcome }
  | { ok: false; reason: PrdWideningReconciliationRejection } {
  if (!record(value) || !text(value.sourceId, MAX_REFERENCE)) return { ok: false, reason: 'invalid-shape' };
  if (!sourceIds.has(value.sourceId)) return { ok: false, reason: 'invalid-source' };
  if (value.kind === 'same-case') {
    if (!exactKeys(value, ['sourceId', 'kind', 'caseId', 'reason'])) return { ok: false, reason: 'unknown-field' };
    if (!text(value.caseId, MAX_REFERENCE) || !caseIds.has(value.caseId) || !text(value.reason, MAX_REASON)) return { ok: false, reason: !caseIds.has(String(value.caseId)) ? 'unknown-case' : 'invalid-outcome' };
    return { ok: true, value: { sourceId: value.sourceId, kind: 'same-case', caseId: value.caseId, reason: value.reason } };
  }
  if (value.kind === 'different') {
    if (!exactKeys(value, ['sourceId', 'kind', 'reason'])) return { ok: false, reason: 'unknown-field' };
    return text(value.reason, MAX_REASON)
      ? { ok: true, value: { sourceId: value.sourceId, kind: 'different', reason: value.reason } }
      : { ok: false, reason: 'invalid-outcome' };
  }
  if (value.kind === 'uncertain') {
    if (!exactKeys(value, ['sourceId', 'kind', 'candidateCaseIds', 'reason'])) return { ok: false, reason: 'unknown-field' };
    if (!Array.isArray(value.candidateCaseIds) || !text(value.reason, MAX_REASON)) return { ok: false, reason: 'invalid-outcome' };
    const seen = new Set<string>();
    for (const id of value.candidateCaseIds) {
      if (!text(id, MAX_REFERENCE) || !caseIds.has(id)) return { ok: false, reason: 'unknown-case' };
      if (seen.has(id)) return { ok: false, reason: 'invalid-outcome' };
      seen.add(id);
    }
    return { ok: true, value: { sourceId: value.sourceId, kind: 'uncertain', candidateCaseIds: value.candidateCaseIds, reason: value.reason } };
  }
  return { ok: false, reason: 'invalid-outcome' };
}

/** Validate structure and then bind every result to the engine's closed snapshot. */
function validateParsedPrdWideningReconciliation(
  raw: unknown,
  sources: readonly PrdWideningReconciliationSource[],
  cases: readonly PrdWideningReconciliationCase[],
): ValidatePrdWideningReconciliationResult {
  if (!record(raw)) return { ok: false, reason: 'invalid-shape' };
  if (!exactKeys(raw, ['version', 'results'])) return { ok: false, reason: 'unknown-field' };
  if (raw.version !== PRD_WIDENING_RECONCILIATION_VERSION) return { ok: false, reason: 'invalid-version' };
  if (!Array.isArray(raw.results)) return { ok: false, reason: 'invalid-shape' };
  const sourceIds = new Set(sources.map((source) => source.id));
  const caseIds = new Set(cases.map((item) => item.id));
  if (sourceIds.size !== sources.length || caseIds.size !== cases.length) return { ok: false, reason: 'invalid-shape' };
  const seen = new Set<string>();
  const results: PrdWideningReconciliationOutcome[] = [];
  for (const item of raw.results) {
    const parsed = parseOutcome(item, sourceIds, caseIds);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.sourceId)) return { ok: false, reason: 'duplicate-source' };
    seen.add(parsed.value.sourceId);
    results.push(parsed.value);
  }
  if (seen.size !== sourceIds.size) return { ok: false, reason: 'missing-source' };
  return { ok: true, value: { version: PRD_WIDENING_RECONCILIATION_VERSION, results } };
}

/**
 * Parse only a complete terminal JSON value, then validate it against the
 * engine's frozen source and case snapshot. This deliberately does not scan
 * markdown or stream text for a JSON-shaped fragment.
 */
export function parsePrdWideningReconciliation(
  raw: unknown,
  sources: readonly PrdWideningReconciliationSource[],
  cases: readonly PrdWideningReconciliationCase[],
): ValidatePrdWideningReconciliationResult {
  if (typeof raw !== 'string') return validateParsedPrdWideningReconciliation(raw, sources, cases);
  try {
    return validateParsedPrdWideningReconciliation(JSON.parse(raw) as unknown, sources, cases);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}

/** Validate the provider's final structured output through the closed parser. */
export function validatePrdWideningReconciliation(
  raw: unknown,
  sources: readonly PrdWideningReconciliationSource[],
  cases: readonly PrdWideningReconciliationCase[],
): ValidatePrdWideningReconciliationResult {
  return parsePrdWideningReconciliation(raw, sources, cases);
}

/** Engine-owned schema forwarded unchanged to native provider adapters. */
export const PRD_WIDENING_RECONCILIATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['version', 'results'], properties: {
    version: { const: PRD_WIDENING_RECONCILIATION_VERSION },
    results: {
      type: 'array', items: {
        oneOf: [
          { type: 'object', additionalProperties: false, required: ['sourceId', 'kind', 'caseId', 'reason'], properties: { sourceId: { type: 'string' }, kind: { const: 'same-case' }, caseId: { type: 'string' }, reason: { type: 'string' } } },
          { type: 'object', additionalProperties: false, required: ['sourceId', 'kind', 'reason'], properties: { sourceId: { type: 'string' }, kind: { const: 'different' }, reason: { type: 'string' } } },
          { type: 'object', additionalProperties: false, required: ['sourceId', 'kind', 'candidateCaseIds', 'reason'], properties: { sourceId: { type: 'string' }, kind: { const: 'uncertain' }, candidateCaseIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } },
        ],
      },
    },
  },
} as const;
