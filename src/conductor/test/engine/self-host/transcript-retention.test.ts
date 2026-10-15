// Covers: task:11, task:13
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import {
  TRANSCRIPT_RETENTION_MAX_BYTES,
  TRANSCRIPT_RETENTION_MAX_CAPTURES,
  TranscriptRetention,
} from '../../../src/engine/self-host/transcript-retention.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'transcript-retention-'));
  roots.push(root);
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
  persister.start();
  return { root, events, persister };
}

async function capture(
  events: ConductorEventEmitter,
  root: string,
  path: string,
  step: 'build' | 'build_review',
  interrupted = false,
  bytes = 3,
) {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, 'session.jsonl'), 'x'.repeat(bytes));
  await events.emit({
    type: 'provider_transcripts_captured', step, runId: 'run', attempt: 1, provider: 'codex', path,
    files: 1, bytes, interrupted, skipped: 0, omittedLines: 0,
  });
}

async function persisted(root: string) {
  return (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('TranscriptRetention', () => {
  it('uses the production cap defaults of 20 captures and 1 GiB', () => {
    expect(TRANSCRIPT_RETENTION_MAX_CAPTURES).toBe(20);
    expect(TRANSCRIPT_RETENTION_MAX_BYTES).toBe(1_073_741_824);
  });

  it('evicts exactly the oldest capture when retaining a 21st capture exceeds the count cap', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events);
    try {
      await retention.ready();
      for (let index = 0; index < 21; index += 1) {
        const path = `.pipeline/transcripts/build/capture-${index}`;
        await capture(events, root, path, 'build');
        await retention.settle('build', 'failed');
      }

      const captures = await readdir(join(root, '.pipeline', 'transcripts', 'build'));
      expect(captures).toHaveLength(20);
      expect(captures).not.toContain('capture-0');
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_evicted'))
        .toEqual([expect.objectContaining({ path: '.pipeline/transcripts/build/capture-0', reason: 'count' })]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('evicts retained captures oldest-first by size until their total is within the byte cap', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events, { maxBytes: 10 });
    try {
      await retention.ready();
      for (const [name, bytes] of [['oldest', 6], ['middle', 6], ['newest', 6]] as const) {
        const path = `.pipeline/transcripts/build/${name}`;
        await capture(events, root, path, 'build', false, bytes);
        await retention.settle('build', 'failed');
      }

      await expect(access(join(root, '.pipeline/transcripts/build/oldest'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(root, '.pipeline/transcripts/build/middle'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(root, '.pipeline/transcripts/build/newest'))).resolves.toBeUndefined();
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_evicted'))
        .toEqual([
          expect.objectContaining({ path: '.pipeline/transcripts/build/oldest', reason: 'size' }),
          expect.objectContaining({ path: '.pipeline/transcripts/build/middle', reason: 'size' }),
        ]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('keeps a newest capture larger than the byte cap while evicting every older capture', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events, { maxBytes: 10 });
    try {
      await retention.ready();
      await capture(events, root, '.pipeline/transcripts/build/older', 'build', false, 6);
      await retention.settle('build', 'failed');
      await capture(events, root, '.pipeline/transcripts/build/newest', 'build', false, 20);
      await retention.settle('build', 'failed');

      await expect(access(join(root, '.pipeline/transcripts/build/older'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(root, '.pipeline/transcripts/build/newest'))).resolves.toBeUndefined();
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_evicted'))
        .toEqual([expect.objectContaining({ path: '.pipeline/transcripts/build/older', reason: 'size' })]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('reports an eviction failure and does not evict another capture in that pass', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events, {
      remove: async () => { throw new Error('permission denied'); },
    });
    try {
      await retention.ready();
      for (let index = 0; index < 21; index += 1) {
        const path = `.pipeline/transcripts/build/capture-${index}`;
        await capture(events, root, path, 'build');
        await retention.settle('build', 'failed');
      }

      expect(await readdir(join(root, '.pipeline', 'transcripts', 'build'))).toHaveLength(21);
      const records = await persisted(root);
      expect(records.filter((event) => event.type === 'provider_transcripts_evicted')).toEqual([]);
      expect(records.filter((event) => event.type === 'provider_transcripts_retention_failed'))
        .toEqual([expect.objectContaining({
          path: '.pipeline/transcripts/build/capture-0', action: 'evict', error: 'permission denied',
        })]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('retains an interrupted capture and leaves it on disk when later progress settles the step', async () => {
    const { root, events, persister } = await fixture();
    const path = '.pipeline/transcripts/build/interrupted';
    const retention = new TranscriptRetention(root, events);
    try {
      await retention.ready();
      await capture(events, root, path, 'build', true);
      await retention.settle('build', 'succeeded-with-progress');

      await expect(access(join(root, path))).resolves.toBeUndefined();
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_retained'))
        .toEqual([expect.objectContaining({ path })]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('prunes pending captures only for succeeded-with-progress and retains every other settled outcome', async () => {
    const { root, events, persister } = await fixture();
    const progressPath = '.pipeline/transcripts/build/progress';
    const retainedOutcomes = [
      'failed', 'stalled', 'halted', 'needs-human', 'succeeded-without-progress',
    ] as const;
    const retention = new TranscriptRetention(root, events);
    try {
      await retention.ready();
      await capture(events, root, progressPath, 'build');
      await retention.settle('build', 'succeeded-with-progress');
      await expect(access(join(root, progressPath))).rejects.toMatchObject({ code: 'ENOENT' });

      for (const outcome of retainedOutcomes) {
        const path = `.pipeline/transcripts/build/${outcome}`;
        await capture(events, root, path, 'build');
        await retention.settle('build', outcome);
        await expect(access(join(root, path))).resolves.toBeUndefined();
      }

      const eventsByType = await persisted(root);
      expect(eventsByType.filter((event) => event.type === 'provider_transcripts_pruned'))
        .toEqual([expect.objectContaining({ path: progressPath })]);
      expect(eventsByType.filter((event) => event.type === 'provider_transcripts_retained').map((event) => event.path))
        .toEqual(retainedOutcomes.map((outcome) => `.pipeline/transcripts/build/${outcome}`));
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('records a prune failure and resolves without creating retention state outside capture directories', async () => {
    const { root, events, persister } = await fixture();
    const path = '.pipeline/transcripts/build/unremovable';
    const retention = new TranscriptRetention(root, events, {
      remove: async () => { throw new Error('permission denied'); },
    });
    try {
      await retention.ready();
      await capture(events, root, path, 'build');
      await expect(retention.settle('build', 'succeeded-with-progress')).resolves.toBeUndefined();

      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_retention_failed'))
        .toEqual([expect.objectContaining({ path, action: 'prune', error: 'permission denied' })]);
      expect(await readFile(join(root, path, 'session.jsonl'), 'utf8')).toBe('xxx');
      expect(await readdir(join(root, '.pipeline', 'transcripts')))
        .toEqual(['build']);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('reconciles an orphaned on-disk capture from the canonical event ledger as retained', async () => {
    const { root, events, persister } = await fixture();
    const path = '.pipeline/transcripts/build/orphaned';
    try {
      await capture(events, root, path, 'build');
      const retention = new TranscriptRetention(root, events);
      try {
        await retention.ready();
        await expect(access(join(root, path))).resolves.toBeUndefined();
        expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_retained'))
          .toEqual([expect.objectContaining({ path })]);
      } finally {
        retention.stop();
      }
    } finally {
      persister.stop();
    }
  });

  it('rejects an unlisted transcript retention outcome at compile time', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events);
    try {
      // @ts-expect-error Transcript retention outcomes must remain exhaustive.
      if (false) await retention.settle('build', 'cancelled');
      await retention.ready();
    } finally {
      retention.stop();
      persister.stop();
    }
  });
});
