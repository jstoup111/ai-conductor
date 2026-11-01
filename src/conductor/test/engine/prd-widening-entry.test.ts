// Covers: task:4
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { ACCEPTED_WIDENINGS_PATH, AcceptedWideningDecisionStore, type AcceptedWideningDecisionInput } from '../../src/engine/accepted-widenings.js';
import { preparePrdWideningEntry } from '../../src/engine/prd-widening-entry.js';

describe('preparePrdWideningEntry', () => {
  it('returns capture defects rather than hiding them before routing', async () => {
    const result = await preparePrdWideningEntry({
      projectRoot: '/not-read', feature: { version: 1, repository: 'acme/repo', feature: 'feature' }, priorHalt: '```json over-scope-decisions\nnot-json\n```',
      capture: { operator: undefined, offerStore: { mutate: vi.fn() }, decisionStore: { append: vi.fn() } },
    });
    expect(result.capture).toMatchObject({ kind: 'captured', defects: [{ kind: 'malformed-block' }] });
  });

  it('offers only outside-visible story criteria from the persisted typed verdict', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    try {
      await persistPrdAuditVerdict(projectRoot, {
        complete: true,
        judgment: {
          version: 'v1',
          criterionJudgments: [
            {
              criterion: { storyId: '3', ordinal: 17 }, criterionId: 'S3.17', grade: 'OVER_SCOPE',
              evidence: 'src/visible.ts:1', rationale: 'Visible scope expansion.', requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
            },
            {
              criterion: { storyId: '5', ordinal: 1 }, criterionId: 'S5.1', grade: 'OVER_SCOPE',
              evidence: 'src/harmless.ts:1', rationale: 'Harmless scope expansion.', requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-harmless',
            },
          ],
          noOwnerObservations: [{ presentationOrdinal: 'NC-2', grade: 'OVER_SCOPE', evidence: 'src/no-owner.ts:1', rationale: 'No owner.', intentRelation: 'outside-visible' }],
        }, diagnostics: [], recordedDispositions: [],
      }, { attemptId: 'attempt', codeStamp: 'head' });
      const append = vi.fn(async (input: AcceptedWideningDecisionInput) => ({
        ok: true as const,
        decision: { id: input.criterion, revision: 1, ...input },
      }));
      const result = await preparePrdWideningEntry({
        projectRoot, feature: { version: 1, repository: 'acme/repo', feature: 'feature' },
        priorHalt: '```json over-scope-decisions\n' + JSON.stringify([
          { criterion: 'S3.17', summary: 'Visible expansion.', decision: 'refuse', rationale: 'Refused.' },
          { criterion: 'S5.1', summary: 'Harmless expansion.', decision: 'accept', rationale: 'Accepted.' },
        ]) + '\n```',
        capture: {
          operator: 'operator@example.test',
          offerStore: { mutate: async (operation) => ({ ok: true, value: (await operation({ version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' }, cases: [], suppressions: [], prdWideningCases: [] })).value }) },
          decisionStore: { append },
        },
      });
      expect({ capture: result.capture, append }).toMatchObject({
        capture: {
          captured: [{ criterion: 'S3.17', authority: 'refuse' }],
          defects: [{ kind: 'unknown-criterion', criterion: 'S5.1' }],
        },
      });
      expect(append).toHaveBeenCalledTimes(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each(['missing', 'non-json'] as const)('reports an unavailable offered set when the typed verdict is %s', async (kind) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    try {
      if (kind === 'non-json') {
        await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
        await writeFile(join(projectRoot, '.pipeline/prd-audit.json'), 'not json');
      }
      const result = await preparePrdWideningEntry({
        projectRoot, feature: { version: 1, repository: 'acme/repo', feature: 'feature' },
        priorHalt: '```json over-scope-decisions\n[{"criterion":"S3.17","summary":"Visible expansion.","decision":"refuse","rationale":"Refused."}]\n```',
        capture: {
          operator: 'operator@example.test',
          offerStore: { mutate: vi.fn() }, decisionStore: { append: vi.fn() },
        },
      });
      expect(result.capture).toEqual({
        kind: 'captured', captured: [], defects: [{ kind: 'offered-set-unavailable', criterion: 'S3.17' }],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not import an unoffered clear through v1 migration while retaining an offered sibling', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    try {
      await persistPrdAuditVerdict(projectRoot, {
        complete: true,
        judgment: {
          version: 'v1',
          criterionJudgments: [{
            criterion: { storyId: '3', ordinal: 17 }, criterionId: 'S3.17', grade: 'OVER_SCOPE',
            evidence: 'src/visible.ts:1', rationale: 'Visible scope expansion.', requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
          }],
          noOwnerObservations: [],
        }, diagnostics: [], recordedDispositions: [],
      }, { attemptId: 'attempt', codeStamp: 'head' });
      await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 1, decisions: [{
        criterion: 'NC.1', summary: 'Existing v1 history.', decision: 'accept', rationale: 'Previously accepted.',
        operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
      }] }));
      const store = new AcceptedWideningDecisionStore(projectRoot, { version: 1, repository: 'acme/repo', feature: 'feature' });
      const result = await preparePrdWideningEntry({
        projectRoot, feature: { version: 1, repository: 'acme/repo', feature: 'feature' },
        priorHalt: '```json over-scope-decisions\n' + JSON.stringify([
          { criterion: 'S3.17', summary: 'Visible expansion.', decision: 'refuse', rationale: 'Refused.' },
          { criterion: 'S9.9', summary: 'Never offered.', decision: 'accept', rationale: 'Must not import.' },
        ]) + '\n```',
        capture: {
          operator: 'operator@example.test',
          offerStore: { mutate: async (operation) => ({ ok: true, value: (await operation({ version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' }, cases: [], suppressions: [], prdWideningCases: [] })).value }) },
          decisionStore: store,
        },
      });
      const persisted = await store.read();

      expect({ result, persisted }).toMatchObject({
        result: { capture: { captured: [{ criterion: 'S3.17' }], defects: [{ kind: 'unknown-criterion', criterion: 'S9.9' }] } },
        persisted: { kind: 'valid', state: { decisions: expect.arrayContaining([expect.objectContaining({ criterion: 'S3.17' })]) } },
      });
      expect(persisted.kind === 'valid' && persisted.state.decisions.some((decision) => decision.criterion === 'S9.9')).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each(['v3', 'v4'] as const)('keeps a stripped NC offer clear out of migration for a %s case store', async (version) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    try {
      const feature = { version: 1 as const, repository: 'acme/repo', feature: 'feature' };
      const remediationFeature = { version: 'v1' as const, repository: 'acme/repo', feature: 'feature' };
      const offeredCase = {
        id: 'offer-nc-2', domain: 'prd_widening' as const, offeredCriterion: 'NC.2',
        originalSources: [{ sourceId: 'NC-2', snapshot: 'Offered no-owner expansion.' }], currentSources: [], relationships: [],
      };
      const state = version === 'v3'
        ? { version, feature: remediationFeature, cases: [], prdWideningCases: [offeredCase], suppressions: [], outbox: [] }
        : { version, feature: remediationFeature, cases: [], prdWideningCases: [offeredCase], asBuiltCases: [], suppressions: [], outbox: [] };
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 1, decisions: [{
        criterion: 'S1.1', summary: 'Prior v1 decision.', decision: 'accept', rationale: 'Previously accepted.',
        operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
      }] }));
      const decisionStore = new AcceptedWideningDecisionStore(projectRoot, feature);

      const result = await preparePrdWideningEntry({
        projectRoot, feature,
        priorHalt: '```json over-scope-decisions\n' + JSON.stringify([
          { criterion: 'NC.2', summary: 'Offered no-owner expansion.', decision: 'accept', rationale: 'Attempted stripped offer.' },
        ]) + '\n```',
        capture: {
          operator: 'operator@example.test', decisionStore,
          offerStore: { mutate: async (operation) => {
            const result = await operation(state);
            return { ok: true as const, value: result.value };
          } },
        },
      });
      const persisted = await decisionStore.read();

      expect(result).toMatchObject({
        capture: { captured: [], defects: [{ kind: 'changed-offer-reference', criterion: 'NC.2' }] },
      });
      expect(persisted).toMatchObject({
        kind: 'valid', state: { decisions: [expect.objectContaining({ criterion: 'S1.1' })] },
      });
      expect(persisted.kind === 'valid' && persisted.state.decisions.some((decision) => decision.criterion === 'NC.2')).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not let migration import a stripped NC clear that capture rejects', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    try {
      const feature = { version: 1 as const, repository: 'acme/repo', feature: 'feature' };
      const remediationFeature = { version: 'v1' as const, repository: 'acme/repo', feature: 'feature' };
      await persistPrdAuditVerdict(projectRoot, {
        complete: true,
        judgment: {
          version: 'v1', criterionJudgments: [],
          noOwnerObservations: [
            { presentationOrdinal: 'NC-2', grade: 'OVER_SCOPE', evidence: 'src/nc-2.ts:1', rationale: 'Offered.', intentRelation: 'outside-visible' },
            { presentationOrdinal: 'NC-3', grade: 'OVER_SCOPE', evidence: 'src/nc-3.ts:1', rationale: 'Unpersisted.', intentRelation: 'outside-visible' },
          ],
        }, diagnostics: [], recordedDispositions: [],
      }, { attemptId: 'attempt', codeStamp: 'head' });
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 1, decisions: [{
        criterion: 'S1.1', summary: 'Prior v1 decision.', decision: 'accept', rationale: 'Previously accepted.',
        operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
      }] }));
      const decisionStore = new AcceptedWideningDecisionStore(projectRoot, feature);
      const state = {
        version: 'v3' as const, feature: remediationFeature, cases: [], suppressions: [], outbox: [],
        prdWideningCases: [{
          id: 'offer-nc-2', domain: 'prd_widening' as const, offeredCriterion: 'NC.2',
          originalSources: [{ sourceId: 'NC-2', snapshot: 'Offered no-owner expansion.' }], currentSources: [], relationships: [],
        }],
      };

      const result = await preparePrdWideningEntry({
        projectRoot, feature,
        priorHalt: '```json over-scope-decisions\n' + JSON.stringify([
          { criterion: 'NC.2', summary: 'Offered no-owner expansion.', decision: 'accept', rationale: 'Stripped offered reference.' },
          { criterion: 'NC.3', summary: 'Unpersisted no-owner expansion.', decision: 'refuse', rationale: 'No persisted offer.' },
        ]) + '\n```',
        capture: {
          operator: 'operator@example.test', decisionStore,
          offerStore: { mutate: async (operation) => ({ ok: true as const, value: (await operation(state)).value }) },
        },
      });
      const persisted = await decisionStore.read();

      expect(result.capture).toEqual({
        kind: 'captured', captured: [], defects: [
          { kind: 'changed-offer-reference', criterion: 'NC.2' },
          { kind: 'changed-offer-reference', criterion: 'NC.3' },
        ],
      });
      expect(persisted).toMatchObject({
        kind: 'valid', state: { decisions: [expect.objectContaining({ criterion: 'S1.1' })] },
      });
      expect(persisted.kind === 'valid' && persisted.state.decisions).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
