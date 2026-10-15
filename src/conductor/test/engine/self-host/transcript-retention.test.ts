// Covers: task:11, task:13, task:rem-prd-audit-rem-vg-S6.2
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
  identity: { runId?: string; attempt?: number; member?: string } = {},
) {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, 'session.jsonl'), 'x'.repeat(bytes));
  await events.emit({
    type: 'provider_transcripts_captured', step, runId: identity.runId ?? 'run', attempt: identity.attempt ?? 1,
    ...(identity.member === undefined ? {} : { member: identity.member }), provider: 'codex', path,
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

  it('keeps a failed attempt while pruning only the succeeding retry', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events);
    const first = '.pipeline/transcripts/build/attempt-1';
    const second = '.pipeline/transcripts/build/attempt-2';
    try {
      await retention.ready();
      await capture(events, root, first, 'build');
      await retention.settleAttempt({ step: 'build', runId: 'run', attempt: 1 }, 'failed');
      await capture(events, root, second, 'build', false, 3, { attempt: 2 });
      await retention.settleAttempt({ step: 'build', runId: 'run', attempt: 2 }, 'succeeded-with-progress');

      // A distinct attempt identity is required to prune the second capture.
      await expect(access(join(root, first))).resolves.toBeUndefined();
      await expect(access(join(root, second))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('settles only the failed member attempt before a configured-member retry', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events);
    const failed = '.pipeline/transcripts/build_review/member-attempt-1';
    const retry = '.pipeline/transcripts/build_review/member-attempt-2';
    try {
      await retention.ready();
      await capture(events, root, failed, 'build_review', false, 3, {
        runId: 'review', attempt: 1, member: 'build_review',
      });
      await retention.settleBeforeRetry('build_review', 2, 'build_review');
      await capture(events, root, retry, 'build_review', false, 3, {
        runId: 'review', attempt: 2, member: 'build_review',
      });
      await retention.settleAttempt({ step: 'build_review', runId: 'review', attempt: 2, member: 'build_review' }, 'succeeded-with-progress');

      await expect(access(join(root, failed))).resolves.toBeUndefined();
      await expect(access(join(root, retry))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_retained'))
        .toEqual([expect.objectContaining({ path: failed })]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('settles every auxiliary member capture before an unscoped group retry', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events);
    const rubric = '.pipeline/transcripts/build_review/rubric-attempt-1';
    const audit = '.pipeline/transcripts/build_review/audit-attempt-1';
    try {
      await retention.ready();
      await capture(events, root, rubric, 'build_review', false, 3, {
        runId: 'review', attempt: 1, member: 'rubric',
      });
      await capture(events, root, audit, 'build_review', false, 3, {
        runId: 'review', attempt: 1, member: 'audit',
      });

      await retention.settleBeforeRetry('build_review', 2);

      await expect(access(join(root, rubric))).resolves.toBeUndefined();
      await expect(access(join(root, audit))).resolves.toBeUndefined();
      expect((await persisted(root)).filter((event) => event.type === 'provider_transcripts_retained').map((event) => event.path))
        .toEqual([rubric, audit]);
    } finally {
      retention.stop();
      persister.stop();
    }
  });

  it('never evicts an unsettled capture while enforcing the retained cap', async () => {
    const { root, events, persister } = await fixture();
    const retention = new TranscriptRetention(root, events, { maxCaptures: 1 });
    const pending = '.pipeline/transcripts/build/pending';
    try {
      await retention.ready();
      await capture(events, root, '.pipeline/transcripts/build/retained', 'build');
      await retention.settle('build', 'failed');
      await capture(events, root, pending, 'build');
      await capture(events, root, '.pipeline/transcripts/build/new-retained', 'build', false, 3, { attempt: 2 });
      await retention.settleAttempt({ step: 'build', runId: 'run', attempt: 2 }, 'failed');
      await expect(access(join(root, pending))).resolves.toBeUndefined();
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
