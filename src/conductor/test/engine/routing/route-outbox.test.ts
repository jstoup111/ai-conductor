// Covers: task:8
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { drainOutbox, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import type { ConductorEvent } from '../../../src/types/events.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roundId = parseRoundId('r1')!;
const child = parseChildId(1)!;

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`invalid test SHA: ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'route-outbox-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'route-outbox@example.test']);
  await git(['config', 'user.name', 'Route outbox']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  return { repo, git };
}

async function writeRouteRecord(
  subject: Awaited<ReturnType<typeof fixture>>,
  record: RouteRecord,
): Promise<void> {
  const blob = sha((await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(record) })).stdout.trim());
  await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);
}

describe('routing outbox delivery', () => {
  it('persists envelope event identity and occurrence time, then suppresses a redelivery by eventId', async () => {
    const subject = await fixture();
    try {
      const event: ConductorEvent = {
        type: 'routed_repair_phase', eventId: 'routed-phase-1', occurredAt: '2026-10-12T01:02:03.000Z',
        roundId, host: child, phase: 'repairing', credit: true, child,
      };
      const record: RouteRecord = {
        roundId, kind: 'audit', phase: 'open', items: [], allocation: {}, hosts: { [child]: 'repairing' },
        currentHostIndex: 0, receipt: emptyUnsettledReceipt(),
        outbox: [{ eventId: event.eventId, occurredAt: event.occurredAt, event }],
      };
      await writeRouteRecord(subject, record);
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('expected route record');

      const eventsPath = join(subject.repo, '.pipeline', 'events.jsonl');
      const persister = new EventPersister(eventsPath, new ConductorEventEmitter());
      let failFirstRemoval = true;
      const flakyGit: GitRunner = async (args, options) => {
        if (failFirstRemoval && args[0] === 'update-ref' && args[1] === '--stdin') {
          failFirstRemoval = false;
          return { exitCode: 1, stdout: '', stderr: 'simulated CAS retry' };
        }
        return subject.git(args, options);
      };

      await expect(drainOutbox(subject.repo, stored, (entry) => persister.persistDurably(entry), { git: flakyGit }))
        .resolves.toEqual({ kind: 'retry' });
      const redelivered = await readRouteRecord(subject.repo, 'demo', roundId);
      if (redelivered.kind !== 'record') throw new Error('expected redeliverable route record');
      await expect(drainOutbox(subject.repo, redelivered, (entry) => persister.persistDurably(entry), { git: flakyGit }))
        .resolves.toEqual({ kind: 'drained' });

      const lines = (await readFile(eventsPath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ eventId: event.eventId, occurredAt: event.occurredAt, ts: event.occurredAt });
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });
});
