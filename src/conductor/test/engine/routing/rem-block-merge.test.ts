// Covers: task:15
import { describe, expect, it } from 'vitest';

import { unionRemBlocks } from '../../../src/engine/routing/rem-block-merge.js';

const authoredPlan = [
  '# Feature plan',
  '',
  '### Task T3: Authored task',
  'Keep this authored body unchanged.',
].join('\n') + '\n';

function remBlock(id: string, body: string): string {
  return [
    `### Task ${id}: Routed repair`,
    body,
    '**Child:** 2',
    '**Round:** r1',
    '',
  ].join('\n');
}

function appendRemBlocks(plan: string, ...blocks: readonly string[]): string {
  return plan + (plan.endsWith('\n') ? '\n' : '\n\n') + blocks.join('');
}

const remT1 = remBlock('rem-prd-audit-T1', 'Repair T1.');
const remT2 = remBlock('rem-prd-audit-T2', 'Repair T2.');

describe('unionRemBlocks', () => {
  it('unions distinct appended rem blocks in id order after the authored body', () => {
    const result = unionRemBlocks(
      authoredPlan,
      appendRemBlocks(authoredPlan, remT2),
      appendRemBlocks(authoredPlan, remT1),
    );

    expect(result).toEqual({
      kind: 'merged',
      text: appendRemBlocks(authoredPlan, remT1, remT2),
    });
  });

  it('produces byte-identical merged text when the sides are swapped', () => {
    const ours = appendRemBlocks(authoredPlan, remT2);
    const theirs = appendRemBlocks(authoredPlan, remT1);

    expect(unionRemBlocks(authoredPlan, ours, theirs)).toEqual(
      unionRemBlocks(authoredPlan, theirs, ours),
    );
  });

  it('refuses the same rem id with different bodies', () => {
    expect(unionRemBlocks(
      authoredPlan,
      appendRemBlocks(authoredPlan, remT1),
      appendRemBlocks(authoredPlan, remBlock('rem-prd-audit-T1', 'Different repair.')),
    )).toEqual({ kind: 'body-mismatch', remId: 'rem-prd-audit-T1' });
  });

  it('declines an authored-body edit', () => {
    expect(unionRemBlocks(
      authoredPlan,
      authoredPlan.replace('unchanged', 'edited'),
      appendRemBlocks(authoredPlan, remT1),
    )).toEqual({ kind: 'declined' });
  });

  it('declines an append paired with a deletion', () => {
    const base = appendRemBlocks(authoredPlan, remT1);

    expect(unionRemBlocks(
      base,
      appendRemBlocks(base, remT2),
      authoredPlan,
    )).toEqual({ kind: 'declined' });
  });
});
