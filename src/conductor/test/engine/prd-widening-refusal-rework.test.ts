// Covers: S1.1, S3.1, task:1

import { describe, expect, it } from 'vitest';

import { renderRefusalReworkContext, type RefusalReworkEvidence } from '../../src/engine/prd-widening-refusal-rework.js';

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
  });

  it('derives the NC gap id from the decision, not from the presentation key', () => {
    const renumbered = renderRefusalReworkContext([{ ...ncRefusal, key: 'NC.1' }]);
    expect(renumbered).toContain('refusal-dec-nc-7');
  });

  it('restricts the rework tasks to removing or reworking the refused behavior', () => {
    const text = renderRefusalReworkContext([storyRefusal, ncRefusal]);
    expect(text).toMatch(/must either remove the refused behavior or rework it/);
  });
});
