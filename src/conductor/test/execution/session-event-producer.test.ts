import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SessionEventProducer,
  type SessionEventProducerContext,
} from '../../src/execution/session-event-producer.js';
import type { ConductorEvent } from '../../src/types/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<SessionEventProducerContext> {
  const root = await mkdtemp(join(tmpdir(), 'session-event-producer-'));
  roots.push(root);
  const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-1');
  await mkdir(producerRoot, { recursive: true });
  return {
    projectRoot: root,
    worktreeRoot: root,
    producerRoot,
    dispatchId: 'dispatch-1',
    provider: 'codex',
    scope: { kind: 'feature', featureSlug: 'feature-a' },
  };
}

describe('SessionEventProducer', () => {
  it('writes bounded safe refusal occurrences only to its dispatch/producer ledger', async () => {
    const context = await fixture();
    const producer = new SessionEventProducer(context, {
      producerId: 'producer-a',
      generateId: () => 'event-1',
      now: () => '2026-10-02T12:00:00.000Z',
    });

    const event = producer.refusal({ subcommand: `finish-record --token=super-secret ${'x'.repeat(6_000)}` });
    const path = await producer.append(event);
    const records = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent);

    expect(path).toBe(join(context.producerRoot, 'producer-a.jsonl'));
    expect(records).toEqual([{
      type: 'session_command_refused',
      eventId: 'event-1',
      sourceTime: '2026-10-02T12:00:00.000Z',
      dispatchId: 'dispatch-1',
      provider: 'codex',
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      subcommand: 'unknown',
    }]);
    expect(JSON.stringify(records)).not.toContain('super-secret');
  });

  it('gives a single invocation distinct correlated attempt and result ids', async () => {
    const context = await fixture();
    const ids = ['attempt-1', 'result-1', 'attempt-2'];
    const producer = new SessionEventProducer(context, {
      producerId: 'producer-a',
      generateId: () => ids.shift()!,
      now: () => '2026-10-02T12:00:00.000Z',
    });

    const attempt = producer.bypassAttempt({ operation: 'issue-create' });
    const result = producer.bypassResult(attempt, { outcome: 'cli-succeeded' });
    const next = producer.bypassAttempt({ operation: 'issue-create' });
    await producer.append(attempt);
    await producer.append(result);
    await producer.append(next);

    expect(attempt).toMatchObject({ type: 'github_bypass_attempt', eventId: 'attempt-1' });
    expect(result).toMatchObject({
      type: 'github_bypass_result', eventId: 'result-1', attemptId: 'attempt-1', outcome: 'cli-succeeded',
    });
    expect(next).toMatchObject({ type: 'github_bypass_attempt', eventId: 'attempt-2' });
  });

  it('allocates one JSONL writer per producer without touching canonical ledgers', async () => {
    const context = await fixture();
    const first = new SessionEventProducer(context, {
      producerId: 'producer-a', generateId: () => 'event-a', now: () => '2026-10-02T12:00:00.000Z',
    });
    const second = new SessionEventProducer(context, {
      producerId: 'producer-b', generateId: () => 'event-b', now: () => '2026-10-02T12:00:00.000Z',
    });

    await Promise.all([
      first.append(first.refusal({ subcommand: 'finish-record' })),
      second.append(second.refusal({ subcommand: 'finish-record' })),
    ]);

    await expect(readFile(first.path, 'utf8')).resolves.toContain('event-a');
    await expect(readFile(second.path, 'utf8')).resolves.toContain('event-b');
    await expect(readFile(join(context.projectRoot, '.pipeline', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(context.projectRoot, '.pipeline', 'pipeline-events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not serialize raw operation inputs or transport errors', () => {
    const context: SessionEventProducerContext = {
      projectRoot: '/project', worktreeRoot: '/project/worktree', producerRoot: '/project/worktree/.pipeline/session-events/dispatch-1',
      dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'project' },
    };
    const producer = new SessionEventProducer(context, {
      producerId: 'producer-a', generateId: () => 'event-1', now: () => '2026-10-02T12:00:00.000Z',
    });

    const event = producer.possibleBypass({ operation: 'graphql mutation password=super-secret' });

    expect(event).toMatchObject({ type: 'github_possible_bypass', operation: 'unknown' });
    expect(JSON.stringify(event)).not.toContain('super-secret');
  });
});
