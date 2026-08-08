import { describe, expect, it } from 'vitest';
import {
  decodePrProseJudgment,
  parseFinishPrProseJudgment,
} from '../../src/engine/finish-pr-prose-judgment.js';

describe('FINISH PR-prose judgment adapter', () => {
  it('rejects an accepted-looking response after provider failure', () => {
    expect(decodePrProseJudgment({
      success: false,
      output: '{"kind":"accepted"}',
    })).toEqual({ kind: 'provider_unavailable' });
  });

  it('accepts only the bounded JSON contract and fails closed for unstructured prose', () => {
    expect(parseFinishPrProseJudgment('Repaired.\n{"kind":"revision_required","reason":"placeholder"}'))
      .toEqual({ kind: 'revision_required', reason: 'placeholder' });
    // An unreadable reply is its own kind, not a prose verdict: collapsing it
    // into `structurally_incomplete` halted features for a human on a response
    // defect no human could act on.
    expect(decodePrProseJudgment({ success: true, output: 'The prose looks good.' }))
      .toEqual({ kind: 'malformed_response' });
  });
});
