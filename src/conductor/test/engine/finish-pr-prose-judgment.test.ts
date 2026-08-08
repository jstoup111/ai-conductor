import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  advanceFinishPublication,
  type PrProseJudgmentResult,
  type PublicationSnapshot,
} from '../../src/engine/finish-publication.js';
import {
  decodePrProseJudgment,
  MAX_PR_PROSE_JUDGMENT_DETAIL_LENGTH,
  parseFinishPrProseJudgment,
} from '../../src/engine/finish-pr-prose-judgment.js';

describe('FINISH PR-prose judgment adapter', () => {
  it('accepts every provider verdict documented by the finish skill', async () => {
    const skill = await readFile(new URL('../../../../skills/finish/SKILL.md', import.meta.url), 'utf8');
    const documentedVerdicts = [...skill.matchAll(/`(\{[^`]+\})`/g)]
      .map(([, json]) => JSON.parse(json) as Record<string, unknown>)
      .filter((verdict) => typeof verdict.kind === 'string');

    expect(documentedVerdicts).toHaveLength(5);
    expect(new Set(documentedVerdicts.map(({ kind }) => kind))).toEqual(
      new Set(['accepted', 'revision_required', 'refused']),
    );
    expect(documentedVerdicts
      .filter(({ kind }) => kind === 'revision_required')
      .map(({ reason }) => reason)
      .sort()).toEqual(['halt', 'placeholder', 'structurally_incomplete']);

    for (const publicationDisposition of documentedVerdicts) {
      expect(decodePrProseJudgment({ success: true, publicationDisposition })).not.toEqual({
        kind: 'malformed_response',
      });
    }
  });

  it('keeps unstructured prose malformed and retries its publication judgment', async () => {
    const judgment = decodePrProseJudgment({ success: true, output: 'The prose looks good.' });
    expect(judgment).toEqual({ kind: 'malformed_response' });

    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      pr: {
        identity: 'one',
        url: 'https://github.com/acme/widget/pull/1172',
        prose: 'stale',
        ready: false,
      },
      shippedRecord: 'valid',
      outcomeRecord: 'missing',
    };

    await expect(advanceFinishPublication({
      observe: async () => snapshot,
      effects: { dispatchJudgment: async () => judgment },
    })).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'judge_pr_prose',
      reason: 'judgment_malformed_response',
    });
  });

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

  it('bounds overlong detail at the decode boundary without changing detail at the bound', () => {
    const detailAtBound = 'x'.repeat(MAX_PR_PROSE_JUDGMENT_DETAIL_LENGTH);
    const overlongDetail = `${detailAtBound}x`;

    expect(decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused', detail: detailAtBound },
    })).toEqual({ kind: 'refused', detail: detailAtBound });

    const decoded = decodePrProseJudgment({
      success: true,
      publicationDisposition: { kind: 'refused', detail: overlongDetail },
    });
    expect(decoded).toEqual({
      kind: 'refused',
      detail: expect.stringMatching(/…$/),
    });
    expect(decoded.kind === 'refused' && decoded.detail).toHaveLength(MAX_PR_PROSE_JUDGMENT_DETAIL_LENGTH);
  });
});
