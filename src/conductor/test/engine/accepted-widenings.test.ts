// Covers: task:4
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ACCEPTED_WIDENINGS_PATH,
  AcceptedWideningDecisionStore,
} from '../../src/engine/accepted-widenings.js';
import type {
  AcceptedWideningDecisionStoreFilesystem,
  AcceptedWideningFeatureIdentity,
} from '../../src/engine/accepted-widenings.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';

const FEATURE: AcceptedWideningFeatureIdentity = {
  version: 1,
  repository: 'acme/conductor',
  feature: 'widening-authority',
};
const DECISION_INPUT = {
  criterion: 'NC.1',
  authority: 'accept' as const,
  rationale: 'The operator explicitly approved this visible expansion.',
  operator: 'operator@example.test',
  originalSource: {
    id: 'prd-source-1',
    snapshot: 'The reviewer found a visible behavior outside the accepted PRD.',
  },
  originalCaseId: 'prd-case-1',
};

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'accepted-widenings-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('accepted widening decision store', () => {
  it('distinguishes absent, malformed, unsupported, and foreign-feature state from valid authority', async () => {
    const projectRoot = await createProjectRoot();
    const path = join(projectRoot, ACCEPTED_WIDENINGS_PATH);
    const store = new AcceptedWideningDecisionStore(projectRoot, FEATURE);

    await expect(store.read()).resolves.toEqual({ kind: 'absent' });

    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(path, '{ not json', 'utf8');
    await expect(store.read()).resolves.toEqual({ kind: 'malformed' });

    await writeFile(path, JSON.stringify({ version: 3, feature: FEATURE, decisions: [] }), 'utf8');
    await expect(store.read()).resolves.toEqual({ kind: 'unsupported', version: 3 });

    await writeFile(path, JSON.stringify({ version: 2, feature: { ...FEATURE, feature: 'other-feature' }, decisions: [] }), 'utf8');
    await expect(store.read()).resolves.toEqual({ kind: 'foreign-feature' });

    await writeFile(path, JSON.stringify({ version: 2, feature: FEATURE, decisions: [] }), 'utf8');

    const writer = new AcceptedWideningDecisionStore(projectRoot, FEATURE, {
      newDecisionId: () => 'decision-1',
    });
    await expect(writer.append(DECISION_INPUT)).resolves.toEqual({
      ok: true,
      decision: {
        id: 'decision-1',
        criterion: 'NC.1',
        authority: 'accept',
        rationale: DECISION_INPUT.rationale,
        operator: DECISION_INPUT.operator,
        originalSource: DECISION_INPUT.originalSource,
        originalCaseId: 'prd-case-1',
        revision: 1,
      },
    });
    await expect(store.read()).resolves.toEqual({
      kind: 'valid',
      state: {
        version: 2,
        feature: FEATURE,
        decisions: [{
          id: 'decision-1',
          criterion: 'NC.1',
          authority: 'accept',
          rationale: DECISION_INPUT.rationale,
          operator: DECISION_INPUT.operator,
          originalSource: DECISION_INPUT.originalSource,
          originalCaseId: 'prd-case-1',
          revision: 1,
        }],
      },
    });
  });

  it('stamps decision identity and ordering, while retaining criterion-keyed authority', async () => {
    const projectRoot = await createProjectRoot();
    const identifiers = ['decision-1', 'decision-2'];
    const store = new AcceptedWideningDecisionStore(projectRoot, FEATURE, {
      newDecisionId: () => identifiers.shift()!,
    });

    await store.append(DECISION_INPUT);
    await expect(store.append({
      criterion: 'S3.1',
      authority: 'refuse',
      rationale: 'This criterion still requires PRD approval.',
      operator: 'operator@example.test',
    })).resolves.toEqual({
      ok: true,
      decision: {
        id: 'decision-2',
        criterion: 'S3.1',
        authority: 'refuse',
        rationale: 'This criterion still requires PRD approval.',
        operator: 'operator@example.test',
        revision: 2,
      },
    });

    const state = await store.read();
    expect(state).toMatchObject({ kind: 'valid', state: { decisions: [
      { id: 'decision-1', revision: 1, originalCaseId: 'prd-case-1' },
      { id: 'decision-2', revision: 2, criterion: 'S3.1' },
    ] } });
  });

  it.each([
    ['missing operator identity', { ...DECISION_INPUT, operator: '  ' }],
    ['missing rationale', { ...DECISION_INPUT, rationale: '' }],
    ['a malformed authority word', { ...DECISION_INPUT, authority: 'approve' }],
    ['an incomplete original source reference', { ...DECISION_INPUT, originalSource: { id: 'prd-source-1', snapshot: '' } }],
  ])('refuses %s before writing authority', async (_description, input) => {
    const projectRoot = await createProjectRoot();
    const store = new AcceptedWideningDecisionStore(projectRoot, FEATURE);

    await expect(store.append(input)).resolves.toEqual({ ok: false, reason: 'invalid-decision' });
    await expect(store.read()).resolves.toEqual({ kind: 'absent' });
  });

  it('does not replace the last valid record when its atomic write fails', async () => {
    const projectRoot = await createProjectRoot();
    const path = join(projectRoot, ACCEPTED_WIDENINGS_PATH);
    const original = JSON.stringify({ version: 2, feature: FEATURE, decisions: [] });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(path, original, 'utf8');
    const filesystem: AcceptedWideningDecisionStoreFilesystem = {
      readFile: (file) => readFile(file, 'utf8'),
      mkdir: async (directory) => { await mkdir(directory, { recursive: true }); },
      writeFile: async (file, contents) => { await writeFile(file, contents, 'utf8'); },
      rename: async () => { throw new Error('rename failed'); },
      rm: async (file) => { await rm(file, { force: true }); },
    };
    const store = new AcceptedWideningDecisionStore(projectRoot, FEATURE, {
      filesystem,
      newDecisionId: () => 'decision-1',
    });

    await expect(store.append(DECISION_INPUT)).resolves.toEqual({ ok: false, reason: 'atomic-replace-failed' });
    await expect(readFile(path, 'utf8')).resolves.toBe(original);
  });

  it('returns a decision-store lease failure without reading it as absent', async () => {
    const projectRoot = await createProjectRoot();
    const lock: ConductStateLease = {
      acquire: async () => ({ ok: false, kind: 'timeout', message: 'decision state is busy' }),
    };

    await expect(new AcceptedWideningDecisionStore(projectRoot, FEATURE, { lock }).read())
      .resolves.toEqual({ kind: 'lease-failed', reason: 'lock-timeout' });
  });
});
