// Covers: task:2, task:3, task:4, task:5
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  capturePrdWideningDecisions,
  parseLegacyPrdWideningClear,
  type PrdWideningCaptureDecisionStore,
  type PrdWideningCaptureOfferStore,
} from '../../src/engine/prd-widening-capture.js';
import {
  AcceptedWideningDecisionStore,
  renderOverScopeDecisionBlock,
  type AcceptedWideningDecisionInput,
} from '../../src/engine/accepted-widenings.js';
import type { RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';

const feature = { version: 'v1' as const, repository: 'example/repository', feature: 'wording-drift' };
const originalSource = { id: 'NC.source.1', snapshot: 'The originally offered visible behavior.' };

function cleared(entries: unknown): string {
  return `\`\`\`json over-scope-decisions\n${JSON.stringify(entries, null, 2)}\n\`\`\``;
}

function offerState(): RemediationCaseStoreState {
  return {
    version: 'v2',
    feature,
    cases: [],
    suppressions: [],
    prdWideningCases: [{
      id: 'case-1',
      domain: 'prd_widening',
      offeredCriterion: 'NC.1',
      originalSources: [{ sourceId: originalSource.id, snapshot: originalSource.snapshot }],
      currentSources: [{ sourceId: originalSource.id, snapshot: 'Current report wording must not bind authority.', recordedAt: '2026-09-09T00:00:00.000Z' }],
      relationships: [],
    }],
  };
}

function siblingOfferState(): RemediationCaseStoreState {
  const state = offerState();
  if (state.version !== 'v2') throw new Error('expected v2 offer state');
  return {
    ...state,
    prdWideningCases: [...state.prdWideningCases, {
      id: 'case-2',
      domain: 'prd_widening',
      offeredCriterion: 'NC.2',
      originalSources: [{ sourceId: 'NC.source.2', snapshot: 'A second originally offered visible behavior.' }],
      currentSources: [],
      relationships: [],
    }],
  };
}

function offerStore(state = offerState()): PrdWideningCaptureOfferStore {
  return {
    mutate: async (operation) => ({ ok: true, value: (await operation(state)).value }),
  };
}

function decisionStore(recorded: AcceptedWideningDecisionInput[] = []): PrdWideningCaptureDecisionStore {
  return {
    append: async (input) => {
      recorded.push(input);
      return { ok: true, decision: { id: `decision-${recorded.length}`, ...input, revision: recorded.length } };
    },
  };
}

function offeredStories(...criteria: string[]) {
  return { kind: 'available' as const, criteria: new Set(criteria) };
}

function legacyClearReference(kind: 'source' | 'case', { criterion, summary }: { criterion: string; summary: string }): string {
  const digest = createHash('sha256').update(criterion).update('\0').update(summary).update('\0').digest('hex');
  return `legacy-clear-${kind}-${digest}`;
}

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    criterion: 'NC.1',
    summary: originalSource.snapshot,
    relation: 'outside-visible',
    offerEntryId: 'case-1',
    originalSource,
    originalCaseId: 'case-1',
    decision: 'accept',
    rationale: 'The operator intentionally approves this original behavior.',
    ...overrides,
  };
}

function siblingDecision(): Record<string, unknown> {
  return {
    criterion: 'NC.2',
    summary: 'A second originally offered visible behavior.',
    relation: 'outside-visible',
    offerEntryId: 'case-2',
    originalSource: { id: 'NC.source.2', snapshot: 'A second originally offered visible behavior.' },
    originalCaseId: 'case-2',
    decision: 'refuse',
    rationale: 'The operator intentionally refuses this separate original behavior.',
  };
}

describe('capturePrdWideningDecisions', () => {
  it('rejects an unoffered story decision while retaining its offered sibling in mixed and story-only blocks', async () => {
    const block = [
      {
        criterion: 'S3.17', summary: 'The offered story criterion.', decision: 'refuse',
        rationale: 'The operator refuses the offered criterion.',
      },
      {
        criterion: 'S9.9', summary: 'A sibling never offered by the audit.', decision: 'accept',
        rationale: 'The operator attempts to accept the unoffered criterion.',
      },
    ];
    for (const [entries, offers, captured] of [[...block, siblingDecision()], block].map((entries, index) =>
      [entries, index === 0 ? siblingOfferState() : offerState(), index === 0
        ? [{ criterion: 'S3.17', authority: 'refuse' }, { criterion: 'NC.2', authority: 'refuse' }]
        : [{ criterion: 'S3.17', authority: 'refuse' }]] as const)) {
      const recorded: AcceptedWideningDecisionInput[] = [];
      const result = await capturePrdWideningDecisions(cleared(entries), {
        operator: 'operator@example.test', offerStore: offerStore(offers), decisionStore: decisionStore(recorded),
        offeredStoryCriteria: offeredStories('S3.17'),
      });
      expect({ result, recorded }).toMatchObject({
        result: {
          captured,
          defects: [{ kind: 'unknown-criterion', criterion: 'S9.9' }],
        },
      });
      expect(recorded).toContainEqual(expect.objectContaining({ criterion: 'S3.17', authority: 'refuse' }));
      expect(recorded).not.toContainEqual(expect.objectContaining({ criterion: 'S9.9' }));
    }
  });

  it('does not capture an offerless story decision when the offered set is unavailable', async () => {
    const result = await capturePrdWideningDecisions(cleared([{
      criterion: 'S3.17', summary: 'The offered story criterion.', decision: 'refuse',
      rationale: 'The operator refuses the offered criterion.',
    }]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(),
      offeredStoryCriteria: { kind: 'unavailable' },
    });

    expect(result).toEqual({
      kind: 'captured', captured: [], defects: [{ kind: 'offered-set-unavailable', criterion: 'S3.17' }],
    });
  });

  it('captures decided offered stories entry by entry when a JSON array also contains pending decisions', async () => {
    const partialRecorded: AcceptedWideningDecisionInput[] = [];
    const partial = await capturePrdWideningDecisions(cleared([
      {
        criterion: 'S1.2', summary: 'The first newly raised story criterion.', decision: 'refuse',
        rationale: 'The operator refuses this criterion.',
      },
      { criterion: 'S1.3', summary: 'The second newly raised story criterion.', decision: 'pending' },
    ]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(partialRecorded),
      offeredStoryCriteria: offeredStories('S1.2', 'S1.3'),
    });

    expect({ partial, partialRecorded }).toMatchObject({
      partial: { kind: 'captured', captured: [{ criterion: 'S1.2', authority: 'refuse' }], defects: [] },
      partialRecorded: [{ criterion: 'S1.2', authority: 'refuse' }],
    });

    const allPendingRecorded: AcceptedWideningDecisionInput[] = [];
    const allPending = await capturePrdWideningDecisions(cleared([
      { criterion: 'S1.2', summary: 'The first newly raised story criterion.', decision: 'pending' },
      decision({ decision: 'pending' }),
    ]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(allPendingRecorded),
      offeredStoryCriteria: offeredStories('S1.2'),
    });

    expect({ allPending, allPendingRecorded }).toEqual({
      allPending: { kind: 'captured', captured: [], defects: [] },
      allPendingRecorded: [],
    });
  });

  it('keeps a fully decided offerless story block as legacy-clear provenance and rejects retired shapes', async () => {
    let legacyState: RemediationCaseStoreState = {
      version: 'v2', feature, cases: [], suppressions: [], prdWideningCases: [],
    };
    const legacyOfferStore: PrdWideningCaptureOfferStore = {
      mutate: async (operation) => {
        const outcome = await operation(legacyState);
        legacyState = outcome.nextState ?? legacyState;
        return { ok: true, value: outcome.value };
      },
    };
    const recorded: AcceptedWideningDecisionInput[] = [];
    const legacyEntries = [
      {
        criterion: 'S1.2', summary: 'The first historical story criterion.', decision: 'accept',
        rationale: 'The operator approved it before offers were recorded.',
      },
      {
        criterion: 'S1.3', summary: 'The second historical story criterion.', decision: 'refuse',
        rationale: 'The operator declined it before offers were recorded.',
      },
    ];
    const legacy = await capturePrdWideningDecisions(cleared(legacyEntries), {
      operator: 'operator@example.test', offerStore: legacyOfferStore, decisionStore: decisionStore(recorded),
      offeredStoryCriteria: offeredStories('S1.2', 'S1.3'),
    });

    expect({ legacy, recorded, legacyState }).toMatchObject({
      legacy: { kind: 'captured', defects: [], captured: [
        {
          criterion: 'S1.2', originalCaseId: legacyClearReference('case', legacyEntries[0]),
          originalSource: { id: legacyClearReference('source', legacyEntries[0]), snapshot: legacyEntries[0].summary },
        },
        {
          criterion: 'S1.3', originalCaseId: legacyClearReference('case', legacyEntries[1]),
          originalSource: { id: legacyClearReference('source', legacyEntries[1]), snapshot: legacyEntries[1].summary },
        },
      ] },
      recorded: [
        {
          criterion: 'S1.2', originalCaseId: legacyClearReference('case', legacyEntries[0]),
          originalSource: { id: legacyClearReference('source', legacyEntries[0]), snapshot: legacyEntries[0].summary },
        },
        {
          criterion: 'S1.3', originalCaseId: legacyClearReference('case', legacyEntries[1]),
          originalSource: { id: legacyClearReference('source', legacyEntries[1]), snapshot: legacyEntries[1].summary },
        },
      ],
      legacyState: { prdWideningCases: [
        { id: legacyClearReference('case', legacyEntries[0]) },
        { id: legacyClearReference('case', legacyEntries[1]) },
      ] },
    });

    await expect(Promise.all([
      capturePrdWideningDecisions('OVER_SCOPE_ACCEPT: S1.2 approved by operator', {
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(), offeredStoryCriteria: offeredStories(),
      }),
      capturePrdWideningDecisions('```json over-scope-decisions\n{"entries":[]}\n```', {
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(), offeredStoryCriteria: offeredStories(),
      }),
    ])).resolves.toEqual([
      { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] },
      { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] },
    ]);
  });
  it('retains supported pre-offer evidence without rebinding it to current wording', () => {
    expect(parseLegacyPrdWideningClear(cleared([{
      criterion: 'NC.9', summary: 'Original reviewer wording.', decision: 'refuse', rationale: 'Out of scope.',
    }]))).toEqual({ kind: 'supported', entries: [{ criterion: 'NC.9', summary: 'Original reviewer wording.', authority: 'refuse', rationale: 'Out of scope.' }] });
    expect(parseLegacyPrdWideningClear('NC.9: accept')).toEqual({ kind: 'absent', entries: [] });
  });
  it('writes each valid original-offer authority once despite current-report wording drift', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];

    const result = await capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test',
      offerStore: offerStore(),
      decisionStore: decisionStore(recorded),
      offeredStoryCriteria: offeredStories(),
    });

    expect(result).toEqual({
      kind: 'captured',
      captured: [expect.objectContaining({ offerEntryId: 'case-1', authority: 'accept' })],
      defects: [],
    });
    expect(recorded).toEqual([expect.objectContaining({
      criterion: 'NC.1',
      authority: 'accept',
      operator: 'operator@example.test',
      originalSource,
      originalCaseId: 'case-1',
      offerEntryId: 'case-1',
    })]);
  });

  it('captures an offerless story refusal beside an offer-backed NC acceptance', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-capture-'));
    try {
      const store = new AcceptedWideningDecisionStore(projectRoot, {
        version: 1, repository: feature.repository, feature: feature.feature,
      }, { newDecisionId: (() => {
        const ids = ['decision-story', 'decision-nc'];
        return () => ids.shift()!;
      })() });
      const result = await capturePrdWideningDecisions(cleared([
        {
          criterion: 'S3.17',
          summary: 'A newly raised story criterion is outside the visible scope.',
          decision: 'refuse',
          rationale: 'The operator refuses this newly raised criterion.',
        },
        { ...siblingDecision(), decision: 'accept' },
      ]), {
        operator: 'operator@example.test', offerStore: offerStore(siblingOfferState()), decisionStore: store,
        offeredStoryCriteria: offeredStories('S3.17'),
      });
      const persisted = await store.read();

      expect({ result, persisted }).toMatchObject({
        result: {
          kind: 'captured',
          captured: [
            { criterion: 'S3.17', authority: 'refuse' },
            { criterion: 'NC.2', authority: 'accept', offerEntryId: 'case-2' },
          ],
          defects: [],
        },
        persisted: {
          kind: 'valid',
          state: {
            decisions: [
              { criterion: 'S3.17', authority: 'refuse' },
              { criterion: 'NC.2', authority: 'accept', offerEntryId: 'case-2' },
            ],
          },
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('captures an offerless story acceptance beside a pending offer-backed entry', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];

    const result = await capturePrdWideningDecisions(cleared([
      {
        criterion: 'S4.2', summary: 'A separately raised story criterion.', decision: 'accept',
        rationale: 'The operator accepts this criterion.',
      },
      decision({ decision: 'pending' }),
    ]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(recorded),
      offeredStoryCriteria: offeredStories('S4.2'),
    });

    expect({ result, recorded }).toMatchObject({
      result: { kind: 'captured', captured: [{ criterion: 'S4.2', authority: 'accept' }], defects: [] },
      recorded: [{ criterion: 'S4.2', authority: 'accept' }],
    });
  });

  it('replays an identical mixed decision block without duplicate story or NC decisions', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-capture-'));
    try {
      const store = new AcceptedWideningDecisionStore(projectRoot, {
        version: 1, repository: feature.repository, feature: feature.feature,
      }, { newDecisionId: (() => {
        let next = 0;
        return () => `decision-${++next}`;
      })() });
      const block = cleared([
        {
          criterion: 'S3.17', summary: 'A newly raised story criterion is outside the visible scope.',
          decision: 'refuse', rationale: 'The operator refuses this newly raised criterion.',
        },
        { ...siblingDecision(), decision: 'accept' },
      ]);
      const options = {
        operator: 'operator@example.test', offerStore: offerStore(siblingOfferState()), decisionStore: store,
        offeredStoryCriteria: offeredStories('S3.17'),
      };

      await capturePrdWideningDecisions(block, options);
      const replay = await capturePrdWideningDecisions(block, options);
      const persisted = await store.read();

      expect({
        replay,
        persisted,
        decisionCount: persisted.kind === 'valid' ? persisted.state.decisions.length : undefined,
      }).toMatchObject({
        replay: { kind: 'captured', defects: [] },
        persisted: { kind: 'valid', state: { decisions: [
          { criterion: 'S3.17', authority: 'refuse' },
          { criterion: 'NC.2', authority: 'accept', offerEntryId: 'case-2' },
        ] } },
        decisionCount: 2,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('threads a rendered prior-decision reference into a valid supersession append', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const result = await capturePrdWideningDecisions(cleared([decision({
      decision: 'refuse',
      priorDecision: { id: 'decision-1', revision: 1 },
    })]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(recorded), offeredStoryCriteria: offeredStories(),
    });

    expect(result).toMatchObject({ kind: 'captured', defects: [] });
    expect(recorded).toEqual([expect.objectContaining({
      authority: 'refuse', offerEntryId: 'case-1', supersedes: { id: 'decision-1', revision: 1 },
    })]);
  });

  it('persists a rendered refusal revision through capture against the real decision store', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-capture-'));
    try {
      const store = new AcceptedWideningDecisionStore(projectRoot, {
        version: 1, repository: feature.repository, feature: feature.feature,
      }, { newDecisionId: (() => {
        const ids = ['decision-1', 'decision-2'];
        return () => ids.shift()!;
      })() });
      await store.append({
        criterion: 'NC.1', authority: 'accept', rationale: 'Initially approved.', operator: 'operator@example.test',
        originalSource, originalCaseId: 'case-1', offerEntryId: 'case-1',
      });
      const rendered = renderOverScopeDecisionBlock([{
        kind: 'revise-decision', criterion: 'NC.1', summary: originalSource.snapshot,
        relation: 'outside-visible', offerEntryId: 'case-1', originalSource, originalCaseId: 'case-1',
        priorDecision: { id: 'decision-1', revision: 1 },
      }]);
      const clearedRevision = rendered.replace('"decision": "pending"', '"decision": "refuse",\n    "rationale": "The operator reversed the original acceptance."');

      await expect(capturePrdWideningDecisions(clearedRevision, {
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: store, offeredStoryCriteria: offeredStories(),
      })).resolves.toMatchObject({ kind: 'captured', defects: [], captured: [{
        id: 'decision-2', authority: 'refuse', offerEntryId: 'case-1', supersedes: { id: 'decision-1', revision: 1 },
      }] });
      await expect(store.read()).resolves.toMatchObject({ kind: 'valid', state: { decisions: [
        { id: 'decision-1', authority: 'accept' },
        { id: 'decision-2', authority: 'refuse', offerEntryId: 'case-1' },
      ] } });
      // A repeat capture of the same persisted revision replays it: no defect,
      // no third decision.
      await expect(capturePrdWideningDecisions(clearedRevision, {
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: store, offeredStoryCriteria: offeredStories(),
      })).resolves.toMatchObject({ kind: 'captured', defects: [], captured: [{ id: 'decision-2', authority: 'refuse' }] });
      const reread = await store.read();
      expect(reread.kind === 'valid' && reread.state.decisions.length).toBe(2);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns row defects without discarding a valid sibling', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const result = await capturePrdWideningDecisions(cleared([
      decision(),
      decision({ offerEntryId: 'changed-case' }),
      decision({ originalSource: { id: originalSource.id, snapshot: 'Altered original evidence.' } }),
      decision({ decision: 'machine-approved' }),
      decision({ rationale: '   ' }),
    ]), {
      operator: 'operator@example.test',
      offerStore: offerStore(),
      decisionStore: decisionStore(recorded),
      offeredStoryCriteria: offeredStories(),
    });

    expect(recorded).toHaveLength(1);
    expect(result).toMatchObject({
      kind: 'captured',
      captured: [expect.objectContaining({ offerEntryId: 'case-1' })],
      defects: [
        { kind: 'changed-offer-reference', offerEntryId: 'changed-case' },
        { kind: 'changed-offer-reference', offerEntryId: 'case-1' },
        { kind: 'invalid-decision', offerEntryId: 'case-1' },
        { kind: 'missing-rationale', offerEntryId: 'case-1' },
      ],
    });
  });

  it('names each readable per-entry capture defect while retaining valid siblings', async () => {
    const story = {
      criterion: 'S3.17', summary: 'The offered story criterion.', decision: 'refuse',
      rationale: 'The operator refuses the offered criterion.',
    };
    const missingRationale = await capturePrdWideningDecisions(cleared([
      { ...story, rationale: '' }, siblingDecision(),
    ]), {
      operator: 'operator@example.test', offerStore: offerStore(siblingOfferState()), decisionStore: decisionStore(),
      offeredStoryCriteria: offeredStories('S3.17'),
    });
    expect(missingRationale).toMatchObject({
      captured: [{ criterion: 'NC.2' }], defects: [{ kind: 'missing-rationale', criterion: 'S3.17' }],
    });

    const changedOffer = await capturePrdWideningDecisions(cleared([
      story, decision(), { ...siblingDecision(), offerEntryId: undefined },
    ]), {
      operator: 'operator@example.test', offerStore: offerStore(siblingOfferState()), decisionStore: decisionStore(),
      offeredStoryCriteria: offeredStories('S3.17'),
    });
    expect(changedOffer).toMatchObject({
      captured: [{ criterion: 'S3.17' }, { criterion: 'NC.1' }],
      defects: [{ kind: 'changed-offer-reference', criterion: 'NC.2' }],
    });

    const duplicate = await capturePrdWideningDecisions(cleared([decision(), decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(), offeredStoryCriteria: offeredStories(),
    });
    expect(duplicate.defects).toContainEqual({ kind: 'duplicate-offer-entry', criterion: 'NC.1', offerEntryId: 'case-1' });

    const noOwner = await capturePrdWideningDecisions(cleared([story, siblingDecision()]), {
      operator: undefined, offerStore: offerStore(siblingOfferState()), decisionStore: decisionStore(),
      offeredStoryCriteria: offeredStories('S3.17'),
    });
    expect(noOwner).toMatchObject({
      captured: [],
      defects: expect.arrayContaining([
        { kind: 'missing-operator', criterion: 'S3.17' },
        { kind: 'missing-operator', criterion: 'NC.2', offerEntryId: 'case-2' },
      ]),
    });
  });

  it.each([
    ['criterion', decision({ criterion: 'S1.1' })],
    ['summary', decision({ summary: 'An operator-edited evidence summary.' })],
    ['relation', decision({ relation: 'inside-visible' })],
  ])('rejects an edited rendered offer %s while capturing a valid sibling', async (_field, altered) => {
    const recorded: AcceptedWideningDecisionInput[] = [];

    const result = await capturePrdWideningDecisions(cleared([altered, siblingDecision()]), {
      operator: 'operator@example.test',
      offerStore: offerStore(siblingOfferState()),
      decisionStore: decisionStore(recorded),
      offeredStoryCriteria: offeredStories(),
    });

    expect(recorded).toEqual([expect.objectContaining({ offerEntryId: 'case-2', criterion: 'NC.2' })]);
    expect(result).toMatchObject({
      kind: 'captured',
      captured: [expect.objectContaining({ offerEntryId: 'case-2' })],
      defects: [{ kind: 'changed-offer-reference', offerEntryId: 'case-1' }],
    });
  });

  it('does not grant authority for pending, unrelated, untouched, or unresolved-owner entries', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const inputs = [
      { body: cleared([decision({ decision: 'pending' })]), operator: 'operator@example.test' },
      { body: cleared([decision({ offerEntryId: 'unrelated-case', originalCaseId: 'unrelated-case' })]), operator: 'operator@example.test' },
      { body: '', operator: 'operator@example.test' },
      { body: cleared([decision()]), operator: undefined },
    ];

    const results = [];
    for (const input of inputs) {
      results.push(await capturePrdWideningDecisions(input.body, {
        operator: input.operator,
        offerStore: offerStore(),
        decisionStore: decisionStore(recorded),
        offeredStoryCriteria: offeredStories(),
      }));
    }

    expect(recorded).toEqual([]);
    expect(results).toEqual([
      { kind: 'captured', captured: [], defects: [] },
      expect.objectContaining({ defects: [{ kind: 'changed-offer-reference', criterion: 'NC.1', offerEntryId: 'unrelated-case' }] }),
      { kind: 'absent', captured: [], defects: [] },
      expect.objectContaining({ defects: [{ kind: 'missing-operator', criterion: 'NC.1', offerEntryId: 'case-1' }] }),
    ]);
  });

  it('leaves an offer-only case replay-safe when authority append fails', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const failingStore: PrdWideningCaptureDecisionStore = {
      append: async () => ({ ok: false, reason: 'atomic-replace-failed' }),
    };
    const first = await capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: failingStore, offeredStoryCriteria: offeredStories(),
    });
    const replay = await capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(recorded), offeredStoryCriteria: offeredStories(),
    });

    expect(first).toMatchObject({ captured: [], defects: [{ kind: 'write-failed', offerEntryId: 'case-1' }] });
    expect(replay).toMatchObject({ captured: [expect.objectContaining({ offerEntryId: 'case-1' })], defects: [] });
    expect(recorded).toHaveLength(1);
  });

  it.each([
    ['invalid-decision', 'invalid-decision'],
    ['lock-timeout', 'write-failed'],
    ['lease-operation-failed', 'write-failed'],
    ['atomic-replace-failed', 'write-failed'],
  ] as const)('classifies an append %s without conflating invalid authority and persistence', async (failure, defect) => {
    const failingStore: PrdWideningCaptureDecisionStore = {
      append: async () => ({ ok: false, reason: failure }),
    };

    await expect(capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: failingStore, offeredStoryCriteria: offeredStories(),
    })).resolves.toMatchObject({
      captured: [],
      defects: [{ kind: defect, offerEntryId: 'case-1' }],
    });
  });
});
