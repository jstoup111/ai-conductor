// Covers: task:2, task:4
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
  suppressions: [],
};

const REFUTATION = {
  claim: 'The alleged missing coverage is present in the focused regression test.',
  assertions: [{
    assertion: 'The regression test exercises the changed production path.',
    verdict: 'refuted' as const,
    evidence: [{ path: 'test/regression.test.ts', excerpt: 'exercises the changed production path' }],
  }],
};

const REFUTED_CASE_STATE: RemediationCaseStoreState = {
  ...CASE_STATE,
  cases: [{
    ...CASE_STATE.cases[0],
    disposition: 'refute',
    rationale: 'The asserted gap is contradicted by the existing regression test.',
    resolution: 'resolved',
    sources: [{ ...CASE_STATE.cases[0].sources[0], outcome: 'refuted' }],
    effect: { kind: 'none' },
    refutation: REFUTATION,
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
      state: { version: 'v1', feature: FEATURE, cases: [], suppressions: [] },
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
    ['a no-effect refutation', REFUTED_CASE_STATE],
    ['a refutation with a durable deferral', {
      ...REFUTED_CASE_STATE,
      cases: [{
        ...REFUTED_CASE_STATE.cases[0],
        effect: { id: 'effect-refuted', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' },
      }],
    }],
  ] as const)('round-trips %s with its refutation intact', async (_description, state) => {
    const projectRoot = await createProjectRoot();
    const writer = new RemediationCaseStore(projectRoot, FEATURE);

    await expect(writer.mutate(async () => ({ value: 'seeded' as const, nextState: state })))
      .resolves.toEqual({ ok: true, value: 'seeded' });
    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({ ok: true, state });
  });

  it('preserves one suppression per finding and accepts v1 state with no suppression list', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: undefined, nextState: {
      ...state,
      suppressions: [{ findingId: 'finding-1', rubric: 'testQuality', summary: 'Low confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-first' }],
    } }));
    await store.mutate(async (state) => ({ value: undefined, nextState: {
      ...state,
      suppressions: [{ findingId: 'finding-1', rubric: 'testQuality', summary: 'Refreshed finding.', confidence: 45, floor: 70, lastSeenLap: 'lap-second' }],
    } }));
    const read = await store.read();
    expect(read).toMatchObject({ ok: true, state: { suppressions: [{ findingId: 'finding-1', lastSeenLap: 'lap-second' }] } });
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
    ['a refute record without its refutation', {
      ...REFUTED_CASE_STATE,
      cases: [{ ...REFUTED_CASE_STATE.cases[0], refutation: undefined }],
    }, 'malformed-state'],
    ['a non-refute record carrying a refutation', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], refutation: REFUTATION }],
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
    ['two suppression entries sharing one finding id', {
      ...CASE_STATE,
      suppressions: [
        { findingId: 'finding-1', rubric: 'testQuality', summary: 'First copy.', confidence: 40, floor: 70, lastSeenLap: 'lap-first' },
        { findingId: 'finding-1', rubric: 'testQuality', summary: 'Second copy.', confidence: 45, floor: 70, lastSeenLap: 'lap-second' },
      ],
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
      state: { version: 'v1', feature: FEATURE, cases: [], suppressions: [] },
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
