import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CloseoutEventTail } from '../../src/engine/closeout-tail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter, type EventHandler } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; producer: string; canonical: string }> {
  const root = await mkdtemp(join(tmpdir(), 'session-event-replay-'));
  roots.push(root);
  const producer = join(root, '.pipeline', 'session-events', 'dispatch-1', 'producer-a.jsonl');
  const canonical = join(root, '.pipeline', 'events.jsonl');
  await mkdir(join(root, '.pipeline', 'session-events', 'dispatch-1'), { recursive: true });
  return { root, producer, canonical };
}

const occurrence = {
  type: 'session_command_refused', eventId: 'event-1', sourceTime: '2026-10-02T12:00:00.000Z',
  dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'project' }, subcommand: 'finish-record',
} as const;

async function canonicalOccurrences(path: string): Promise<Array<{ eventId?: unknown }>> {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('session event canonical replay', () => {
  it('replays a persisted producer occurrence after restart without duplicating its canonical record', async () => {
    const { root, producer, canonical } = await fixture();
    await writeFile(producer, `${JSON.stringify(occurrence)}\n`);

    const firstEvents = new ConductorEventEmitter();
    const firstPersister = new EventPersister(canonical, firstEvents);
    firstPersister.start();
    await new CloseoutEventTail({ projectRoot: root, events: firstEvents }).poll();
    firstPersister.stop();

    const restartedEvents = new ConductorEventEmitter();
    const repeatedDeliveries: string[] = [];
    restartedEvents.on('session_command_refused', (event) => {
      if ('eventId' in event) repeatedDeliveries.push(event.eventId);
    });
    const restartedPersister = new EventPersister(canonical, restartedEvents);
    restartedPersister.start();
    await new CloseoutEventTail({ projectRoot: root, events: restartedEvents }).poll();
    restartedPersister.stop();

    expect((await canonicalOccurrences(canonical)).filter((event) => event.eventId === occurrence.eventId)).toHaveLength(1);
    expect(repeatedDeliveries).toEqual([occurrence.eventId]);
  });

  it('retains progress through a subscriber interruption and retries the same persisted occurrence without another canonical append', async () => {
    const { root, producer, canonical } = await fixture();
    await writeFile(producer, `${JSON.stringify(occurrence)}\n`);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(canonical, events);
    persister.start();
    const interrupted: EventHandler = () => { throw new Error('renderer interrupted'); };
    events.on('session_command_refused', interrupted);
    const tail = new CloseoutEventTail({ projectRoot: root, events });

    await expect(tail.poll()).rejects.toThrow('renderer interrupted');
    events.off('session_command_refused', interrupted);
    await tail.poll();
    persister.stop();

    expect((await canonicalOccurrences(canonical)).filter((event) => event.eventId === occurrence.eventId)).toHaveLength(1);
  });

  it('retains a read occurrence when canonical append fails, then acknowledges it only after retry', async () => {
    const { root, producer, canonical } = await fixture();
    await writeFile(producer, `${JSON.stringify(occurrence)}\n`);
    // A directory at the canonical file path faithfully injects append failure.
    await mkdir(canonical);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(canonical, events);
    persister.start();
    const tail = new CloseoutEventTail({ projectRoot: root, events });

    await expect(tail.poll()).rejects.toThrow('EventPersister failed to write');
    await rm(canonical, { recursive: true });
    await tail.poll();
    persister.stop();

    expect((await canonicalOccurrences(canonical)).filter((event) => event.eventId === occurrence.eventId)).toHaveLength(1);
  });

  it('does not acknowledge a diagnostic or project its following record until persistence succeeds', async () => {
    const { root, producer } = await fixture();
    await writeFile(producer, `not-json\n${JSON.stringify(occurrence)}\n`);
    const events = new ConductorEventEmitter();
    const attempted: string[] = [];
    const persisted: string[] = [];
    let failDiagnostic = true;
    const tail = new CloseoutEventTail({
      projectRoot: root,
      events,
      emitEvent: async (event) => {
        attempted.push(event.type);
        if (failDiagnostic) {
          failDiagnostic = false;
          throw new Error('canonical append interrupted');
        }
        persisted.push(event.type);
      },
    });

    await expect(tail.poll()).rejects.toThrow('canonical append interrupted');
    expect(attempted).toEqual(['pipeline_tail_diagnostic']);
    expect(persisted).toEqual([]);

    await tail.poll();

    expect(persisted).toEqual(['pipeline_tail_diagnostic', 'session_command_refused']);
    expect(attempted).toEqual(['pipeline_tail_diagnostic', 'pipeline_tail_diagnostic', 'session_command_refused']);
  });

  it('retains distinct observation and correlated terminal ids even when their operation matches', async () => {
    const { canonical } = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(canonical, events);
    persister.start();
    await events.emit({ ...occurrence, type: 'github_bypass_attempt', eventId: 'attempt-1', operation: 'issue-create' });
    await events.emit({
      ...occurrence, type: 'github_bypass_result', eventId: 'result-1', attemptId: 'attempt-1', outcome: 'cli-succeeded',
    });
    await events.emit({ ...occurrence, type: 'github_bypass_attempt', eventId: 'attempt-2', operation: 'issue-create' });
    persister.stop();

    expect((await canonicalOccurrences(canonical)).map((event) => event.eventId)).toEqual(['attempt-1', 'result-1', 'attempt-2']);
  });
});
