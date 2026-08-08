import { describe, expect, it } from 'vitest';
import type { PrProseJudgmentResult } from '../../src/engine/finish-publication.js';
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

  it('retains an optional detail on refused and revision-required verdicts', () => {
    const expectedRefusal: PrProseJudgmentResult = {
      kind: 'refused', detail: 'The PR cannot be safely published.',
    };
    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused', detail: 'The PR cannot be safely published.' },
    })).toEqual(expectedRefusal);

    for (const reason of ['placeholder', 'halt', 'structurally_incomplete'] as const) {
      const expectedRevision: PrProseJudgmentResult = {
        kind: 'revision_required', reason, detail: `${reason} detail`,
      };
      expect(decodePrProseJudgment({
        success: true,
        publicationDisposition: { kind: 'revision_required', reason, detail: `${reason} detail` },
      })).toEqual(expectedRevision);
    }
  });

  it('continues to accept the legacy no-detail refusal and revision-required shapes', () => {
    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused' },
    })).toEqual({ kind: 'refused' });

    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'revision_required', reason: 'placeholder' },
    })).toEqual({ kind: 'revision_required', reason: 'placeholder' });
  });

  it.each([
    ['', 'an empty string'],
    ['  ', 'whitespace'],
    [7, 'a number'],
    [[], 'an array'],
    [{}, 'an object'],
  ])('drops %s detail while preserving the decoded verdict kind', (detail, _description) => {
    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused', detail },
    })).toEqual({ kind: 'refused' });

    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'revision_required', reason: 'placeholder', detail },
    })).toEqual({ kind: 'revision_required', reason: 'placeholder' });
  });

  it('trims a valid nonblank detail at the decode boundary', () => {
    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused', detail: '  The PR cannot be safely published.  ' },
    })).toEqual({ kind: 'refused', detail: 'The PR cannot be safely published.' });
  });
});
