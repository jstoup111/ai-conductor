// Covers: task:4
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
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
      const append = vi.fn(async (input: { readonly criterion: string }) => ({
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
});
