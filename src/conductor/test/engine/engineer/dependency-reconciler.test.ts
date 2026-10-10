// Covers: task:1, task:2, task:14

import { describe, expect, it } from 'vitest';
import {
  compareEdges,
  declaredEdges,
  sweepDependencyDrift,
  type DependencyDriftTracker,
} from '../../../src/engine/engineer/dependency-reconciler.js';

const SOURCE = 'acme/app#20';

describe('declaredEdges', () => {
  it.each([
    ['blocked by #10', 'Blocked by #10.', ['acme/app#10']],
    ['Depends on: #10 / #11', 'Depends on: #10 / #11.', ['acme/app#10', 'acme/app#11']],
    ['Gated on #10', 'Gated on #10.', ['acme/app#10']],
  ])('extracts the declared targets from %s', (_name, body, targets) => {
    expect(declaredEdges({ ref: SOURCE, body }).edges.map((edge) => edge.target)).toEqual(targets);
  });

  it('unions a structured Depends-on field with prose declarations', () => {
    const result = declaredEdges({
      ref: SOURCE,
      body: 'Free text: blocked by #12.',
      formDependsOn: ['#10'],
    });

    expect(result.edges.map((edge) => edge.target)).toEqual(['acme/app#10', 'acme/app#12']);
  });

  it('dedupes a target declared in both the form and prose', () => {
    const result = declaredEdges({
      ref: SOURCE,
      body: 'Blocked by #10. Depends on #10.',
      formDependsOn: ['acme/app#10'],
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.target).toBe('acme/app#10');
  });

  it.each([
    ['related-to', 'Related to #10.'],
    ['see', 'See #10.'],
    ['reverse blocks', 'Blocks #10.'],
    ['reverse blocker-for', 'Blocker for #10.'],
    ['cross-repository', 'Blocked by other-owner/other-repo#10.'],
    ['number-less blocked-by', 'Blocked by the database migration.'],
  ])('does not auto-declare an edge for %s prose', (_name, body) => {
    expect(declaredEdges({ ref: SOURCE, body }).edges).toEqual([]);
  });

  it('drops a self reference and returns it for manual review', () => {
    const result = declaredEdges({ ref: SOURCE, body: 'Blocked by #20.' });

    expect(result.edges).toEqual([]);
    expect(result.manualReview).toEqual([
      expect.objectContaining({
        source: SOURCE,
        target: SOURCE,
        reason: 'self-reference',
      }),
    ]);
  });

  it('passes parser manual-review items through unchanged', () => {
    const result = declaredEdges({ ref: SOURCE, body: 'Blocker for #10.' });

    expect(result.manualReview).toEqual([
      expect.objectContaining({
        source: SOURCE,
        target: 'acme/app#10',
        reason: 'reverse-direction',
      }),
    ]);
  });

  it('returns identical edge lists for the same form-field and prose reference', () => {
    const form = declaredEdges({ ref: SOURCE, body: '', formDependsOn: ['#10'] });
    const prose = declaredEdges({ ref: SOURCE, body: 'Blocked by #10.' });

    expect(form.edges.map((edge) => edge.target)).toEqual(prose.edges.map((edge) => edge.target));
  });
});

describe('compareEdges', () => {
  it('separates declared targets that are missing from those already blocked by', () => {
    const declared = declaredEdges({
      ref: SOURCE,
      body: 'Blocked by #10. Depends on #11. Gated on #12.',
    }).edges;

    const result = compareEdges(declared, ['acme/app#11']);

    expect(new Set(result.unlinked.map((edge) => edge.target))).toEqual(
      new Set(['acme/app#10', 'acme/app#12']),
    );
    expect(new Set(result.satisfied.map((edge) => edge.target))).toEqual(new Set(['acme/app#11']));
    expect(result.unlinked).not.toContainEqual(result.satisfied[0]);
  });

  it('returns no comparison results when no edges are declared regardless of actual links', () => {
    expect(compareEdges([], ['acme/app#10', 'acme/app#11'])).toEqual({
      unlinked: [],
      satisfied: [],
    });
  });
});

interface DriftIssue {
  number: number;
  body: string;
}

interface DriftBlocker {
  number: number;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned';
}

class RecordingDriftTracker implements DependencyDriftTracker {
  readonly calls: string[] = [];
  readonly writes: string[] = [];

  constructor(
    private readonly issues: readonly DriftIssue[],
    private readonly blockers: ReadonlyMap<number, readonly DriftBlocker[]>,
  ) {}

  async listOpenIssues(repository: string): Promise<readonly DriftIssue[]> {
    this.calls.push(`list:${repository}`);
    return this.issues;
  }

  async getBlockedBy(repository: string, number: number): Promise<readonly DriftBlocker[]> {
    this.calls.push(`blocked_by:${repository}#${number}`);
    return this.blockers.get(number) ?? [];
  }
}

function driftTracker(
  issues: readonly DriftIssue[],
  blockers: Record<number, readonly DriftBlocker[]>,
): RecordingDriftTracker {
  return new RecordingDriftTracker(issues, new Map(Object.entries(blockers).map(([number, entries]) => [Number(number), entries])));
}

describe('sweepDependencyDrift', () => {
  it('returns unlinked, stale, cycle, and direction-contradiction findings from the four-category fixture', async () => {
    const tracker = driftTracker(
      [
        { number: 30, body: 'Blocked by #31.' },
        { number: 32, body: '' },
        { number: 34, body: '' },
        { number: 35, body: '' },
        { number: 36, body: 'Blocks #37.' },
      ],
      {
        30: [],
        32: [{ number: 33, state: 'closed', state_reason: 'not_planned' }],
        34: [{ number: 35, state: 'open' }],
        35: [{ number: 34, state: 'open' }],
        36: [{ number: 37, state: 'open' }],
      },
    );

    await expect(sweepDependencyDrift({ repository: 'acme/app', tracker })).resolves.toEqual({
      kind: 'swept',
      unlinked: [{ source: 'acme/app#30', target: 'acme/app#31', kind: 'blocked-by', blocked_by: true }],
      stale: [{ source: 'acme/app#32', target: 'acme/app#33', kind: 'blocked-by-stale' }],
      cycles: [{ members: ['acme/app#34', 'acme/app#35'] }],
      contradictions: [{ source: 'acme/app#36', target: 'acme/app#37', kind: 'reverse-direction' }],
      indeterminate: [],
    });
  });

  it('excludes completed blockers, closed issues, related prose, and returns a clean result with empty categories', async () => {
    const excluded = driftTracker(
      [
        { number: 38, body: '' },
        { number: 42, body: 'Related to #43.' },
      ],
      { 38: [{ number: 39, state: 'closed', state_reason: 'completed' }], 42: [] },
    );
    const clean = driftTracker([{ number: 50, body: 'No dependencies.' }], { 50: [] });

    await expect(sweepDependencyDrift({ repository: 'acme/app', tracker: excluded })).resolves.toEqual({
      kind: 'swept', unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [],
    });
    await expect(sweepDependencyDrift({ repository: 'acme/app', tracker: clean })).resolves.toEqual({
      kind: 'swept', unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [],
    });
    expect(excluded.calls).not.toContain('blocked_by:acme/app#40');
  });

  it('makes no tracker writes and preserves present stale and cycle links', async () => {
    const tracker = driftTracker(
      [
        { number: 32, body: '' },
        { number: 34, body: '' },
        { number: 35, body: '' },
      ],
      {
        32: [{ number: 33, state: 'closed', state_reason: 'not_planned' }],
        34: [{ number: 35, state: 'open' }],
        35: [{ number: 34, state: 'open' }],
      },
    );

    await sweepDependencyDrift({ repository: 'acme/app', tracker });

    expect(tracker.writes).toEqual([]);
    expect(tracker.calls).toEqual([
      'list:acme/app',
      'blocked_by:acme/app#32',
      'blocked_by:acme/app#34',
      'blocked_by:acme/app#35',
    ]);
    expect(await tracker.getBlockedBy('acme/app', 32)).toEqual([
      { number: 33, state: 'closed', state_reason: 'not_planned' },
    ]);
    expect(await tracker.getBlockedBy('acme/app', 34)).toEqual([{ number: 35, state: 'open' }]);
    expect(await tracker.getBlockedBy('acme/app', 35)).toEqual([{ number: 34, state: 'open' }]);
  });
});
