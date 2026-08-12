import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventPersister } from '../src/engine/event-persister.js';
import type { ConductorEvent } from '../src/types/events.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('EventPersister: acceptance RED lifecycle', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('round-trips a required acceptance_red event', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-persister-acceptance-red-'));
    const eventsPath = join(tempDir, 'events.jsonl');
    const emitter = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, emitter);
    const event = {
      type: 'acceptance_red',
      state: 'required',
      step: 'acceptance_specs',
      viaException: false,
    } satisfies ConductorEvent;

    persister.start();
    await emitter.emit(event);
    persister.stop();

    const [line] = (await readFile(eventsPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(line)).toMatchObject(event);
  });
});
