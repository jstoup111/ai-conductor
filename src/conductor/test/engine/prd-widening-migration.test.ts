import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ACCEPTED_WIDENINGS_PATH, AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
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
