import { describe, expect, it } from 'vitest';
import { extractStoryCriterionIds, splitStoryBlocks } from '../../src/engine/story-criteria.js';

/** One story block in the heading shape real stories files use. */
function story(id: string, happy: readonly string[], negative: readonly string[] = []): string {
  return [
    `## Story ${id}: Title for ${id}`,
    '',
    '### Acceptance Criteria',
    '',
    '#### Happy Path',
    '',
    ...happy.map((text) => `- Given ${text}, when it runs, then it holds`),
    '',
    ...(negative.length === 0 ? [] : [
      '#### Negative Paths',
      '',
      ...negative.map((text) => `- Given ${text}, when it runs, then it is refused`),
      '',
    ]),
  ].join('\n');
}

describe('extractStoryCriterionIds', () => {
  // Story heading ids use the `[A-Za-z0-9.-]` alphabet, so `5` and `5a` are
  // DISTINCT stories and `2` and `2.1` are too. Deriving the criterion id from
  // only the heading's first digit run collapsed each pair onto one id space,
  // and the colliding story's criteria deduped away inside the caller's Set —
  // unaddressable by any key a PRD audit could write.
  it('derives distinct ids for alphanumeric and nested story ids', () => {
    const stories = [
      story('2', ['a']),
      story('2.1', ['b'], ['c']),
      story('5', ['d', 'e']),
      story('5a', ['f'], ['g']),
    ].join('\n');

    expect(splitStoryBlocks(stories).map((block) => block.id))
      .toEqual(['2', '2.1', '5', '5a']);
    expect(extractStoryCriterionIds(stories)).toEqual([
      'S2.1',
      'S2.1.1',
      'S2.1.2',
      'S5.1',
      'S5.2',
      'S5a.1',
      'S5a.2',
    ]);
  });

  it('assigns every criterion a unique id across colliding heading ids', () => {
    // The shape that halted a real build: eleven criteria under Story 5 and
    // eight under Story 5a. Both stories' criteria must survive de-duplication.
    const stories = [
      story('5', Array.from({ length: 11 }, (_, index) => `precondition ${index}`)),
      story('5a', Array.from({ length: 8 }, (_, index) => `stranded pull ${index}`)),
    ].join('\n');

    const ids = extractStoryCriterionIds(stories);

    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
    expect(ids.filter((id) => id.startsWith('S5a.'))).toEqual([
      'S5a.1',
      'S5a.2',
      'S5a.3',
      'S5a.4',
      'S5a.5',
      'S5a.6',
      'S5a.7',
      'S5a.8',
    ]);
  });

  it('numbers happy-path criteria before negative-path criteria within a story', () => {
    expect(extractStoryCriterionIds(story('1', ['a', 'b'], ['c'])))
      .toEqual(['S1.1', 'S1.2', 'S1.3']);
  });

  it('yields no ids for a file whose stories carry no heading id', () => {
    expect(extractStoryCriterionIds('## Story: Untitled\n\n#### Happy Path\n\n- Given a, when b, then c\n'))
      .toEqual([]);
  });
});
