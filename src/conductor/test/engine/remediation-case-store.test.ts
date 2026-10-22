// Covers: task:1, task:2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  currentBuildReviewSourceLinks,
  finalizedBuildReviewSourceIds,
  parseRemediationCaseDomainRecord,
  RemediationCaseStore,
  selectBuildReviewRemediationCases,
  selectPrdWideningRemediationCases,
} from '../../src/engine/remediation-case-store.js';
import type {
  RemediationCaseDomainRecord,
  RemediationCaseRecord,
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

const CURRENT_CASE_STATE = { ...CASE_STATE, version: 'v3' as const, outbox: [] };

const V3_OPERATOR_CASE = {
  ...CASE_STATE.cases[0],
  sources: [{ ...CASE_STATE.cases[0].sources[0], outcome: 'carried' }],
  operatorAcceptance: {
    origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-origin' }],
  },
  operatorResolution: {
    operator: 'operator@example.test',
    rationale: 'The remaining risk was explicitly accepted by the operator.',
    resolvedAt: '2026-10-21T12:00:00.000Z',
  },
};

const V3_OUTBOX = [
  {
    eventId: 'outbox-carried-1',
    occurredAt: '2026-10-21T12:01:00.000Z',
    event: {
      type: 'build_review_acceptance_carried',
      eventId: 'outbox-carried-1',
      feature: FEATURE.feature,
      lapId: 'lap-carried',
      sourceId: 'testQuality:finding-2',
      caseId: 'case-1',
      originSourceIds: ['testQuality:finding-1'],
      originLapIds: ['lap-origin'],
    },
  },
  {
    eventId: 'outbox-operator-resolved-1',
    occurredAt: '2026-10-21T12:02:00.000Z',
    event: {
      type: 'remediation_case_operator_resolved',
      eventId: 'outbox-operator-resolved-1',
      feature: FEATURE.feature,
      caseId: 'case-1',
      sourceIds: ['testQuality:finding-1'],
    },
  },
  {
    eventId: 'outbox-reconciled-1',
    occurredAt: '2026-10-21T12:03:00.000Z',
    event: {
      type: 'remediation_case_reconciled',
      eventId: 'outbox-reconciled-1',
      domain: 'build_review',
      lapId: 'lap-reconciled',
      caseId: 'case-1',
      resolution: 'resolved',
    },
  },
] as const;

const V3_STATE = {
  ...CASE_STATE,
  version: 'v3',
  cases: [V3_OPERATOR_CASE],
  outbox: V3_OUTBOX,
} as const;

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
const IMMEDIATE_LEASE: ConductStateLease = {
  acquire: async () => ({ ok: true, handle: { release: async () => ({ ok: true }) } }),
};

function createTrackedFilesystem(contents: string): {
  readonly filesystem: RemediationCaseStoreFilesystem;
  readonly writes: string[];
  readonly renames: string[];
  contents: string;
} {
  const state = {
    contents,
    writes: [] as string[],
    renames: [] as string[],
  };
  return {
    get contents() { return state.contents; },
    set contents(value: string) { state.contents = value; },
    writes: state.writes,
    renames: state.renames,
    filesystem: {
      readFile: async () => state.contents,
      mkdir: async () => undefined,
      writeFile: async (path, nextContents) => { state.writes.push(path); state.contents = nextContents; },
      rename: async (from, to) => { state.renames.push(`${from}:${to}`); },
      rm: async () => undefined,
    },
  };
}

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
  it('selects the open link or the latest resolved link for every shared source', () => {
    const sourceId = 'testQuality:shared';
    const resolved = (id: string, recordedAt: string, outcome: 'merged' | 'deferred'): RemediationCaseRecord => ({
      ...CASE_STATE.cases[0],
      id,
      disposition: outcome === 'merged' ? 'act' : 'defer',
      resolution: 'resolved',
      sources: [{ sourceId, outcome, recordedAt }],
      effect: outcome === 'merged'
        ? { id: `${id}-effect`, kind: 'action', status: 'applied', workOrderId: `${id}-work-order` }
        : { id: `${id}-effect`, kind: 'deferral', status: 'applied', issueUrl: `https://example.test/${id}` },
    });
    const open: RemediationCaseRecord = {
      ...CASE_STATE.cases[0],
      id: 'open',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-20T12:00:00.000Z' }],
    };
    const earlier = resolved('earlier', '2026-10-18T12:00:00.000Z', 'merged');
    const latest = resolved('latest', '2026-10-19T12:00:00.000Z', 'deferred');
    const tiedLater = resolved('tied-later', '2026-10-19T12:00:00.000Z', 'merged');

    expect(currentBuildReviewSourceLinks([earlier, latest, tiedLater]).get(sourceId)).toEqual({
      record: tiedLater,
      link: tiedLater.sources[0],
    });
    expect(currentBuildReviewSourceLinks([earlier, open, tiedLater]).get(sourceId)).toEqual({
      record: open,
      link: open.sources[0],
    });
  });

  it('returns no settled source for resolved R and open N on S when N is authoritative', () => {
    const sourceId = 'testQuality:shared';
    const settled: RemediationCaseRecord = {
      ...CASE_STATE.cases[0],
      id: 'settled', disposition: 'defer', resolution: 'resolved',
      sources: [{ sourceId, outcome: 'deferred', recordedAt: '2026-10-19T12:00:00.000Z' }],
      effect: { id: 'settled-effect', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/settled' },
    };
    const unsettled: RemediationCaseRecord = {
      ...CASE_STATE.cases[0],
      id: 'unsettled', resolution: 'resolved',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-20T12:00:00.000Z' }],
      effect: { id: 'unsettled-effect', kind: 'action', status: 'failed', diagnostic: 'build failed' },
    };
    const open: RemediationCaseRecord = {
      ...CASE_STATE.cases[0],
      id: 'open',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-21T12:00:00.000Z' }],
    };

    const laterSettled = {
      ...settled,
      sources: [{ ...settled.sources[0]!, recordedAt: '2026-10-21T12:00:00.000Z' }],
    };

    expect(finalizedBuildReviewSourceIds([unsettled, laterSettled])).toEqual(new Set([sourceId]));
    expect(finalizedBuildReviewSourceIds([settled, unsettled])).toEqual(new Set());
    expect(finalizedBuildReviewSourceIds([settled, open])).toEqual(new Set());
  });

  it('preserves the former any-link settlement result when no source is shared', () => {
    const records: RemediationCaseRecord[] = [
      { ...CASE_STATE.cases[0], id: 'settled-rejection', disposition: 'reject', resolution: 'resolved', effect: { kind: 'none' } },
      { ...CASE_STATE.cases[0], id: 'unsettled-action', sources: [{ sourceId: 'security:unsettled', outcome: 'acted', recordedAt: '2026-10-20T12:00:00.000Z' }] },
      {
        ...CASE_STATE.cases[0], id: 'settled-action', resolution: 'resolved',
        sources: [{ sourceId: 'security:settled', outcome: 'merged', recordedAt: '2026-10-20T12:00:00.000Z' }],
        effect: { id: 'settled-action-effect', kind: 'action', status: 'applied', workOrderId: 'work-order' },
      },
    ];
    const formerAnyLinkRule = new Set(records.flatMap((record) =>
      record.disposition !== 'act' && (record.effect.kind === 'none' || record.effect.status === 'applied')
        ? record.sources.map((source) => source.sourceId)
        : record.resolution === 'resolved' && record.effect.kind !== 'none' && record.effect.status === 'applied'
          ? record.sources.filter((source) => source.outcome === 'merged').map((source) => source.sourceId)
          : [],
    ));

    expect(finalizedBuildReviewSourceIds(records)).toEqual(formerAnyLinkRule);
  });

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
      state: { version: 'v3', feature: FEATURE, cases: [], prdWideningCases: [], suppressions: [], outbox: [] },
    });
  });

  it('round-trips one exact feature-local versioned case state to a later process', async () => {
    const projectRoot = await createProjectRoot();
    const writer = new RemediationCaseStore(projectRoot, FEATURE);

    await expect(writer.mutate(async () => ({ value: 'seeded' as const, nextState: CASE_STATE })))
      .resolves.toEqual({ ok: true, value: 'seeded' });

    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: CURRENT_CASE_STATE,
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
    await expect(new RemediationCaseStore(projectRoot, FEATURE).read()).resolves.toEqual({
      ok: true,
      state: { ...state, version: 'v3', outbox: [] },
    });
  });

  it('reads a v2 envelope without changing any case, link, effect, or suppression', async () => {
    const tracked = createTrackedFilesystem(`${JSON.stringify(CASE_STATE)}\n`);

    await expect(new RemediationCaseStore('/project', FEATURE, {
      filesystem: tracked.filesystem,
      lock: IMMEDIATE_LEASE,
    }).read()).resolves.toEqual({ ok: true, state: CASE_STATE });
    expect({ writes: tracked.writes, renames: tracked.renames }).toEqual({ writes: [], renames: [] });
  });

  it('reads a v3 case with operator-owned state and every supported outbox event without changing it', async () => {
    const tracked = createTrackedFilesystem(`${JSON.stringify(V3_STATE)}\n`);

    await expect(new RemediationCaseStore('/project', FEATURE, {
      filesystem: tracked.filesystem,
      lock: IMMEDIATE_LEASE,
    }).read()).resolves.toEqual({ ok: true, state: V3_STATE });
    expect({ writes: tracked.writes, renames: tracked.renames }).toEqual({ writes: [], renames: [] });
  });

  it.each([
    ['v1', {
      version: 'v1',
      feature: FEATURE,
      cases: CASE_STATE.cases,
      suppressions: [{ findingId: 'finding-1', rubric: 'testQuality', summary: 'Low confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-first' }],
    }, {
      ...CASE_STATE,
      suppressions: [{ findingId: 'finding-1', rubric: 'testQuality', summary: 'Low confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-first' }],
    }],
    ['v2', CASE_STATE, CASE_STATE],
  ] as const)('upgrades a valid %s envelope on its first mutation without inventing optional state', async (_version, legacyState, preservedState) => {
    const tracked = createTrackedFilesystem(`${JSON.stringify(legacyState)}\n`);
    const store = new RemediationCaseStore('/project', FEATURE, {
      filesystem: tracked.filesystem,
      lock: IMMEDIATE_LEASE,
    });
    const expectedState = { ...preservedState, version: 'v3', outbox: [] };

    await expect(store.mutate(async (state) => ({ value: 'migrated' as const, nextState: state })))
      .resolves.toEqual({ ok: true, value: 'migrated' });
    expect(JSON.parse(tracked.contents)).toEqual(expectedState);
    expect(JSON.parse(tracked.contents).cases[0]).not.toHaveProperty('operatorAcceptance');
    expect(JSON.parse(tracked.contents).cases[0]).not.toHaveProperty('operatorResolution');
    expect(JSON.parse(tracked.contents).outbox).toEqual([]);
    expect(predecessorV1Decoder(JSON.parse(tracked.contents))).toBe(false);
  });

  it.each([
    ['an envelope key', { ...CASE_STATE, version: 'v3', outbox: [], unexpected: true }],
    ['a case key', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [],
      cases: [{ ...CASE_STATE.cases[0], unexpected: true }],
    }],
    ['a source-link key', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [],
      cases: [{
        ...CASE_STATE.cases[0],
        sources: [{ ...CASE_STATE.cases[0].sources[0], unexpected: true }],
      }],
    }],
    ['an effect key', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [],
      cases: [{ ...CASE_STATE.cases[0], effect: { ...CASE_STATE.cases[0].effect, unexpected: true } }],
    }],
    ['an unknown source outcome', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [],
      cases: [{
        ...CASE_STATE.cases[0],
        sources: [{ ...CASE_STATE.cases[0].sources[0], outcome: 'unknown' }],
      }],
    }],
    ['an extra operator-acceptance key', {
      ...V3_STATE,
      cases: [{ ...V3_OPERATOR_CASE, operatorAcceptance: { ...V3_OPERATOR_CASE.operatorAcceptance, unexpected: true } }],
    }],
    ['a malformed operator-acceptance origins value', {
      ...V3_STATE,
      cases: [{ ...V3_OPERATOR_CASE, operatorAcceptance: { origins: [] } }],
    }],
    ['an extra acceptance-origin key', {
      ...V3_STATE,
      cases: [{
        ...V3_OPERATOR_CASE,
        operatorAcceptance: { origins: [{ ...V3_OPERATOR_CASE.operatorAcceptance.origins[0], unexpected: true }] },
      }],
    }],
    ['a malformed acceptance-origin lap id', {
      ...V3_STATE,
      cases: [{
        ...V3_OPERATOR_CASE,
        operatorAcceptance: { origins: [{ ...V3_OPERATOR_CASE.operatorAcceptance.origins[0], lapId: '' }] },
      }],
    }],
    ['an extra operator-resolution key', {
      ...V3_STATE,
      cases: [{ ...V3_OPERATOR_CASE, operatorResolution: { ...V3_OPERATOR_CASE.operatorResolution, unexpected: true } }],
    }],
    ['a malformed operator-resolution value', {
      ...V3_STATE,
      cases: [{ ...V3_OPERATOR_CASE, operatorResolution: { ...V3_OPERATOR_CASE.operatorResolution, resolvedAt: 'not-a-time' } }],
    }],
    ['an extra outbox-entry key', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[0], unexpected: true }],
    }],
    ['a malformed outbox-entry occurrence time', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[0], occurredAt: 'not-a-time' }],
    }],
    ['an unknown outbox event type', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [{
        eventId: 'event-1',
        occurredAt: '2026-10-21T12:00:00.000Z',
        event: { type: 'unknown_event' },
      }],
    }],
    ['an outbox event whose body is invalid', {
      ...CASE_STATE,
      version: 'v3',
      outbox: [{
        eventId: 'event-1',
        occurredAt: '2026-10-21T12:00:00.000Z',
        event: { type: 'build_review_acceptance_carried' },
      }],
    }],
    ['an extra carried-event key', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[0], event: { ...V3_OUTBOX[0].event, unexpected: true } }],
    }],
    ['a malformed carried-event value', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[0], event: { ...V3_OUTBOX[0].event, originLapIds: [] } }],
    }],
    ['an extra operator-resolution-event key', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[1], event: { ...V3_OUTBOX[1].event, unexpected: true } }],
    }],
    ['a malformed operator-resolution-event value', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[1], event: { ...V3_OUTBOX[1].event, sourceIds: [] } }],
    }],
    ['an extra reconciled-event key', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[2], event: { ...V3_OUTBOX[2].event, unexpected: true } }],
    }],
    ['a malformed reconciled-event value', {
      ...V3_STATE,
      outbox: [{ ...V3_OUTBOX[2], event: { ...V3_OUTBOX[2].event, resolution: 'unknown' } }],
    }],
  ])('fails closed for v3 with %s without writing it', async (_description, malformedState) => {
    const original = `${JSON.stringify(malformedState)}\n`;
    const tracked = createTrackedFilesystem(original);
    const store = new RemediationCaseStore('/project', FEATURE, {
      filesystem: tracked.filesystem,
      lock: IMMEDIATE_LEASE,
    });

    await expect(store.read()).resolves.toEqual({ ok: false, reason: 'malformed-state' });
    await expect(store.mutate(async () => ({ value: null, nextState: CASE_STATE })))
      .resolves.toEqual({ ok: false, reason: 'malformed-state' });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: original, writes: [], renames: [] });
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
    ['an unsupported state version', { ...CASE_STATE, version: 'v4' }, 'unknown-version'],
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
    ['unknown future envelope', JSON.stringify({ ...CASE_STATE, version: 'v4' }), 'unknown-version'],
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

  it('admits a proposed case that links a source owned only by a resolved case', async () => {
    const resolvedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [{
        ...CASE_STATE.cases[0],
        id: 'case-R',
        resolution: 'resolved',
        effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'work-order-R' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };
    const proposedState: RemediationCaseStoreState = {
      ...resolvedState,
      cases: [...resolvedState.cases, {
        ...CASE_STATE.cases[0],
        id: 'case-N',
        effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };
    const resolvedRow = JSON.stringify(resolvedState.cases[0]);
    const tracked = createTrackedFilesystem(`${JSON.stringify(resolvedState)}\n`);
    const store = new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE });

    await expect(store
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({ ok: true, value: null });
    const currentState = { ...proposedState, version: 'v3' as const, outbox: [] };
    expect(tracked.contents).toBe(`${JSON.stringify(currentState)}\n`);
    await expect(store.read()).resolves.toEqual({ ok: true, state: currentState });
    await expect(store.mutate(async (state) => ({ value: state.cases, nextState: state }))).resolves.toEqual({
      ok: true,
      value: currentState.cases,
    });
    expect(JSON.stringify((JSON.parse(tracked.contents) as RemediationCaseStoreState).cases[0])).toBe(resolvedRow);
  });

  it('admits two resolved source owners before one open owner without rewriting either resolved row', async () => {
    const resolvedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [
        {
          ...CASE_STATE.cases[0],
          id: 'case-R1',
          resolution: 'resolved',
          effect: { id: 'effect-R1', kind: 'action', status: 'applied', workOrderId: 'work-order-R1' },
          sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
        },
        {
          ...CASE_STATE.cases[0],
          id: 'case-R2',
          resolution: 'resolved',
          effect: { id: 'effect-R2', kind: 'action', status: 'applied', workOrderId: 'work-order-R2' },
          sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
        },
      ],
    };
    const proposedState: RemediationCaseStoreState = {
      ...resolvedState,
      cases: [...resolvedState.cases, {
        ...CASE_STATE.cases[0],
        id: 'case-N',
        effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };
    const resolvedRows = resolvedState.cases.map((record) => JSON.stringify(record));
    const tracked = createTrackedFilesystem(`${JSON.stringify(resolvedState)}\n`);
    const store = new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE });

    await expect(store.mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({ ok: true, value: null });
    const currentState = { ...proposedState, version: 'v3' as const, outbox: [] };
    await expect(store.read()).resolves.toEqual({ ok: true, state: currentState });
    await expect(store.mutate(async (state) => ({ value: state.cases, nextState: state }))).resolves.toEqual({
      ok: true,
      value: currentState.cases,
    });
    const written = (JSON.parse(tracked.contents) as RemediationCaseStoreState).cases;
    expect(written.map((record) => record.id)).toEqual(['case-R1', 'case-R2', 'case-N']);
    expect(written.slice(0, 2).map((record) => JSON.stringify(record))).toEqual(resolvedRows);
  });

  it('rejects a proposed case that links a source owned by an open case without writing history', async () => {
    const persistedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [{
        ...CASE_STATE.cases[0],
        id: 'case-O',
        effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };
    const tracked = createTrackedFilesystem(`${JSON.stringify(persistedState)}\n`);
    const proposedState: RemediationCaseStoreState = {
      ...persistedState,
      cases: [...persistedState.cases, {
        ...CASE_STATE.cases[0],
        id: 'case-N',
        effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };

    await expect(new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE })
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({
      ok: false,
      reason: 'rejected-transition',
      violation: {
        invariant: 'source-linked-by-multiple-cases',
        caseIds: ['case-O', 'case-N'],
        sourceIds: ['source-S'],
      },
    });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(persistedState)}\n`, writes: [], renames: [] });
  });

  it('rejects two proposed open owners over resolved history without writing history', async () => {
    const resolvedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [{
        ...CASE_STATE.cases[0], id: 'case-R', resolution: 'resolved',
        effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'work-order-R' },
        sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }],
      }],
    };
    const proposedState: RemediationCaseStoreState = {
      ...resolvedState,
      cases: [...resolvedState.cases,
        { ...CASE_STATE.cases[0], id: 'case-N1', effect: { id: 'effect-N1', kind: 'action', status: 'reserved' }, sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }] },
        { ...CASE_STATE.cases[0], id: 'case-N2', effect: { id: 'effect-N2', kind: 'action', status: 'reserved' }, sources: [{ ...CASE_STATE.cases[0].sources[0], sourceId: 'source-S' }] },
      ],
    };
    const tracked = createTrackedFilesystem(`${JSON.stringify(resolvedState)}\n`);

    await expect(new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE })
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({
      ok: false, reason: 'rejected-transition',
      violation: { invariant: 'source-linked-by-multiple-cases', caseIds: ['case-N1', 'case-N2'], sourceIds: ['source-S'] },
    });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(resolvedState)}\n`, writes: [], renames: [] });
  });

  it('rejects a proposed state with a duplicate case id', async () => {
    const tracked = createTrackedFilesystem(`${JSON.stringify(CASE_STATE)}\n`);
    const proposedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [...CASE_STATE.cases, { ...CASE_STATE.cases[0], effect: { id: 'effect-2', kind: 'action', status: 'reserved' } }],
    };

    await expect(new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE })
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({
      ok: false,
      reason: 'rejected-transition',
      violation: {
        invariant: 'duplicate-case-id',
        caseIds: ['case-1'],
        sourceIds: [],
      },
    });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(CASE_STATE)}\n`, writes: [], renames: [] });
  });

  it('refuses a proposed duplicate durable effect id without writing history', async () => {
    const proposedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [...CASE_STATE.cases, { ...CASE_STATE.cases[0], id: 'case-2' }],
    };
    const tracked = createTrackedFilesystem(`${JSON.stringify(CASE_STATE)}\n`);

    await expect(new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE })
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({
      ok: false,
      reason: 'rejected-transition',
      violation: { invariant: 'duplicate-effect-id', caseIds: ['case-1', 'case-2'], sourceIds: [] },
    });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(CASE_STATE)}\n`, writes: [], renames: [] });
  });

  it('refuses a proposed duplicate source id within one case without writing history', async () => {
    const proposedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [{ ...CASE_STATE.cases[0], sources: [CASE_STATE.cases[0].sources[0], CASE_STATE.cases[0].sources[0]] }],
    };
    const tracked = createTrackedFilesystem(`${JSON.stringify(CASE_STATE)}\n`);

    await expect(new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE })
      .mutate(async () => ({ value: null, nextState: proposedState }))).resolves.toEqual({
      ok: false,
      reason: 'rejected-transition',
      violation: { invariant: 'invalid-next-state', caseIds: [], sourceIds: [] },
    });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(CASE_STATE)}\n`, writes: [], renames: [] });
  });

  it('keeps a persisted duplicate source link malformed for reads and mutations', async () => {
    const corruptedState: RemediationCaseStoreState = {
      ...CASE_STATE,
      cases: [CASE_STATE.cases[0], {
        ...CASE_STATE.cases[0],
        id: 'case-2',
        effect: { id: 'effect-2', kind: 'action', status: 'reserved' },
      }],
    };
    const tracked = createTrackedFilesystem(`${JSON.stringify(corruptedState)}\n`);
    const store = new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE });

    await expect(store.read()).resolves.toEqual({ ok: false, reason: 'malformed-state' });
    await expect(store.mutate(async () => ({ value: null, nextState: CASE_STATE })))
      .resolves.toEqual({ ok: false, reason: 'malformed-state' });
    expect({ contents: tracked.contents, writes: tracked.writes, renames: tracked.renames })
      .toEqual({ contents: `${JSON.stringify(corruptedState)}\n`, writes: [], renames: [] });
  });

  it('keeps invalid JSON malformed for reads and mutations', async () => {
    const tracked = createTrackedFilesystem('{not-json');
    const store = new RemediationCaseStore('/project', FEATURE, { filesystem: tracked.filesystem, lock: IMMEDIATE_LEASE });

    await expect(store.read()).resolves.toEqual({ ok: false, reason: 'malformed-json' });
    await expect(store.mutate(async () => ({ value: null, nextState: CASE_STATE })))
      .resolves.toEqual({ ok: false, reason: 'malformed-json' });
  });
});
