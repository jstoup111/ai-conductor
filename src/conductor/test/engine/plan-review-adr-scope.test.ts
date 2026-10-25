// Covers: task:2
import { describe, expect, it } from 'vitest';
import { splitPlanReviewAdrDecisions } from '../../src/engine/plan-review-adr-scope.js';

const adr = (decisions: readonly string[], lineEnding = '\n') => [
  '# ADR',
  '',
  '## Decision',
  '',
  ...decisions.flatMap((decision, index) => [`D${index + 1}. ${decision}`, '', `Detail ${index + 1}.`, '']),
].join(lineEnding);

describe('splitPlanReviewAdrDecisions', () => {
  it('inlines only changed decisions and indexes every unchanged in-scope decision', () => {
    const adrA = adr(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
    const baseB = adr(['One', 'Two', 'Three']);
    const currentB = adr(['One', 'Two amended', 'Three']);

    expect(splitPlanReviewAdrDecisions({
      planText: 'Uses adr-a and adr-b.',
      adrTexts: { 'adr-a': adrA, 'adr-b': currentB },
      changedPaths: ['.docs/decisions/adr-b.md'],
      baseAdrTexts: { 'adr-b': baseB },
    })).toEqual({
      inline: { 'adr-b#D2': 'D2. Two amended\n\nDetail 2.\n' },
      indexed: [
        { id: 'adr-a#D1', title: 'D1. Alpha', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-a#D2', title: 'D2. Bravo', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-a#D3', title: 'D3. Charlie', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-a#D4', title: 'D4. Delta', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-a#D5', title: 'D5. Echo', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-a#D6', title: 'D6. Foxtrot', path: '.docs/decisions/adr-a.md' },
        { id: 'adr-b#D1', title: 'D1. One', path: '.docs/decisions/adr-b.md' },
        { id: 'adr-b#D3', title: 'D3. Three', path: '.docs/decisions/adr-b.md' },
      ],
    });
  });

  it('inlines every decision of an ADR absent from the merge base', () => {
    expect(splitPlanReviewAdrDecisions({
      planText: 'Uses adr-new.', adrTexts: { 'adr-new': adr(['New one', 'New two']) },
      changedPaths: ['.docs/decisions/adr-new.md'], baseAdrTexts: { 'adr-new': null },
    })).toEqual({ inline: { 'adr-new#D1': 'D1. New one\n\nDetail 1.\n', 'adr-new#D2': 'D2. New two\n\nDetail 2.\n' }, indexed: [] });
  });

  it('inlines all in-scope decisions when base ADR texts are unavailable', () => {
    expect(splitPlanReviewAdrDecisions({
      planText: 'Uses adr-a.', adrTexts: { 'adr-a': adr(['One', 'Two']) }, changedPaths: [], baseAdrTexts: undefined,
    })).toEqual({ inline: { 'adr-a#D1': 'D1. One\n\nDetail 1.\n', 'adr-a#D2': 'D2. Two\n\nDetail 2.\n' }, indexed: [] });
  });

  it('omits a cited ADR without a Decision heading', () => {
    expect(splitPlanReviewAdrDecisions({
      planText: 'Uses adr-empty.', adrTexts: { 'adr-empty': '# ADR\n\n## Context\n\nNothing decided.\n' }, changedPaths: [], baseAdrTexts: {},
    })).toEqual({ inline: {}, indexed: [] });
  });

  it('treats trailing whitespace as changed but normalizes CRLF line endings', () => {
    const base = adr(['Trailing', 'Line endings']);
    const current = adr(['Trailing ', 'Line endings'], '\r\n');
    expect(splitPlanReviewAdrDecisions({
      planText: 'Uses adr-a.', adrTexts: { 'adr-a': current }, changedPaths: ['.docs/decisions/adr-a.md'], baseAdrTexts: { 'adr-a': base },
    })).toEqual({
      inline: { 'adr-a#D1': 'D1. Trailing \n\nDetail 1.\n' },
      indexed: [{ id: 'adr-a#D2', title: 'D2. Line endings', path: '.docs/decisions/adr-a.md' }],
    });
  });
});
