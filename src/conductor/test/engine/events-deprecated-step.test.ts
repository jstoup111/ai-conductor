import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventPersister } from '../../src/engine/event-persister.js';
import { persistedEventTypes } from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const deprecatedStepEvent: ConductorEvent = {
  type: 'deprecated_step',
  step: 'wiring_check',
  adr: 'adr-2026-08-11-wiring-judged-in-build-review',
};

describe('deprecated step events', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'events-deprecated-step-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('carries the deprecated step name and ADR reference', () => {
    expect(deprecatedStepEvent).toEqual({
      type: 'deprecated_step',
      step: 'wiring_check',
      adr: 'adr-2026-08-11-wiring-judged-in-build-review',
    });
  });

  it('persists the deprecation notice to .pipeline/events.jsonl', async () => {
    const events = new ConductorEventEmitter();
    const eventsPath = join(tempDir, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();

    expect(persistedEventTypes()).toContain('deprecated_step');
    await events.emit(deprecatedStepEvent);
    persister.stop();

    expect(JSON.parse(await readFile(eventsPath, 'utf8'))).toMatchObject({
      type: 'deprecated_step',
      step: 'wiring_check',
      adr: 'adr-2026-08-11-wiring-judged-in-build-review',
    });
  });

  it('ignores an unknown event variant without throwing', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(
      join(tempDir, '.pipeline', 'events.jsonl'),
      events,
    );
    persister.start();

    await expect(events.emit({ type: 'future_event' } as unknown as ConductorEvent)).resolves.toBeUndefined();

    persister.stop();
  });
});
