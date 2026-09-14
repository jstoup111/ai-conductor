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
      originalSources: [{ sourceId: originalSource.id, snapshot: originalSource.snapshot }],
      currentSources: [{ sourceId: originalSource.id, snapshot: 'Current report wording must not bind authority.', recordedAt: '2026-09-09T00:00:00.000Z' }],
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

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    criterion: 'NC.1',
    summary: 'This text is editable and is not used to bind authority.',
    relation: 'outside-visible',
    offerEntryId: 'case-1',
    originalSource,
    originalCaseId: 'case-1',
    decision: 'accept',
    rationale: 'The operator intentionally approves this original behavior.',
    ...overrides,
  };
}

describe('capturePrdWideningDecisions', () => {
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

  it('threads a rendered prior-decision reference into a valid supersession append', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const result = await capturePrdWideningDecisions(cleared([decision({
      decision: 'refuse',
      priorDecision: { id: 'decision-1', revision: 1 },
    })]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(recorded),
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
        kind: 'revise-decision', criterion: 'NC.1', summary: 'This text is editable and is not used to bind authority.',
        relation: 'outside-visible', offerEntryId: 'case-1', originalSource, originalCaseId: 'case-1',
        priorDecision: { id: 'decision-1', revision: 1 },
      }]);
      const clearedRevision = rendered.replace('"decision": "pending"', '"decision": "refuse",\n    "rationale": "The operator reversed the original acceptance."');

      await expect(capturePrdWideningDecisions(clearedRevision, {
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: store,
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
        operator: 'operator@example.test', offerStore: offerStore(), decisionStore: store,
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
      }));
    }

    expect(recorded).toEqual([]);
    expect(results).toEqual([
      { kind: 'captured', captured: [], defects: [] },
      expect.objectContaining({ defects: [{ kind: 'changed-offer-reference', offerEntryId: 'unrelated-case' }] }),
      { kind: 'absent', captured: [], defects: [] },
      expect.objectContaining({ defects: [{ kind: 'missing-operator', offerEntryId: 'case-1' }] }),
    ]);
  });

  it('leaves an offer-only case replay-safe when authority append fails', async () => {
    const recorded: AcceptedWideningDecisionInput[] = [];
    const failingStore: PrdWideningCaptureDecisionStore = {
      append: async () => ({ ok: false, reason: 'atomic-replace-failed' }),
    };
    const first = await capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: failingStore,
    });
    const replay = await capturePrdWideningDecisions(cleared([decision()]), {
      operator: 'operator@example.test', offerStore: offerStore(), decisionStore: decisionStore(recorded),
    });

    expect(first).toMatchObject({ captured: [], defects: [{ kind: 'write-failed', offerEntryId: 'case-1' }] });
    expect(replay).toMatchObject({ captured: [expect.objectContaining({ offerEntryId: 'case-1' })], defects: [] });
    expect(recorded).toHaveLength(1);
  });
});
