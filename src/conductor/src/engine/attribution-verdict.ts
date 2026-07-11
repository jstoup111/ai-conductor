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
 * Anchor validation: If currentHead and/or plannedResidueIds are supplied, validates
 * that anchor.head matches currentHead and anchor.residue matches planned residue set.
 * If any validation check fails, returns all-no-verdict map (fail-closed).
 *
 * @param raw - parsed or unparsed attribution verdict (unknown)
 * @param planTaskIds - task IDs from the plan (will be normalized)
 * @param currentHead - optional current HEAD to validate against anchor.head
 * @param plannedResidueIds - optional planned residue IDs to validate against anchor.residue
 * @returns Map<taskId, verdict> with entries for all planTaskIds
 */
export function parseAttributionVerdict(
  raw: unknown,
  planTaskIds: string[],
  currentHead?: string,
  plannedResidueIds?: string[]
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

  // Anchor validation: if currentHead or plannedResidueIds are supplied, validate anchor.
  // If validation fails, return all-no-verdict (fail-closed).
  if (currentHead !== undefined || plannedResidueIds !== undefined) {
    if (!isAnchorValid(obj, currentHead, plannedResidueIds)) {
      return result; // Return all no-verdict map
    }
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
 * Validate anchor against supplied currentHead and plannedResidueIds.
 * Returns true if anchor is valid, false if missing, incomplete, or mismatched.
 * Note: Both currentHead and plannedResidueIds must be provided together for validation;
 * providing only one is considered an incomplete validation request (fail-closed).
 */
function isAnchorValid(
  obj: Record<string, unknown>,
  currentHead?: string,
  plannedResidueIds?: string[]
): boolean {
  // Anchor must exist and be an object.
  const anchor = obj.anchor;
  if (!anchor || typeof anchor !== 'object') {
    return false;
  }

  const anchorObj = anchor as Record<string, unknown>;

  // Both validation parameters must be provided together, or neither.
  const hasCurrentHead = currentHead !== undefined;
  const hasPlannedResidueIds = plannedResidueIds !== undefined;

  if (hasCurrentHead !== hasPlannedResidueIds) {
    // One provided but not the other - incomplete validation (fail-closed)
    return false;
  }

  // If currentHead is supplied, anchor.head must match it exactly.
  if (hasCurrentHead) {
    if (anchorObj.head !== currentHead) {
      return false;
    }
  }

  // If plannedResidueIds is supplied, anchor.residue must match the set.
  if (hasPlannedResidueIds) {
    // anchor.residue must be an array.
    if (!Array.isArray(anchorObj.residue)) {
      return false;
    }

    // Normalize both sets and compare.
    const anchorResidueSet = new Set((anchorObj.residue as unknown[]).map((id) => String(id)));
    const plannedResidueSet = new Set(plannedResidueIds);

    // Check if sets are equal: same size and all planned IDs are in anchor.
    if (
      anchorResidueSet.size !== plannedResidueSet.size ||
      ![...plannedResidueSet].every((id) => anchorResidueSet.has(id))
    ) {
      return false;
    }
  }

  return true;
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
