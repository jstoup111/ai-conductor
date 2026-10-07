// Covers: S1.1, S3.1, task:1, task:2

import { describe, expect, it } from 'vitest';

import {
  admitRefusalReworkPlan,
  renderRefusalReworkContext,
  type RefusalReworkEvidence,
} from '../../src/engine/prd-widening-refusal-rework.js';
import type { RemediationGap, RemediationPlan } from '../../src/engine/artifacts.js';

const storyRefusal: RefusalReworkEvidence = {
  key: 'S2.1',
  decisionId: 'dec-story-1',
  revision: 3,
  rationale: 'operator decided the behavior is not wanted',
};

const ncRefusal: RefusalReworkEvidence = {
  key: 'NC.2',
  decisionId: 'dec-nc-7',
  revision: 2,
  rationale: 'outside the accepted case scope',
  caseId: 'case-9',
  snapshot: 'original offer snapshot text',
};

function blocksOf(text: string): string[] {
  return text.split(/\n{2,}/).map((block) => block.trim()).filter((block) => block.length > 0);
}

describe('renderRefusalReworkContext', () => {
  it('renders one block per refusal carrying the decision identity, revision, rationale and required gap id', () => {
    const text = renderRefusalReworkContext([storyRefusal, ncRefusal]);
    const blocks = blocksOf(text);
    const storyBlocks = blocks.filter((block) => block.includes('S2.1'));
    const ncBlocks = blocks.filter((block) => block.includes('NC.2'));
    expect(storyBlocks).toHaveLength(1);
    expect(ncBlocks).toHaveLength(1);
    for (const block of [storyBlocks[0], ncBlocks[0]]) {
      expect(block).toMatch(/dec-story-1|dec-nc-7/);
      expect(block).toContain('(r' + (block === storyBlocks[0] ? '3' : '2') + ')');
      expect(block).toContain('refusal-' + (block === storyBlocks[0] ? 'dec-story-1' : 'dec-nc-7'));
      expect(block).toContain(block === storyBlocks[0] ? 'operator decided the behavior is not wanted' : 'outside the accepted case scope');
    }
  });

  it('includes the original-source snapshot only for the NC refusal', () => {
    const text = renderRefusalReworkContext([storyRefusal, ncRefusal]);
    expect(text).toContain('original offer snapshot text');
    const storyBlock = blocksOf(text).find((block) => block.includes('S2.1'))!;
    expect(storyBlock).not.toContain('snapshot');
    expect(storyBlock).not.toContain('Original case id');
    expect(text).toContain('Original case id: case-9');
  });

  it('derives the NC gap id from the decision, not from the presentation key', () => {
    const renumbered = renderRefusalReworkContext([{ ...ncRefusal, key: 'NC.1' }]);
    expect(renumbered).toContain('refusal-dec-nc-7');
  });

  it('restricts the rework tasks to removing or reworking the refused behavior', () => {
    const text = renderRefusalReworkContext([storyRefusal, ncRefusal]);
    expect(text).toMatch(/refusal-<decisionId> gaps listed below must either remove the refused behavior or rework it/);
  });
});

function buildReworkPlan(gaps: RemediationGap[]): RemediationPlan {
  return { gaps, rejected: [], invalidTasklessBuild: false };
}

function buildReworkGap(overrides?: Partial<RemediationGap>): RemediationGap {
  return {
    id: 'refusal-dec-story-1',
    disposition: 'build',
    category: null,
    rationale: 'remove the refused behavior',
    tasks: [{ id: 'remove-refused-story', title: 'Remove the refused behavior' }],
    ...overrides,
  };
}

describe('admitRefusalReworkPlan', () => {
  it('admits a build gap whose id matches the refusal decision and carries concrete tasks', () => {
    const plan = buildReworkPlan([buildReworkGap()]);
    const result = admitRefusalReworkPlan(plan, [storyRefusal]);

    expect(result).toEqual({
      kind: 'admitted',
      gaps: [{
        id: 'refusal-dec-story-1',
        disposition: 'build',
        category: null,
        rationale: 'remove the refused behavior',
        tasks: [{ id: 'remove-refused-story', title: 'Remove the refused behavior' }],
        gateSource: 'prd-audit',
        criterion: 'S2.1',
        governingClause: 'Refused S2.1 (decision dec-story-1 r3)',
      }],
    });
  });

  it('rejects a gap that is halt/deferral, naming the unbound refusal key', () => {
    const plan = buildReworkPlan([buildReworkGap({ disposition: 'halt', category: 'product-scope' })]);
    const result = admitRefusalReworkPlan(plan, [storyRefusal]);

    expect(result).toEqual({ kind: 'rejected', criteria: ['S2.1'] });
  });

  it('rejects a matching gap with an empty task list, naming the unbound refusal key', () => {
    const plan = buildReworkPlan([buildReworkGap({ tasks: [] })]);
    const result = admitRefusalReworkPlan(plan, [storyRefusal]);

    expect(result).toEqual({ kind: 'rejected', criteria: ['S2.1'] });
  });

  it('rejects a refusal with no matching gap id, naming the unbound refusal key', () => {
    const plan = buildReworkPlan([buildReworkGap({ id: 'refusal-other-decision' })]);
    const result = admitRefusalReworkPlan(plan, [storyRefusal]);

    expect(result).toEqual({ kind: 'rejected', criteria: ['S2.1'] });
  });
});
