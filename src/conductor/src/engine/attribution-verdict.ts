/**
 * Semantic attribution verdict types and fail-closed parser.
 *
 * Verdict file format: `.pipeline/attribution-verdict.json`
 * See adr-2026-07-11-attribution-verdict-interface for schema details.
 */

/**
 * Valid attribution verdict values for a single task.
 * - `satisfied`: task implementation confirmed via citations and passing tests.
 * - `unsatisfied`: task implementation NOT found; can feed retry hints.
 * - `no-verdict`: judge abstained (ambiguity, uncertainty) — fail-closed default.
 */
export type Verdict = 'satisfied' | 'unsatisfied' | 'no-verdict';

/**
 * Raw verdict result entry from the verifier session.
 */
export interface VerdictResult {
  taskId: string | number;
  verdict: unknown; // unvalidated input
  citations?: Array<{ sha: string; rationale: string }>;
  testEvidence?: {
    command: string;
    exit: number;
    summary?: string;
  };
  reason?: string;
}

/**
 * Raw attribution verdict file structure from `.pipeline/attribution-verdict.json`.
 */
export interface AttributionVerdict {
  schema?: unknown;
  anchor?: { head?: string; residue?: unknown[] };
  results?: unknown;
}

/**
 * Parse an attribution verdict file with fail-closed coercion.
 *
 * Returns a normalized Map<string, Verdict> with one entry per planTaskId.
 * All parsing errors and invalid verdicts coerce to `no-verdict`.
 *
 * Task-id normalization: both sides are normalized via `String()` before matching,
 * so numeric IDs from agent-authored files work correctly.
 *
 * Whitewash guard: `satisfied` verdicts without non-empty citations or without
 * valid testEvidence (exit: 0) are coerced to `no-verdict`.
 *
 * @param raw - parsed or unparsed attribution verdict (unknown)
 * @param planTaskIds - task IDs from the plan (will be normalized)
 * @returns Map<taskId, verdict> with entries for all planTaskIds
 */
export function parseAttributionVerdict(
  raw: unknown,
  planTaskIds: string[]
): Map<string, Verdict> {
  const result = new Map<string, Verdict>();

  // Initialize map with all planTaskIds (deduplicated), defaulting to no-verdict.
  const seenIds = new Set<string>();
  for (const id of planTaskIds) {
    const normalized = String(id);
    if (!seenIds.has(normalized)) {
      seenIds.add(normalized);
      result.set(normalized, 'no-verdict');
    }
  }

  // Fail-closed: if raw is falsy or schema is invalid, return all no-verdict.
  if (!raw || typeof raw !== 'object') {
    return result;
  }

  const obj = raw as Record<string, unknown>;

  // Check schema version (must be exactly 1).
  if (obj.schema !== 1) {
    return result;
  }

  // Validate results is an array.
  if (!Array.isArray(obj.results)) {
    return result;
  }

  // Process each result entry.
  for (const entry of obj.results) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const resultEntry = entry as Record<string, unknown>;

    // Extract and normalize taskId.
    const rawTaskId = resultEntry.taskId;
    if (rawTaskId === undefined || rawTaskId === null) {
      continue;
    }
    const normalizedTaskId = String(rawTaskId);

    // Only process if this taskId is in our plan.
    if (!seenIds.has(normalizedTaskId)) {
      continue;
    }

    // Extract and validate verdict.
    const verdict = parseVerdict(resultEntry);
    result.set(normalizedTaskId, verdict);
  }

  return result;
}

/**
 * Parse and validate a single verdict entry, applying whitewash guard.
 * Returns the validated verdict or 'no-verdict' on any validation failure.
 */
function parseVerdict(entry: Record<string, unknown>): Verdict {
  const rawVerdict = entry.verdict;

  // Check if verdict is a valid string.
  if (typeof rawVerdict !== 'string') {
    return 'no-verdict';
  }

  // Only accept exact lowercase matches.
  if (rawVerdict !== 'satisfied' && rawVerdict !== 'unsatisfied' && rawVerdict !== 'no-verdict') {
    return 'no-verdict';
  }

  // Whitewash guard: satisfied must have non-empty citations AND valid testEvidence.
  if (rawVerdict === 'satisfied') {
    const citations = entry.citations;
    const testEvidence = entry.testEvidence;

    // Check citations exist and are non-empty array.
    if (!Array.isArray(citations) || citations.length === 0) {
      return 'no-verdict';
    }

    // Check testEvidence exists with exit: 0.
    if (
      !testEvidence ||
      typeof testEvidence !== 'object' ||
      (testEvidence as Record<string, unknown>).exit !== 0
    ) {
      return 'no-verdict';
    }
  }

  return rawVerdict as Verdict;
}
