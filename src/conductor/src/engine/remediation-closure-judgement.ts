export type RemediationClosureVerdict = 'resolved' | 'persists' | 'partial';

export interface RemediationClosureVerdictResult {
  readonly taskId: string;
  readonly verdict: RemediationClosureVerdict;
  readonly rationale: string;
}

export type RemediationClosureValidation =
  | { readonly kind: 'valid'; readonly verdicts: readonly RemediationClosureVerdictResult[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Provider-visible contract for one verdict per remediation-closure candidate. */
export const REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'verdict', 'rationale'],
        properties: {
          taskId: { type: 'string', pattern: '\\S' },
          verdict: { type: 'string', enum: ['resolved', 'persists', 'partial'] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function validateRemediationClosureOutput(
  output: unknown,
  candidateIds: readonly string[],
): RemediationClosureValidation {
  const root = record(output);
  if (!root || Object.keys(root).some((key) => key !== 'verdicts') || !Array.isArray(root.verdicts)) {
    return { kind: 'invalid', reason: 'remediation closure judgement must be an object with verdicts' };
  }

  const expected = new Set(candidateIds);
  const seen = new Set<string>();
  const verdicts: RemediationClosureVerdictResult[] = [];
  for (const rawVerdict of root.verdicts) {
    const verdict = record(rawVerdict);
    if (!verdict ||
      Object.keys(verdict).some((key) => !['taskId', 'verdict', 'rationale'].includes(key)) ||
      typeof verdict.taskId !== 'string' || !verdict.taskId.trim() ||
      (verdict.verdict !== 'resolved' && verdict.verdict !== 'persists' && verdict.verdict !== 'partial') ||
      typeof verdict.rationale !== 'string' || !verdict.rationale.trim()) {
      return { kind: 'invalid', reason: 'remediation closure judgement has an invalid verdict' };
    }
    if (!expected.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has unexpected verdict for ${verdict.taskId}` };
    }
    if (seen.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has duplicate verdict for ${verdict.taskId}` };
    }
    seen.add(verdict.taskId);
    verdicts.push({
      taskId: verdict.taskId,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
    });
  }
  if (seen.size !== expected.size) {
    return { kind: 'invalid', reason: 'remediation closure judgement omitted a candidate verdict' };
  }
  return { kind: 'valid', verdicts };
}
