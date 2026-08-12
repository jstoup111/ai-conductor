import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventPersister } from '../../src/engine/event-persister.js';
import { persistedEventTypes } from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
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
    const persisted = await readFile(eventsPath, 'utf8');
    await events.emit({ type: 'future_event' } as unknown as ConductorEvent);
    persister.stop();

    expect(JSON.parse(persisted)).toMatchObject({
      type: 'deprecated_step',
      step: 'wiring_check',
      adr: 'adr-2026-08-11-wiring-judged-in-build-review',
    });
    await expect(readFile(eventsPath, 'utf8')).resolves.toBe(persisted);
  });

  it('renders the deprecation notice through the daemon event switch', () => {
    const lines: string[] = [];

    renderDaemonEvent(deprecatedStepEvent, (line) => lines.push(line));

    expect(lines).toEqual([
      expect.stringContaining('DEPRECATED: wiring_check is a no-op — see adr-2026-08-11-wiring-judged-in-build-review'),
    ]);
  });
});
