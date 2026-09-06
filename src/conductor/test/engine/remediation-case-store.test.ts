// Covers: task:2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type {
  RemediationCaseStoreFilesystem,
  RemediationCaseStoreState,
} from '../../src/engine/remediation-case-store.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'case-store' } as const;
const CASE_STATE: RemediationCaseStoreState = {
  version: 'v1',
  feature: FEATURE,
  cases: [{
    id: 'case-1',
    domain: 'build_review',
    disposition: 'act',
    priority: 'high',
    rationale: 'The changed production path has no behavioral coverage.',
    confidence: 'high',
    resolution: 'open',
    sources: [{
      sourceId: 'testQuality:finding-1',
      outcome: 'acted',
      recordedAt: '2026-08-30T12:00:00.000Z',
    }],
    effect: {
      id: 'effect-1',
      kind: 'action',
      status: 'reserved',
    },
  }],
};

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'remediation-case-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation case store', () => {
  it('returns an empty versioned state before any case has been persisted', async () => {
    const projectRoot = await createProjectRoot();

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: { version: 'v1', feature: FEATURE, cases: [] },
    });
  });

  it('round-trips one exact feature-local versioned case state to a later process', async () => {
    const projectRoot = await createProjectRoot();
    const writer = new RemediationCaseStore(projectRoot, FEATURE);

    await expect(writer.mutate(async () => ({ value: 'seeded' as const, nextState: CASE_STATE })))
      .resolves.toEqual({ ok: true, value: 'seeded' });

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: CASE_STATE,
    });
  });

  it.each([
    ['a foreign feature', { ...CASE_STATE, feature: { ...FEATURE, feature: 'other-feature' } }, 'foreign-feature'],
    ['a foreign case domain', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], domain: 'prd_audit' }],
    }, 'foreign-domain'],
    ['an unsupported state version', { ...CASE_STATE, version: 'v2' }, 'unknown-version'],
    ['a mismatched action effect', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' } }],
    }, 'malformed-state'],
    ['an applied action without a durable work-order reference', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], effect: { id: 'effect-1', kind: 'action', status: 'applied' } }],
    }, 'malformed-state'],
    ['a failed deferral without diagnostic evidence', {
      ...CASE_STATE,
      cases: [{
        ...CASE_STATE.cases[0],
        disposition: 'defer',
        effect: { id: 'effect-1', kind: 'deferral', status: 'failed' },
      }],
    }, 'malformed-state'],
    ['a duplicate case id', {
      ...CASE_STATE,
      cases: [CASE_STATE.cases[0], { ...CASE_STATE.cases[0], effect: { ...CASE_STATE.cases[0].effect, id: 'effect-2' } }],
    }, 'malformed-state'],
    ['a duplicate durable effect id across cases', {
      ...CASE_STATE,
      cases: [CASE_STATE.cases[0], { ...CASE_STATE.cases[0], id: 'case-2' }],
    }, 'malformed-state'],
    ['a source id shared across two canonical cases', {
      ...CASE_STATE,
      cases: [
        CASE_STATE.cases[0],
        { ...CASE_STATE.cases[0], id: 'case-2', effect: { ...CASE_STATE.cases[0].effect, id: 'effect-2' } },
      ],
    }, 'malformed-state'],
    ['a duplicate source id within one case', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], sources: [CASE_STATE.cases[0].sources[0], CASE_STATE.cases[0].sources[0]] }],
    }, 'malformed-state'],
  ])('fails closed for %s', async (_description, state, reason) => {
    const projectRoot = await createProjectRoot();
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline/remediation-cases.json'), JSON.stringify(state), 'utf8');

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({ ok: false, reason });
  });

  it('returns the lease failure without treating state as empty', async () => {
    const projectRoot = await createProjectRoot();
    const lock: ConductStateLease = {
      acquire: async () => ({ ok: false, kind: 'timeout', message: 'case state is busy' }),
    };

    await expect(new RemediationCaseStore(projectRoot, FEATURE, { lock }).read()).resolves.toEqual({
      ok: false,
      reason: 'lock-timeout',
    });
  });

  it('keeps the last complete JSON readable when atomic replacement fails', async () => {
    const projectRoot = await createProjectRoot();
    const original = JSON.stringify({ version: 'v1', feature: FEATURE, cases: [] });
    const statePath = join(projectRoot, '.pipeline/remediation-cases.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(statePath, original, 'utf8');
    const filesystem: RemediationCaseStoreFilesystem = {
      readFile: (path) => readFile(path, 'utf8'),
      mkdir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      writeFile: async (path, contents) => {
        await writeFile(path, contents, 'utf8');
      },
      rename: async () => {
        throw new Error('rename failed');
      },
      rm: async (path) => {
        await rm(path, { force: true });
      },
    };

    await expect(
      new RemediationCaseStore(projectRoot, FEATURE, { filesystem })
        .mutate(async () => ({ value: null, nextState: CASE_STATE })),
    ).resolves.toEqual({ ok: false, reason: 'atomic-replace-failed' });
    await expect(readFile(statePath, 'utf8')).resolves.toBe(original);
    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: { version: 'v1', feature: FEATURE, cases: [] },
    });
  });

  it('never writes the separate operator disposition store', async () => {
    const projectRoot = await createProjectRoot();
    const dispositionPath = join(projectRoot, '.pipeline/build-review-dispositions.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(dispositionPath, '{"operator":"only"}\n', 'utf8');

    await expect(
      new RemediationCaseStore(projectRoot, FEATURE)
        .mutate(async () => ({ value: null, nextState: CASE_STATE })),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(readFile(dispositionPath, 'utf8')).resolves.toBe('{"operator":"only"}\n');
  });
});
