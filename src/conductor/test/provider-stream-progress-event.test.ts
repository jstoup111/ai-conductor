import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EventPersister } from '../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('ConductorEvent provider stream progress', () => {
  it('persists unsupported and observed runtime events through the event spine', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'provider-stream-events-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectDir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await events.emit({
        type: 'provider_stream_progress', step: 'build', provider: 'codex',
        childObservability: 'unsupported', uncachedInputTokens: 120, outputTokens: 30,
        ts: '2026-08-20T12:00:00.000Z',
      });
      await events.emit({
        type: 'provider_stream_progress', step: 'build', provider: 'claude', activeChildren: 2,
        childObservability: 'observed', uncachedInputTokens: 220, cachedInputTokens: 80,
        outputTokens: 40, ts: '2026-08-20T12:00:01.000Z',
      });

      const persisted = (await readFile(join(projectDir, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(persisted).toMatchObject([
        { type: 'provider_stream_progress', childObservability: 'unsupported', outputTokens: 30 },
        { type: 'provider_stream_progress', childObservability: 'observed', activeChildren: 2, cachedInputTokens: 80 },
      ]);
    } finally {
      persister.stop();
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
