// Covers: task:5
import { describe, expect, it } from 'vitest';
import {
  REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA,
  validateRemediationClosureOutput,
} from '../../src/engine/remediation-closure-judgement.js';

const candidateIds = ['rem-as-built-R5', 'rem-as-built-R11'];
const verdicts = [
  { taskId: 'rem-as-built-R5', verdict: 'resolved', rationale: 'The named repair is present.' },
  { taskId: 'rem-as-built-R11', verdict: 'partial', rationale: 'Only part of the named repair is present.' },
] as const;

describe('remediation closure judgement contract', () => {
  it('returns exactly one unchanged verdict for every candidate', () => {
    expect(validateRemediationClosureOutput({ verdicts }, candidateIds)).toEqual({ kind: 'valid', verdicts });
  });

  it.each([
    ['missing candidate id', { verdicts: [verdicts[0]] }],
    ['extra non-candidate task id', { verdicts: [...verdicts, { taskId: 'rem-as-built-R404', verdict: 'persists', rationale: 'Unexpected task.' }] }],
    ['additional verdict key', { verdicts: [{ ...verdicts[0], unexpected: true }, verdicts[1]] }],
    ['unknown verdict', { verdicts: [{ ...verdicts[0], verdict: 'unknown' }, verdicts[1]] }],
    ['empty rationale', { verdicts: [{ ...verdicts[0], rationale: '' }, verdicts[1]] }],
  ])('rejects a result with %s', (_name, output) => {
    expect(validateRemediationClosureOutput(output, candidateIds)).toMatchObject({ kind: 'invalid' });
  });

  it('exports a closed entry schema matching the verdict contract', () => {
    const entries = REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA.properties.verdicts as {
      items: { additionalProperties: boolean; required: readonly string[]; properties: Record<string, unknown> };
    };
    expect(entries.items).toMatchObject({
      additionalProperties: false,
      required: ['taskId', 'verdict', 'rationale'],
      properties: {
        verdict: { enum: ['resolved', 'persists', 'partial'] },
        rationale: { minLength: 1 },
      },
    });
  });
});
