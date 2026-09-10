// Covers: task:1, task:2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseRemediationCaseDomainRecord,
  RemediationCaseStore,
  selectBuildReviewRemediationCases,
  selectPrdWideningRemediationCases,
} from '../../src/engine/remediation-case-store.js';
import type {
  RemediationCaseDomainRecord,
  RemediationCaseStoreFilesystem,
  RemediationCaseStoreState,
} from '../../src/engine/remediation-case-store.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'case-store' } as const;
const CASE_STATE: RemediationCaseStoreState = {
  version: 'v2',
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
  prdWideningCases: [],
  suppressions: [],
};

const PRD_WIDENING_CASE = {
  id: 'prd-case-1',
  domain: 'prd_widening',
  originalSources: [{
    sourceId: 'NC-1',
    snapshot: 'Original outside-visible widening finding.',
  }],
  currentSources: [{
    sourceId: 'NC-1',
    snapshot: 'Reworded current widening finding.',
    recordedAt: '2026-09-09T12:00:00.000Z',
  }],
  relationships: [{
    currentSourceId: 'NC-1',
    kind: 'same-case',
    caseId: 'prd-case-1',
    reason: 'The reworded finding concerns the original behavior.',
  }],
} as const;

const temporaryDirectories: string[] = [];

/** Frozen v1 envelope admission boundary: an old writer cannot load v2 to overwrite it. */
function predecessorV1Decoder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.version === 'v1' && Array.isArray(state.cases) &&
    Object.keys(state).every((key) => ['version', 'feature', 'cases', 'suppressions'].includes(key));
}

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
  it('parses separate domain records and selects only their domain without sharing display ordinals', () => {
    const buildReview = parseRemediationCaseDomainRecord({
      ...CASE_STATE.cases[0],
      sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'NC-1' }],
    });
    const prdWidening = parseRemediationCaseDomainRecord(PRD_WIDENING_CASE);

    expect(buildReview).toMatchObject({ ok: true, record: { domain: 'build_review' } });
    expect(prdWidening).toMatchObject({ ok: true, record: { domain: 'prd_widening' } });
    if (!buildReview.ok || !prdWidening.ok) throw new Error('domain records must parse');

    const records: readonly RemediationCaseDomainRecord[] = [buildReview.record, prdWidening.record];
    const buildReviewCases = selectBuildReviewRemediationCases(records);
    const prdWideningCases = selectPrdWideningRemediationCases(records);
    expect(buildReviewCases).toEqual([buildReview.record]);
    expect(prdWideningCases).toEqual([prdWidening.record]);
    expect(buildReviewCases[0]?.sources[0]?.sourceId).toBe(prdWideningCases[0]?.originalSources[0]?.sourceId);
  });

  it.each([
    ['a build-review effect', { ...PRD_WIDENING_CASE, effect: { kind: 'none' } }],
    ['autonomous acceptance authority', { ...PRD_WIDENING_CASE, decision: 'accept' }],
    ['autonomous refusal authority', { ...PRD_WIDENING_CASE, decision: 'refuse' }],
  ])('rejects a PRD widening record carrying %s', (_description, record) => {
    expect(parseRemediationCaseDomainRecord(record)).toEqual({ ok: false, reason: 'malformed-state' });
  });

  it('returns an empty versioned state before any case has been persisted', async () => {
    const projectRoot = await createProjectRoot();

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: { version: 'v2', feature: FEATURE, cases: [], prdWideningCases: [], suppressions: [] },
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

  it('migrates a v1 envelope under the store lease without losing build-review history or suppression entries', async () => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline/remediation-cases.json');
    const v1State = {
      version: 'v1',
      feature: FEATURE,
      cases: CASE_STATE.cases,
      suppressions: [{ findingId: 'finding-1', rubric: 'testQuality', summary: 'Low confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-first' }],
    };
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(statePath, JSON.stringify(v1State), 'utf8');
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await expect(store.mutate(async (state) => ({ value: 'migrated' as const, nextState: state }))).resolves.toEqual({ ok: true, value: 'migrated' });
    await expect(store.read()).resolves.toEqual({
      ok: true,
      state: { ...CASE_STATE, suppressions: v1State.suppressions },
    });
    const serializedV2 = `${JSON.stringify({
      ...CASE_STATE,
      suppressions: v1State.suppressions,
    })}\n`;
    await expect(readFile(statePath, 'utf8')).resolves.toBe(serializedV2);
    expect(predecessorV1Decoder(JSON.parse(serializedV2))).toBe(false);
    await expect(store.mutate(async (state) => ({ value: 'repeated' as const, nextState: state }))).resolves.toEqual({ ok: true, value: 'repeated' });
    await expect(store.read()).resolves.toEqual({ ok: true, state: { ...CASE_STATE, suppressions: v1State.suppressions } });
  });

  it('leaves the original v1 envelope readable when migration replacement is interrupted', async () => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline/remediation-cases.json');
    const v1State = { version: 'v1', feature: FEATURE, cases: CASE_STATE.cases, suppressions: [] };
    const original = JSON.stringify(v1State);
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(statePath, original, 'utf8');
    const filesystem: RemediationCaseStoreFilesystem = {
      readFile: (path) => readFile(path, 'utf8'),
      mkdir: async (path) => { await mkdir(path, { recursive: true }); },
      writeFile: async (path, contents) => { await writeFile(path, contents, 'utf8'); },
      rename: async () => { throw new Error('interrupted replacement'); },
      rm: async (path) => { await rm(path, { force: true }); },
    };

    await expect(new RemediationCaseStore(projectRoot, FEATURE, { filesystem })
      .mutate(async (state) => ({ value: null, nextState: state }))).resolves.toEqual({ ok: false, reason: 'atomic-replace-failed' });
    await expect(readFile(statePath, 'utf8')).resolves.toBe(original);
    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: { ...CASE_STATE, suppressions: [] },
    });
  });

  it.each([
    ['a foreign feature', { ...CASE_STATE, feature: { ...FEATURE, feature: 'other-feature' } }, 'foreign-feature'],
    ['a foreign case domain', {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], domain: 'prd_audit' }],
    }, 'foreign-domain'],
    ['an unsupported state version', { ...CASE_STATE, version: 'v3' }, 'unknown-version'],
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
    ['a PRD source owned by two PRD cases', {
      ...CASE_STATE,
      prdWideningCases: [PRD_WIDENING_CASE, { ...PRD_WIDENING_CASE, id: 'prd-case-2' }],
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

  it.each([
    ['foreign feature', JSON.stringify({ ...CASE_STATE, feature: { ...FEATURE, feature: 'other-feature' } }), 'foreign-feature'],
    ['malformed JSON', '{not-json', 'malformed-json'],
    ['unknown future envelope', JSON.stringify({ ...CASE_STATE, version: 'v3' }), 'unknown-version'],
  ])('does not overwrite %s while refusing it', async (_description, original, reason) => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline/remediation-cases.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(statePath, original, 'utf8');

    await expect(new RemediationCaseStore(projectRoot, FEATURE)
      .mutate(async () => ({ value: null, nextState: CASE_STATE }))).resolves.toEqual({ ok: false, reason });
    await expect(readFile(statePath, 'utf8')).resolves.toBe(original);
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
      state: { version: 'v2', feature: FEATURE, cases: [], prdWideningCases: [], suppressions: [] },
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
