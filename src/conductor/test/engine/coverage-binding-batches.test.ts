// Covers: task:4, task:10
import { describe, expect, it } from 'vitest';

import { planCoverageBindingBatches } from '../../src/engine/coverage-binding-batches.js';
import { amendmentClaimDigest, claimDigest, type CoverageBindingEnvelopeEntry } from '../../src/engine/coverage-binding-envelope.js';

function claim(index: number) {
  return {
    criterion: `Criterion ${index}`,
    taskIds: [String(index)],
    doneWhen: [[`Check ${index}.`]],
    quote: `Check ${index}.`,
    applicability: 'applicable' as const,
  };
}

function cachedEntry(current: ReturnType<typeof claim>): CoverageBindingEnvelopeEntry {
  return {
    digest: claimDigest(current),
    criterion: current.criterion,
    taskIds: current.taskIds,
    doneWhen: current.doneWhen,
    verdict: 'asserts',
  };
}

function amendment(index: number) {
  return {
    kind: 'amendment' as const,
    artifactPath: `.docs/decisions/adr-${index}.md`,
    amendment: `> **Amended 2026-09-24 by #${index}:** Preserve boundary ${index}.`,
    taskIds: [String(index)],
    doneWhen: [[`Check ${index}.`]],
  };
}

describe('planCoverageBindingBatches', () => {
  it('chunks pending claims in claim order', () => {
    const claims = Array.from({ length: 20 }, (_, index) => claim(index + 1));

    const planned = planCoverageBindingBatches({ claims, previous: null, batchSize: 8 });

    expect(planned.batches.map((batch) => batch.map((pending) => pending.claim.criterion))).toEqual([
      ['Criterion 1', 'Criterion 2', 'Criterion 3', 'Criterion 4', 'Criterion 5', 'Criterion 6', 'Criterion 7', 'Criterion 8'],
      ['Criterion 9', 'Criterion 10', 'Criterion 11', 'Criterion 12', 'Criterion 13', 'Criterion 14', 'Criterion 15', 'Criterion 16'],
      ['Criterion 17', 'Criterion 18', 'Criterion 19', 'Criterion 20'],
    ]);
  });

  it('partitions criterion and amendment claims into separate batches', () => {
    const claims = [claim(1), amendment(2), claim(3), amendment(4)];

    const planned = planCoverageBindingBatches({ claims, previous: null, batchSize: 8 });

    expect(planned.batches.map((batch) => batch.map(({ claim: pending }) => pending.kind ?? 'criterion'))).toEqual([
      ['criterion', 'criterion'],
      ['amendment', 'amendment'],
    ]);
    expect(planned.batches.flat().map(({ claimDigest: digest }) => digest)).toEqual([
      claimDigest(claim(1)),
      claimDigest(claim(3)),
      amendmentClaimDigest(amendment(2)),
      amendmentClaimDigest(amendment(4)),
    ]);
  });

  it('reuses judge verdicts from a partial previous envelope', () => {
    const claims = Array.from({ length: 20 }, (_, index) => claim(index + 1));
    const planned = planCoverageBindingBatches({
      claims,
      previous: {
        version: 1,
        slug: 'feature',
        runId: 'prior-run',
        status: 'partial',
        entries: claims.slice(0, 12).map((current, index) => index === 11
          ? { ...cachedEntry(current), verdict: 'does-not-assert' as const, missingAssertion: 'Missing assertion.' }
          : cachedEntry(current)),
      },
      batchSize: 8,
    });

    expect([planned.entries.map(({ criterion, verdict, missingAssertion }) => ({ criterion, verdict, ...(missingAssertion === undefined ? {} : { missingAssertion }) })), planned.batches.map((batch) => batch.map((pending) => pending.claim.criterion))]).toEqual([
      [
        { criterion: 'Criterion 1', verdict: 'asserts' }, { criterion: 'Criterion 2', verdict: 'asserts' },
        { criterion: 'Criterion 3', verdict: 'asserts' }, { criterion: 'Criterion 4', verdict: 'asserts' },
        { criterion: 'Criterion 5', verdict: 'asserts' }, { criterion: 'Criterion 6', verdict: 'asserts' },
        { criterion: 'Criterion 7', verdict: 'asserts' }, { criterion: 'Criterion 8', verdict: 'asserts' },
        { criterion: 'Criterion 9', verdict: 'asserts' }, { criterion: 'Criterion 10', verdict: 'asserts' },
        { criterion: 'Criterion 11', verdict: 'asserts' },
        { criterion: 'Criterion 12', verdict: 'does-not-assert', missingAssertion: 'Missing assertion.' },
      ],
      [['Criterion 13', 'Criterion 14', 'Criterion 15', 'Criterion 16', 'Criterion 17', 'Criterion 18', 'Criterion 19', 'Criterion 20']],
    ]);
  });

  it('records not-applicable claims instead of reusing their cached verdict', () => {
    const notApplicable = { ...claim(1), applicability: 'not-applicable' as const, doneWhen: [] };
    const applicable = claim(2);
    const planned = planCoverageBindingBatches({
      claims: [notApplicable, applicable],
      previous: {
        version: 1,
        slug: 'feature',
        runId: 'prior-run',
        status: 'done',
        entries: [{ ...cachedEntry({ ...notApplicable, applicability: 'applicable' }), digest: claimDigest(notApplicable) }],
      },
      batchSize: 8,
    });

    expect([planned.entries, planned.batches.map((batch) => batch.map((pending) => pending.claim.criterion))]).toEqual([
      [{ digest: claimDigest(notApplicable), criterion: 'Criterion 1', taskIds: ['1'], doneWhen: [], verdict: 'not-applicable' }],
      [['Criterion 2']],
    ]);
  });

  it('drops stale cache entries and leaves a changed claim pending', () => {
    const changed = { ...claim(1), doneWhen: [['Changed check.']] };
    const prior = claim(1);
    const planned = planCoverageBindingBatches({
      claims: [changed],
      previous: {
        version: 1,
        slug: 'feature',
        runId: 'prior-run',
        status: 'done',
        entries: [cachedEntry(prior), { ...cachedEntry(claim(2)), digest: 'sha256:stale' }],
      },
      batchSize: 8,
    });

    expect([planned.entries, planned.batches.map((batch) => batch.map((pending) => pending.claimDigest))]).toEqual([
      [],
      [[claimDigest(changed)]],
    ]);
  });
});
