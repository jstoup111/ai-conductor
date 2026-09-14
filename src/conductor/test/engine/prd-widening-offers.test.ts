// Covers: task:6
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderOverScopeDecisionBlock } from '../../src/engine/accepted-widenings.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { PrdWideningOfferStore } from '../../src/engine/prd-widening-offers.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'durable-widenings' } as const;
const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'prd-widening-offers-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('PRD widening offers', () => {
  it('persists original source and report evidence before returning the editable offer block', async () => {
    const projectRoot = await createProjectRoot();

    const result = await persistPrdWideningOffers(projectRoot, FEATURE, [{
      criterion: 'NC.7',
      sourceId: 'prd-audit:NC.7',
      evidence: 'The original finding describes an externally visible lease expansion.',
      reportSnapshot: 'The full original PRD audit report snapshot.',
      relation: 'outside-visible',
    }], {
      newCaseId: () => 'prd-case-7',
      now: () => '2026-09-09T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      offers: [{
        kind: 'pending',
        criterion: 'NC.7',
        summary: 'The original finding describes an externally visible lease expansion.',
        relation: 'outside-visible',
        offerEntryId: 'prd-case-7',
        originalSource: {
          id: 'prd-audit:NC.7',
          snapshot: 'The original finding describes an externally visible lease expansion.',
        },
        originalCaseId: 'prd-case-7',
      }],
      block: expect.stringContaining('"offerEntryId": "prd-case-7"'),
    });

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toMatchObject({
      ok: true,
      state: {
        feature: FEATURE,
        prdWideningCases: [{
          id: 'prd-case-7',
          domain: 'prd_widening',
          offeredCriterion: 'NC.7',
          originalSources: [{
            sourceId: 'prd-audit:NC.7',
            snapshot: 'The original finding describes an externally visible lease expansion.',
          }],
          currentSources: [{
            sourceId: 'prd-audit:NC.7',
            snapshot: 'The full original PRD audit report snapshot.',
            recordedAt: '2026-09-09T12:00:00.000Z',
          }],
        }],
      },
    });

    await expect(persistPrdWideningOffers(projectRoot, FEATURE, [{
      // A later caller cannot rewrite the criterion in an already stamped offer.
      criterion: 'S1.1',
      sourceId: 'prd-audit:NC.7',
      evidence: 'The original finding describes an externally visible lease expansion.',
      reportSnapshot: 'The full original PRD audit report snapshot.',
      relation: 'outside-visible',
    }], { newCaseId: () => 'must-not-be-used' })).resolves.toMatchObject({
      ok: true,
      offers: [{ criterion: 'NC.7', offerEntryId: 'prd-case-7', originalCaseId: 'prd-case-7' }],
    });
  });

  it('renders a refusal only as an explicit revision and leaves persistence failures without an editable offer', async () => {
    const refusalBlock = renderOverScopeDecisionBlock([{
      kind: 'revise-decision',
      criterion: 'NC.8',
      summary: 'The refused behavior remains visible and outside the approved scope.',
      relation: 'outside-visible',
      offerEntryId: 'prd-case-8',
      originalSource: { id: 'prd-audit:NC.8', snapshot: 'Original refusal evidence.' },
      originalCaseId: 'prd-case-8',
      priorDecision: { id: 'decision-8', revision: 3 },
    }]);
    expect(refusalBlock).toContain('"kind": "revise-decision"');
    expect(refusalBlock).toContain('"priorDecision"');
    expect(refusalBlock).toContain('"decision": "pending"');
    expect(refusalBlock).not.toContain('"decision": "accept"');
    expect(renderOverScopeDecisionBlock([{
      criterion: 'S2.1',
      summary: 'A harmless internal cleanup.',
      relation: 'outside-harmless',
    }])).toBe('');

    const failedStore: PrdWideningOfferStore = {
      mutate: async () => ({ ok: false, reason: 'atomic-replace-failed' }),
    };
    const result = await persistPrdWideningOffers('/unused', FEATURE, [{
      criterion: 'NC.9',
      sourceId: 'prd-audit:NC.9',
      evidence: 'Original evidence.',
      reportSnapshot: 'Original report.',
      relation: 'outside-visible',
    }], { store: failedStore });

    expect(result).toEqual({
      ok: false,
      reason: 'could not persist PRD widening offer: atomic-replace-failed',
      offers: [],
      block: '',
    });
  });

  it('renders pending offers separately from refusal-revision offers', () => {
    const rendered = renderOverScopeDecisionBlock([{
      kind: 'pending',
      criterion: 'NC.10',
      summary: 'A newly reported scope expansion.',
      relation: 'outside-visible',
      offerEntryId: 'prd-case-10',
      originalSource: { id: 'prd-audit:NC.10', snapshot: 'Original pending evidence.' },
      originalCaseId: 'prd-case-10',
    }, {
      kind: 'revise-decision',
      criterion: 'NC.11',
      summary: 'A previously refused scope expansion.',
      relation: 'outside-visible',
      offerEntryId: 'prd-case-11',
      originalSource: { id: 'prd-audit:NC.11', snapshot: 'Original refusal evidence.' },
      originalCaseId: 'prd-case-11',
      priorDecision: { id: 'decision-11', revision: 4 },
    }]);

    expect(rendered).toMatch(/^Blocking criteria awaiting a decision: NC\.10\.[\s\S]*Refused — rework required: NC\.11\.[\s\S]*"kind": "revise-decision"/);
    // A fresh offer is deliberately an undecided editable entry.  Only a
    // prior refusal receives the revision discriminator, so a renderer
    // cannot accidentally present a normal offer as already decided.
    expect(rendered).not.toContain('"kind": "pending"');
    expect(rendered).not.toContain('"decision": "accept"');
  });
});
