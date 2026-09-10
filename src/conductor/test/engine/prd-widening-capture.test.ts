import { describe, expect, it } from 'vitest';

import {
  capturePrdWideningDecisions,
  type PrdWideningCaptureDecisionStore,
  type PrdWideningCaptureOfferStore,
} from '../../src/engine/prd-widening-capture.js';
import type { AcceptedWideningDecisionInput } from '../../src/engine/accepted-widenings.js';
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
