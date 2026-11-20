// Covers: task:14, task:15
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyBuildStallStaleCitation,
  recordBuildStallStaleCitation,
} from '../../src/engine/build-stall-stale-citation.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type {
  RemediationCaseRecord,
  RemediationCaseStoreReadResult,
  RemediationCaseStoreState,
} from '../../src/engine/remediation-case-store.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'stale-citation' } as const;
const child3 = parseChildId(3)!;
const child4 = parseChildId(4)!;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function eventSpine(): Promise<{ root: string; events: ConductorEventEmitter; persister: EventPersister }> {
  const root = await mkdtemp(join(tmpdir(), 'build-stall-stale-citation-'));
  temporaryDirectories.push(root);
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
  persister.start();
  return { root, events, persister };
}

const resolvedCitation = { kind: 'stale', caseId: 'case-resolved', ownerChild: child4, state: 'resolved' } as const;

function record(id: string, resolution: RemediationCaseRecord['resolution']): RemediationCaseRecord {
  return {
    id,
    domain: 'build_review',
    disposition: 'act',
    priority: 'high',
    rationale: 'The test fixture supplies a durable case.',
    confidence: 'high',
    resolution,
    sources: [{ sourceId: `testQuality:${id}`, outcome: 'acted', recordedAt: '2026-11-19T00:00:00.000Z' }],
    effect: { id: `effect-${id}`, kind: 'action', status: 'applied', workOrderId: `order-${id}` },
  };
}

function readable(...cases: readonly RemediationCaseRecord[]): RemediationCaseStoreReadResult {
  const state: RemediationCaseStoreState = {
    version: 'v4',
    feature: FEATURE,
    cases,
    prdWideningCases: [],
    asBuiltCases: [],
    suppressions: [],
    outbox: [],
  };
  return { ok: true, state };
}

function classify(question: string | null | undefined, stores: ReadonlyMap<number, RemediationCaseStoreReadResult>) {
  return classifyBuildStallStaleCitation({
    question,
    activeChild: child3,
    caseStores: new Map([...stores].map(([child, result]) => [parseChildId(child)!, result])),
  });
}

describe('build-stall stale-citation classifier', () => {
  it('classifies a case resolved in another child as stale', () => {
    expect(
      classify(
        'Please repair case-resolved before retrying BUILD.',
        new Map([
          [3, readable()],
          [4, readable(record('case-resolved', 'resolved'))],
        ]),
      ),
    ).toEqual({ kind: 'stale', caseId: 'case-resolved', ownerChild: child4, state: 'resolved' });
  });

  it('classifies a case open only in another child as a foreign stale citation', () => {
    expect(
      classify(
        'Please repair case-foreign before retrying BUILD.',
        new Map([
          [3, readable()],
          [4, readable(record('case-foreign', 'open'))],
        ]),
      ),
    ).toEqual({ kind: 'stale', caseId: 'case-foreign', ownerChild: child4, state: 'foreign' });
  });

  it('does not classify active, absent, null, or empty citations as stale', () => {
    const activeStore = new Map([
      [3, readable(record('case-active', 'open'))],
      [4, readable()],
    ]);

    expect(classify('Please repair case-active before retrying BUILD.', activeStore)).toEqual({ kind: 'not-stale' });
    expect(classify('Please repair an unknown case before retrying BUILD.', activeStore)).toEqual({
      kind: 'not-stale',
    });
    expect(classify(null, activeStore)).toEqual({ kind: 'not-stale' });
    expect(classify('', activeStore)).toEqual({ kind: 'not-stale' });
  });

  it('does not classify a citation when any child case store is unreadable', () => {
    expect(
      classify(
        'Please repair case-resolved before retrying BUILD.',
        new Map([
          [3, readable()],
          [4, readable(record('case-resolved', 'resolved'))],
          [5, { ok: false, reason: 'unreadable' }],
        ]),
      ),
    ).toEqual({ kind: 'not-stale' });
  });

  it('does not classify a mixed citation that names an open active-child case', () => {
    expect(
      classify(
        'Please repair case-resolved and case-active before retrying BUILD.',
        new Map([
          [3, readable(record('case-active', 'open'))],
          [4, readable(record('case-resolved', 'resolved'))],
        ]),
      ),
    ).toEqual({ kind: 'not-stale' });
  });
});

describe('build-stall stale-citation recorder', () => {
  it('persists the citation fields and its first attempt on the active event spine', async () => {
    const { root, events, persister } = await eventSpine();
    try {
      await expect(recordBuildStallStaleCitation(root, events, resolvedCitation, 2)).resolves.toEqual({
        kind: 'recorded',
        attempt: 1,
      });
      const lines = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        type: 'build_stall_stale_citation',
        caseId: 'case-resolved',
        ownerChild: 4,
        state: 'resolved',
        resolvedTasks: 2,
        attempt: 1,
      });
    } finally {
      persister.stop();
    }
  });

  it('counts consecutive identical citations across fresh recorder instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-stall-stale-citation-'));
    temporaryDirectories.push(root);
    for (const attempt of [1, 2, 3]) {
      const events = new ConductorEventEmitter();
      const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
      persister.start();
      try {
        await expect(recordBuildStallStaleCitation(root, events, resolvedCitation, 2)).resolves.toEqual({
          kind: 'recorded',
          attempt,
        });
      } finally {
        persister.stop();
      }
    }
  });

  it('restarts at one after task progress or a different case', async () => {
    const { root, events, persister } = await eventSpine();
    try {
      await recordBuildStallStaleCitation(root, events, resolvedCitation, 2);
      await recordBuildStallStaleCitation(root, events, resolvedCitation, 2);
      await expect(recordBuildStallStaleCitation(root, events, resolvedCitation, 3)).resolves.toEqual({
        kind: 'recorded',
        attempt: 1,
      });
      const otherCitation = { ...resolvedCitation, caseId: 'case-other' } as const;
      await expect(recordBuildStallStaleCitation(root, events, otherCitation, 3)).resolves.toEqual({
        kind: 'recorded',
        attempt: 1,
      });
    } finally {
      persister.stop();
    }
  });

  it('returns persist-failed without an attempt when the active event spine write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-stall-stale-citation-'));
    temporaryDirectories.push(root);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events, undefined, {
      appendFile: () => {
        throw new Error('disk unavailable');
      },
    });
    persister.start();
    try {
      await expect(recordBuildStallStaleCitation(root, events, resolvedCitation, 2)).resolves.toEqual({
        kind: 'persist-failed',
      });
    } finally {
      persister.stop();
    }
  });
});
