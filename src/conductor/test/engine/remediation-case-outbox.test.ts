// Covers: task:3
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventPersister } from '../../src/engine/event-persister.js';
import {
  drainRemediationCaseOutbox,
  RemediationCaseStore,
  remediationCaseStorePath,
} from '../../src/engine/remediation-case-store.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'case-outbox' } as const;
const temporaryDirectories: string[] = [];

const OUTBOX = [
  {
    eventId: 'carried-1',
    occurredAt: '2026-10-21T12:01:00.000Z',
    event: {
      type: 'build_review_acceptance_carried', eventId: 'carried-1', feature: FEATURE.feature,
      lapId: 'lap-2', sourceId: 'testQuality:finding-2', caseId: 'case-1',
      originSourceIds: ['testQuality:finding-1'], originLapIds: ['lap-1'],
    },
  },
  {
    eventId: 'resolved-1',
    occurredAt: '2026-10-21T12:02:00.000Z',
    event: {
      type: 'remediation_case_operator_resolved', eventId: 'resolved-1', feature: FEATURE.feature,
      caseId: 'case-1', sourceIds: ['testQuality:finding-1'],
    },
  },
  {
    eventId: 'reconciled-1',
    occurredAt: '2026-10-21T12:03:00.000Z',
    event: {
      type: 'remediation_case_reconciled', eventId: 'reconciled-1', domain: 'build_review',
      lapId: 'lap-2', caseId: 'case-1', resolution: 'resolved',
    },
  },
] as const;

async function fixture(outbox: readonly (typeof OUTBOX)[number][] = OUTBOX) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-case-outbox-'));
  temporaryDirectories.push(projectRoot);
  const store = new RemediationCaseStore(projectRoot, FEATURE);
  await expect(store.mutate(async (state) => ({
    value: undefined,
    nextState: { ...state, outbox },
  }))).resolves.toEqual({ ok: true, value: undefined });
  const eventsPath = join(projectRoot, '.pipeline', 'events.jsonl');
  const persister = new EventPersister(eventsPath, new ConductorEventEmitter());
  return { projectRoot, store, eventsPath, persister };
}

async function persistedEvents(eventsPath: string): Promise<readonly Record<string, unknown>[]> {
  return (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation case outbox', () => {
  it('persists every durable occurrence once with its stamped occurrence time and empties the outbox', async () => {
    const subject = await fixture();

    await drainRemediationCaseOutbox(subject.store, (event) => subject.persister.persistDurably(event));

    expect(await persistedEvents(subject.eventsPath)).toEqual(OUTBOX.map(({ eventId, occurredAt }) =>
      expect.objectContaining({ eventId, occurredAt })));
    await expect(subject.store.read()).resolves.toMatchObject({ ok: true, state: { outbox: [] } });
  });

  it('replays a persisted head after removal is interrupted and lets the event spine deduplicate it', async () => {
    const subject = await fixture([OUTBOX[0]]);
    const deliveryResults: string[] = [];
    const mutate = vi.spyOn(subject.store, 'mutate')
      .mockResolvedValueOnce({ ok: false, reason: 'atomic-replace-failed' });

    await drainRemediationCaseOutbox(subject.store, async (event) => {
      deliveryResults.push(await subject.persister.persistDurably(event));
    });
    mutate.mockRestore();
    await drainRemediationCaseOutbox(subject.store, async (event) => {
      deliveryResults.push(await subject.persister.persistDurably(event));
    });

    expect(deliveryResults).toEqual(['persisted', 'duplicate']);
    expect(await persistedEvents(subject.eventsPath)).toEqual([
      expect.objectContaining({ eventId: OUTBOX[0].eventId, occurredAt: OUTBOX[0].occurredAt }),
    ]);
    await expect(subject.store.read()).resolves.toMatchObject({ ok: true, state: { outbox: [] } });
  });

  it('retains a byte-identical outbox after an emit failure and later delivers it once', async () => {
    const subject = await fixture([OUTBOX[0]]);
    const before = await readFile(remediationCaseStorePath(subject.projectRoot), 'utf8');

    await drainRemediationCaseOutbox(subject.store, async () => { throw new Error('event spine unavailable'); });

    await expect(readFile(remediationCaseStorePath(subject.projectRoot), 'utf8')).resolves.toBe(before);
    await drainRemediationCaseOutbox(subject.store, (event) => subject.persister.persistDurably(event));
    expect(await persistedEvents(subject.eventsPath)).toEqual([
      expect.objectContaining({ eventId: OUTBOX[0].eventId, occurredAt: OUTBOX[0].occurredAt }),
    ]);
    await expect(subject.store.read()).resolves.toMatchObject({ ok: true, state: { outbox: [] } });
  });
});
