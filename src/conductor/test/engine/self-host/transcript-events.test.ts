// Covers: task:2
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

describe('provider transcript lifecycle events', () => {
  it('persists every transcript lifecycle occurrence through the event spine', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'transcript-events-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectDir, '.pipeline', 'events.jsonl'), events);
    const path = '.pipeline/transcripts/build/run-a1-codex';
    persister.start();

    try {
      await events.emit({
        type: 'provider_transcripts_captured',
        step: 'build', runId: 'run', attempt: 1, member: 'implementation', provider: 'codex', path,
        files: 2, bytes: 128, interrupted: false, skipped: 1, omittedLines: 3,
      });
      await events.emit({
        type: 'provider_transcripts_harvest_failed',
        step: 'build', runId: 'run', attempt: 1, provider: 'codex', path, error: 'read failed',
      });
      await events.emit({ type: 'provider_transcripts_retained', path });
      await events.emit({ type: 'provider_transcripts_pruned', path });
      await events.emit({ type: 'provider_transcripts_evicted', path, reason: 'size' });
      await events.emit({ type: 'provider_transcripts_retention_failed', path, action: 'evict', error: 'unlink failed' });

      const persisted = (await readFile(join(projectDir, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(persisted).toMatchObject([
        {
          type: 'provider_transcripts_captured', step: 'build', runId: 'run', attempt: 1,
          member: 'implementation', provider: 'codex', path, files: 2, bytes: 128,
          interrupted: false, skipped: 1, omittedLines: 3,
        },
        {
          type: 'provider_transcripts_harvest_failed', step: 'build', runId: 'run', attempt: 1,
          provider: 'codex', path, error: 'read failed',
        },
        { type: 'provider_transcripts_retained', path },
        { type: 'provider_transcripts_pruned', path },
        { type: 'provider_transcripts_evicted', path, reason: 'size' },
        { type: 'provider_transcripts_retention_failed', path, action: 'evict', error: 'unlink failed' },
      ]);
    } finally {
      persister.stop();
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
