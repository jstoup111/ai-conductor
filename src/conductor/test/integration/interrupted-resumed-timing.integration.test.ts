import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventPersister } from '../../src/engine/event-persister.js';
import { appendTimingSection, renderShippedRecord } from '../../src/engine/shipped-record.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function scriptedClock(...values: number[]) {
  return { nowMs: () => values.shift()! };
}

describe('interrupted and resumed timing', () => {
  it('reaches measured after a resumed feature completes on the same persisted ledger', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'interrupted-resumed-timing-'));
    temporaryDirectories.push(directory);
    const eventsPath = join(directory, '.pipeline', 'events.jsonl');
    await mkdir(join(directory, '.pipeline'), { recursive: true });

    const interruptedEvents = new ConductorEventEmitter();
    const interruptedPersister = new EventPersister(
      eventsPath,
      interruptedEvents,
      scriptedClock(1_000, 1_040),
    );
    interruptedPersister.start();
    await interruptedEvents.emit({ type: 'step_started', step: 'build', index: 0 });
    await interruptedEvents.emit({
      type: 'step_failed',
      step: 'build',
      retryCount: 0,
      error: 'execution interrupted before a terminal event was emitted',
    });
    interruptedPersister.stop();

    const resumedEvents = new ConductorEventEmitter();
    const resumedPersister = new EventPersister(
      eventsPath,
      resumedEvents,
      scriptedClock(2_000, 2_100),
    );
    resumedPersister.start();
    await resumedEvents.emit({ type: 'step_started', step: 'plan', index: 1 });
    await resumedEvents.emit({
      type: 'provider_attempt',
      step: 'plan',
      provider: 'codex',
      outcome: 'success',
      invoked: true,
      observedIntervals: [{ startedAtMs: 2_020, durationMs: 50 }],
    });
    await resumedEvents.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    resumedPersister.stop();

    const timing = await computeTimingRollup(directory);
    const rendered = appendTimingSection(renderShippedRecord({
      slug: 'resumed-feature', specHash: 'abc123',
    }), timing);

    expect({
      timing,
      timeBlock: rendered.slice(rendered.indexOf('## Time')),
    }).toEqual({
      timing: {
        state: 'measured',
        activeMs: 140,
        providerActiveMs: 50,
        noProviderActiveMs: 90,
      },
      timeBlock:
        '## Time\n' +
        'state: measured\n' +
        'active_ms: 140\n' +
        'provider_active_ms: 50\n' +
        'no_provider_active_ms: 90\n',
    });
  });
});
