import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Covers: task:9

import { ACCEPTED_WIDENINGS_PATH, AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import { parseLegacyPrdWideningClear, capturePrdWideningDecisions, type PrdWideningCaptureDecisionStore, type PrdWideningCaptureOfferStore } from '../../src/engine/prd-widening-capture.js';
import { migrateLegacyPrdWideningDecisions } from '../../src/engine/prd-widening-migration.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';

const FEATURE = { version: 1 as const, repository: 'acme/conductor', feature: 'reviewer-wording' };
const CASE_FEATURE = { version: 'v1' as const, repository: FEATURE.repository, feature: FEATURE.feature };
const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'prd-widening-migration-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeLegacy(projectRoot: string, decisions: readonly unknown[]): Promise<void> {
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 1, decisions }), 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('legacy PRD widening decision migration', () => {
  it('reports a retired single-line clear as unsupported without altering its evidence', async () => {
    const projectRoot = await createProjectRoot();
    const raw = 'OVER_SCOPE_ACCEPT: NC.1 approved by operator';
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const path = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(path, raw);
    expect(parseLegacyPrdWideningClear(raw)).toEqual({ kind: 'unsupported' });
    const decisions = new AcceptedWideningDecisionStore(projectRoot, FEATURE);
    await expect(capturePrdWideningDecisions(raw, {
      operator: 'operator', offerStore: new RemediationCaseStore(projectRoot, CASE_FEATURE), decisionStore: decisions,
    })).resolves.toMatchObject({ captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] });
    expect(await readFile(path, 'utf8')).toBe(raw);
    expect(await decisions.read()).toMatchObject({ kind: 'absent' });
  });

  it('captures a pre-offer fenced clear as legacy-provenance history without a modern offer binding', async () => {
    const projectRoot = await createProjectRoot();
    const legacyClear = [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: 'NC.9',
        summary: 'The original reviewer wording is the durable evidence.',
        decision: 'refuse',
        rationale: 'The operator kept this behavior out of scope.',
      }]),
      '```',
    ].join('\n');

    const first = await capturePrdWideningDecisions(legacyClear, {
      operator: 'operator@example.test',
      offerStore: new RemediationCaseStore(projectRoot, CASE_FEATURE),
      decisionStore: new AcceptedWideningDecisionStore(projectRoot, FEATURE),
    });
    const replay = await capturePrdWideningDecisions(legacyClear, {
      operator: 'operator@example.test',
      offerStore: new RemediationCaseStore(projectRoot, CASE_FEATURE),
      decisionStore: new AcceptedWideningDecisionStore(projectRoot, FEATURE),
    });

    expect(first).toMatchObject({ kind: 'captured', defects: [] });
    expect(replay).toMatchObject({ kind: 'captured', defects: [] });

    expect(await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read()).toMatchObject({
      kind: 'valid',
      state: { decisions: [expect.objectContaining({
        criterion: 'NC.9',
        authority: 'refuse',
        rationale: 'The operator kept this behavior out of scope.',
        operator: 'operator@example.test',
        originalSource: expect.objectContaining({ snapshot: 'The original reviewer wording is the durable evidence.' }),
        originalCaseId: expect.stringMatching(/^legacy-clear-case-/),
      })] },
    });
    expect(await new RemediationCaseStore(projectRoot, CASE_FEATURE).read()).toMatchObject({
      ok: true,
      state: { prdWideningCases: [expect.objectContaining({
        id: expect.stringMatching(/^legacy-clear-case-/),
        originalSources: [expect.objectContaining({ sourceId: expect.stringMatching(/^legacy-clear-source-/) })],
      })] },
    });
  });

  it('makes matching migrated and fenced legacy authority one inert history', async () => {
    const projectRoot = await createProjectRoot();
    const row = {
      criterion: 'NC.9', summary: 'The original reviewer wording is the durable evidence.', decision: 'refuse',
      rationale: 'The operator kept this behavior out of scope.', operator: 'operator@example.test', decidedAt: '2026-09-09T00:00:00.000Z',
    };
    await writeLegacy(projectRoot, [row]);
    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({ kind: 'migrated' });
    const cleared = [
      '```json over-scope-decisions',
      JSON.stringify([{ criterion: row.criterion, summary: row.summary, decision: row.decision, rationale: row.rationale }]),
      '```',
    ].join('\n');
    await expect(capturePrdWideningDecisions(cleared, {
      operator: row.operator,
      offerStore: new RemediationCaseStore(projectRoot, CASE_FEATURE),
      decisionStore: new AcceptedWideningDecisionStore(projectRoot, FEATURE),
    })).resolves.toMatchObject({ kind: 'captured', defects: [] });
    expect(await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read()).toMatchObject({
      kind: 'valid', state: { decisions: [expect.objectContaining({ criterion: row.criterion })] },
    });
  });

  it('names corrupt, unsupported, foreign-feature, and unknown-version history without replacing its raw evidence', async () => {
    const corruptRoot = await createProjectRoot();
    const unknownVersionRoot = await createProjectRoot();
    const foreignFeatureRoot = await createProjectRoot();
    const corrupt = '{"version":2,"decisions":[]}';
    await mkdir(join(corruptRoot, '.pipeline'), { recursive: true });
    await writeFile(join(corruptRoot, ACCEPTED_WIDENINGS_PATH), corrupt, 'utf8');
    await writeLegacy(unknownVersionRoot, []);
    await writeFile(join(unknownVersionRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 3, decisions: [] }), 'utf8');
    await mkdir(join(foreignFeatureRoot, '.pipeline'), { recursive: true });
    await writeFile(join(foreignFeatureRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({
      version: 2,
      feature: { ...FEATURE, feature: 'other-feature' },
      decisions: [],
    }), 'utf8');
    const unsupportedStore = {
      read: async () => ({ kind: 'absent' as const }),
      migrateLegacy: async () => ({ ok: false as const, reason: 'legacy-changed' as const }),
    };

    const outcomes = await Promise.all([
      migrateLegacyPrdWideningDecisions(corruptRoot, FEATURE),
      migrateLegacyPrdWideningDecisions(unknownVersionRoot, FEATURE),
      migrateLegacyPrdWideningDecisions(foreignFeatureRoot, FEATURE),
      migrateLegacyPrdWideningDecisions(unknownVersionRoot, FEATURE, { decisionStore: unsupportedStore }),
    ]);

    expect(outcomes).toEqual([
      expect.objectContaining({ kind: 'failed', reason: 'corrupt-history' }),
      expect.objectContaining({ kind: 'failed', reason: 'unknown-history-version' }),
      expect.objectContaining({ kind: 'failed', reason: 'foreign-feature-history' }),
      expect.objectContaining({ kind: 'failed', reason: 'unsupported-history' }),
    ]);
    expect(await readFile(join(corruptRoot, ACCEPTED_WIDENINGS_PATH), 'utf8')).toBe(corrupt);
  });

  it('reports retired entries and single-line fenced clears as unsupported instead of treating them as absent', async () => {
    const decisionStore: PrdWideningCaptureDecisionStore = {
      append: async () => ({ ok: false, reason: 'invalid-decision' }),
    };
    const offerStore: PrdWideningCaptureOfferStore = {
      mutate: async (operation) => ({
        ok: true,
        value: (await operation({
          version: 'v2', feature: CASE_FEATURE, cases: [], suppressions: [], prdWideningCases: [],
        })).value,
      }),
    };

    const results = await Promise.all([
      capturePrdWideningDecisions('```json over-scope-decisions\n{"entries":[]}\n```', {
        operator: 'operator@example.test', offerStore, decisionStore,
      }),
      capturePrdWideningDecisions('```over-scope-decisions\nNC.9: accept\n```', {
        operator: 'operator@example.test', offerStore, decisionStore,
      }),
    ]);

    expect(results).toEqual([
      { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] },
      { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] },
    ]);
  });

  it('migrates supported criterion and NC decisions without consulting a replacement current finding', async () => {
    const projectRoot = await createProjectRoot();
    await writeLegacy(projectRoot, [
      {
        criterion: 'S3.1', summary: 'The endpoint needs a documented response shape.', decision: 'accept',
        rationale: 'The operator chose to include it.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        criterion: 'NC.4', summary: 'A reviewer found a visible workflow outside the original PRD.', decision: 'refuse',
        rationale: 'This remains outside the approved scope.', operator: 'operator@example.test', decidedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({
      kind: 'migrated',
      decisions: [
        { criterion: 'S3.1', authority: 'accept', rationale: 'The operator chose to include it.', operator: 'operator@example.test', revision: 1 },
        { criterion: 'NC.4', authority: 'refuse', rationale: 'This remains outside the approved scope.', operator: 'operator@example.test', revision: 2 },
      ],
    });

    const decisionState = await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read();
    expect(decisionState).toMatchObject({ kind: 'valid', state: { decisions: [
      { criterion: 'S3.1', originalSource: { snapshot: 'The endpoint needs a documented response shape.' }, revision: 1 },
      { criterion: 'NC.4', originalSource: { snapshot: 'A reviewer found a visible workflow outside the original PRD.' }, revision: 2 },
    ] } });
    const caseState = await new RemediationCaseStore(projectRoot, CASE_FEATURE).read();
    expect(caseState).toMatchObject({ ok: true, state: { version: 'v2', prdWideningCases: [
      { originalSources: [{ snapshot: 'The endpoint needs a documented response shape.' }] },
      { originalSources: [{ snapshot: 'A reviewer found a visible workflow outside the original PRD.' }] },
    ] } });
  });

  it('preserves a legacy reversal but makes an exact duplicate row inert', async () => {
    const projectRoot = await createProjectRoot();
    const accepted = {
      criterion: 'NC.1', summary: 'The export screen is a separate user-visible workflow.', decision: 'accept',
      rationale: 'Initially approved.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
    };
    await writeLegacy(projectRoot, [
      accepted,
      { ...accepted, decision: 'refuse', rationale: 'The operator reversed the prior acceptance.', decidedAt: '2026-09-02T00:00:00.000Z' },
      accepted,
    ]);

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({
      kind: 'migrated',
      decisions: [
        { authority: 'accept', revision: 1 },
        { authority: 'refuse', revision: 2, supersedes: { revision: 1 } },
      ],
    });

    const state = await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read();
    expect(state).toMatchObject({ kind: 'valid', state: { decisions: [
      { authority: 'accept', revision: 1 },
      { authority: 'refuse', revision: 2, supersedes: { revision: 1 } },
    ] } });
    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({
      kind: 'already-migrated',
    });
    const replayed = await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read();
    expect(replayed).toMatchObject({ kind: 'valid', state: { decisions: [
      { authority: 'accept', revision: 1 },
      { authority: 'refuse', revision: 2, supersedes: { revision: 1 } },
    ] } });
  });

  it('retains distinct legacy evidence and attribution for criterion revisions', async () => {
    const projectRoot = await createProjectRoot();
    await writeLegacy(projectRoot, [
      {
        criterion: 'S3.1', summary: 'The first authored criterion summary.', decision: 'accept',
        rationale: 'Initially accepted.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        criterion: 'S3.1', summary: 'The later authored criterion summary.', decision: 'refuse',
        rationale: 'Later refused.', operator: 'operator@example.test', decidedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({
      kind: 'migrated',
      decisions: [
        { legacyRow: { summary: 'The first authored criterion summary.', decidedAt: '2026-09-01T00:00:00.000Z' } },
        { legacyRow: { summary: 'The later authored criterion summary.', decidedAt: '2026-09-02T00:00:00.000Z' }, supersedes: { revision: 1 } },
      ],
    });

    await expect(new AcceptedWideningDecisionStore(projectRoot, FEATURE).read()).resolves.toMatchObject({
      kind: 'valid',
      state: { decisions: [
        { legacyRow: { summary: 'The first authored criterion summary.', decidedAt: '2026-09-01T00:00:00.000Z' } },
        { legacyRow: { summary: 'The later authored criterion summary.', decidedAt: '2026-09-02T00:00:00.000Z' }, supersedes: { revision: 1 } },
      ] },
    });
  });

  it('retains legacy-clear authored evidence apart from its criterion case snapshot', async () => {
    const projectRoot = await createProjectRoot();
    await writeLegacy(projectRoot, [{
      criterion: 'S3.1', summary: 'The first criterion case snapshot.', decision: 'accept',
      rationale: 'Initially accepted.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
    }]);

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE, {
      legacyClear: {
        operator: 'operator@example.test',
        entries: [{
          criterion: 'S3.1', summary: 'The later fenced-clear authored summary.', authority: 'refuse',
          rationale: 'The later clear reverses the prior authority.',
        }],
      },
    })).resolves.toMatchObject({
      kind: 'migrated',
      decisions: [
        { legacyRow: { summary: 'The first criterion case snapshot.', decidedAt: '2026-09-01T00:00:00.000Z' } },
        { legacyRow: { summary: 'The later fenced-clear authored summary.' }, supersedes: { revision: 1 } },
      ],
    });
  });

  it('retains non-identical same-authority rows with their attribution in append order', async () => {
    const projectRoot = await createProjectRoot();
    const accepted = {
      criterion: 'NC.1', summary: 'The export screen is a separate user-visible workflow.', decision: 'accept' as const,
      rationale: 'Initially approved.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
    };
    await writeLegacy(projectRoot, [accepted, {
      ...accepted, rationale: 'The same authority was reconfirmed by a second operator.',
      operator: 'second-operator@example.test', decidedAt: '2026-09-02T00:00:00.000Z',
    }]);

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({
      kind: 'migrated', decisions: [
        { authority: 'accept', rationale: accepted.rationale, operator: accepted.operator, revision: 1 },
        { authority: 'accept', rationale: 'The same authority was reconfirmed by a second operator.', operator: 'second-operator@example.test', revision: 2, supersedes: { revision: 1 } },
      ],
    });
  });

  it('retries safely after the decision-state write is interrupted, with snapshots durable before authority', async () => {
    const projectRoot = await createProjectRoot();
    await writeLegacy(projectRoot, [{
      criterion: 'NC.1', summary: 'The original evidence must remain durable across a restart.', decision: 'accept',
      rationale: 'The operator approved the original evidence.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
    }]);
    const decisionStore = new AcceptedWideningDecisionStore(projectRoot, FEATURE, {
      filesystem: {
        readFile: (path) => readFile(path, 'utf8'),
        mkdir: async (path) => mkdir(path, { recursive: true }).then(() => undefined),
        writeFile: async () => { throw new Error('simulated interruption'); },
        rename: async () => undefined,
        rm: async () => undefined,
      },
    });

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE, { decisionStore })).resolves.toMatchObject({
      kind: 'failed', reason: 'decision-write-failed',
    });
    expect(await new RemediationCaseStore(projectRoot, CASE_FEATURE).read()).toMatchObject({
      ok: true,
      state: { prdWideningCases: [{ originalSources: [{ snapshot: 'The original evidence must remain durable across a restart.' }] }] },
    });

    await expect(migrateLegacyPrdWideningDecisions(projectRoot, FEATURE)).resolves.toMatchObject({ kind: 'migrated' });
    const state = await new AcceptedWideningDecisionStore(projectRoot, FEATURE).read();
    expect(state).toMatchObject({ kind: 'valid', state: { decisions: [{ revision: 1 }] } });
  });
});
