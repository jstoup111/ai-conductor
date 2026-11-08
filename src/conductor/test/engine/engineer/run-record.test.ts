// Covers: task:1

import { describe, expect, it } from 'vitest';
import {
  classifyArtifacts,
  digestArtifact,
  parseRunRecord,
  recordAcceptance,
  serializeRunRecord,
  stepForArtifactPath,
  type RunRecord,
} from '../../../src/engine/engineer/run-record.js';

const emptyRecord = (): RunRecord => ({
  schemaVersion: 1,
  slug: 'composer-run',
  steps: {},
  needsReconfirm: [],
  ownerHistory: [],
  notes: {},
});

describe('composer run records', () => {
  it.each([
    ['.docs/architecture/composer-run.md', 'architecture_diagram'],
    ['.docs/decisions/architecture-review-composer-run.md', 'architecture_review'],
    ['.docs/conflicts/composer-run.md', 'conflict_check'],
    ['.docs/coherence/composer-run.md', 'coherence_check'],
    ['.docs/plan-review/composer-run.md', 'plan_review'],
  ] as const)('maps %s to its DECIDE checkpoint', (path, step) => {
    expect(stepForArtifactPath(path)).toBe(step);
  });

  it('records accepted artifacts, actor, provider, time, and notes through a lossless round trip', () => {
    const artifacts = [
      digestArtifact('.docs/track/composer-run.md', Buffer.from('product')),
      digestArtifact('.docs/complexity/composer-run.md', Buffer.from('L')),
    ];

    const record = recordAcceptance(emptyRecord(), {
      step: 'explore',
      actor: 'operator-7',
      provider: 'codex',
      at: '2026-11-08T14:12:00.000Z',
      artifacts,
      decisions: ['Use a shared spec branch.'],
      openQuestions: ['Which provider resumes the draft?'],
    });

    expect(record.steps.explore).toEqual({
      state: 'accepted',
      actor: 'operator-7',
      provider: 'codex',
      at: '2026-11-08T14:12:00.000Z',
      artifacts,
    });
    expect(record.notes.explore).toEqual({
      decisions: ['Use a shared spec branch.'],
      openQuestions: ['Which provider resumes the draft?'],
    });
    expect(artifacts).toEqual([
      {
        path: '.docs/track/composer-run.md',
        sha256: 'a8792157cb4f27fb949c035f45518c61e884bb86e6f420204379c2baa8beb66e',
      },
      {
        path: '.docs/complexity/composer-run.md',
        sha256: '72dfcfb0c470ac255cde83fb8fe38de8a128188e03ea5ba5b2a93adbea1062fa',
      },
    ]);
    expect(parseRunRecord(serializeRunRecord(record))).toEqual(record);
  });

  it('classifies unaccepted track and complexity artifacts as drafts without relying on status lines', () => {
    const track = digestArtifact('.docs/track/composer-run.md', Buffer.from('product'));
    const complexity = digestArtifact('.docs/complexity/composer-run.md', Buffer.from('L'));

    expect(classifyArtifacts(emptyRecord(), [track, complexity]).draft).toEqual([
      { ...track, step: 'explore' },
      { ...complexity, step: 'complexity' },
    ]);
  });

  it('marks an edited accepted stories step as draft and later accepted plan as needing reconfirmation', () => {
    const stories = digestArtifact('.docs/stories/composer-run.md', Buffer.from('approved stories'));
    const plan = digestArtifact('.docs/plans/composer-run.md', Buffer.from('approved plan'));
    const withStories = recordAcceptance(emptyRecord(), {
      step: 'stories',
      actor: 'operator-7',
      provider: 'codex',
      at: '2026-11-08T14:12:00.000Z',
      artifacts: [stories],
      decisions: [],
      openQuestions: [],
    });
    const record = recordAcceptance(withStories, {
      step: 'plan',
      actor: 'operator-7',
      provider: 'codex',
      at: '2026-11-08T14:13:00.000Z',
      artifacts: [plan],
      decisions: [],
      openQuestions: [],
    });

    const classification = classifyArtifacts(record, [
      digestArtifact('.docs/stories/composer-run.md', Buffer.from('edited stories')),
      plan,
    ]);

    expect(classification.draft).toEqual([
      expect.objectContaining({ path: '.docs/stories/composer-run.md', step: 'stories' }),
    ]);
    expect(classification.needsReconfirm).toEqual(['plan']);
    expect(classification.accepted).not.toContainEqual(expect.objectContaining({ step: 'plan' }));
  });

  it('rejects unknown schema versions and step states, and never serializes an owner marker', () => {
    expect(() => parseRunRecord(JSON.stringify({
      schemaVersion: 2,
      slug: 'composer-run',
      steps: {},
      needsReconfirm: [],
      ownerHistory: [],
      notes: {},
    }))).toThrow(/schemaVersion/);
    expect(() => parseRunRecord(JSON.stringify({
      schemaVersion: 1,
      slug: 'composer-run',
      steps: { explore: { state: 'pending' } },
      needsReconfirm: [],
      ownerHistory: [],
      notes: {},
    }))).toThrow(/state/);
    expect(serializeRunRecord(emptyRecord())).not.toContain('Owner:');
  });
});
