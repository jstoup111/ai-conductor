// Covers: task:12

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweepMergeableLabels, updateWatch } from '../../src/engine/mergeable-sweep.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';

describe('updateWatch', () => {
  let projectRoot: string;

  const watchPath = () => join(projectRoot, '.daemon', 'mergeable-watch.jsonl');
  const entries = (): WatchEntry[] => [
    { prUrl: 'https://example.test/a', slug: 'a', repoCwd: projectRoot, ciFixAttempts: 0 },
    { prUrl: 'https://example.test/b', slug: 'b', repoCwd: projectRoot, ciFixAttempts: 0 },
  ];

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'mergeable-watch-lock-'));
    await mkdir(join(projectRoot, '.daemon'), { recursive: true });
    await writeFile(watchPath(), entries().map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('persists both concurrent counter increments', async () => {
    await Promise.all([
      updateWatch(projectRoot, async (watch) => watch.map((entry) =>
        entry.slug === 'a' ? { ...entry, ciFixAttempts: (entry.ciFixAttempts ?? 0) + 1 } : entry,
      )),
      updateWatch(projectRoot, async (watch) => watch.map((entry) =>
        entry.slug === 'b' ? { ...entry, ciFixAttempts: (entry.ciFixAttempts ?? 0) + 1 } : entry,
      )),
    ]);

    const persisted = (await readFile(watchPath(), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as WatchEntry);
    expect(persisted.map((entry) => [entry.slug, entry.ciFixAttempts])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('runs mutations in call order', async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstHasStarted = new Promise<void>((resolve) => { firstStarted = resolve; });

    const first = updateWatch(projectRoot, async (watch) => {
      calls.push('first:start');
      firstStarted();
      await firstMayFinish;
      calls.push('first:end');
      return watch;
    });
    await firstHasStarted;
    const second = updateWatch(projectRoot, (watch) => {
      calls.push('second');
      return watch;
    });

    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not write a throwing mutation and releases the mutex', async () => {
    const before = await readFile(watchPath(), 'utf8');

    await expect(updateWatch(projectRoot, () => {
      throw new Error('do not persist');
    })).rejects.toThrow('do not persist');
    expect(await readFile(watchPath(), 'utf8')).toBe(before);

    await updateWatch(projectRoot, (watch) => watch.map((entry) =>
      entry.slug === 'a' ? { ...entry, ciFixAttempts: 1 } : entry,
    ));
    expect(await readFile(watchPath(), 'utf8')).not.toBe(before);
  });

  it('preserves an update that lands after sweep observation and before its rewrite', async () => {
    let releaseStateRead!: () => void;
    const stateReadMayFinish = new Promise<void>((resolve) => { releaseStateRead = resolve; });
    let stateReadStarted!: () => void;
    const stateReadHasStarted = new Promise<void>((resolve) => { stateReadStarted = resolve; });

    const sweep = sweepMergeableLabels({
      projectRoot,
      tracker: {
        readPullRequestMergeState: async () => {
          stateReadStarted();
          await stateReadMayFinish;
          return {
            state: 'OPEN' as const,
            mergeable: 'MERGEABLE' as const,
            checksOutcome: 'green' as const,
            labels: [],
            isDraft: false,
            hasHaltBodyMarker: false,
          };
        },
      },
    });
    await stateReadHasStarted;

    await updateWatch(projectRoot, (watch) => watch.map((entry) =>
      entry.slug === 'a' ? { ...entry, ciFixAttempts: (entry.ciFixAttempts ?? 0) + 1 } : entry,
    ));
    releaseStateRead();
    await sweep;

    const persisted = (await readFile(watchPath(), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as WatchEntry);
    expect(persisted.find((entry) => entry.slug === 'a')?.ciFixAttempts).toBe(1);
  });
});
