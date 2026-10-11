// Covers: task:11
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemon } from '../../src/engine/daemon.js';
import { clearMarker, recoverEpisodeHalts, readRawHaltClass } from '../../src/engine/daemon-rekick.js';
import { createEpisodeHaltTracker } from '../../src/engine/episode-halt-tracker.js';

describe('runDaemon episode HALT recovery across restart', () => {
  let worktreeBase: string | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    if (worktreeBase) await rm(worktreeBase, { recursive: true, force: true });
    worktreeBase = undefined;
  });

  async function worktree(slug = 'episode-halt', halted = true) {
    const path = join(worktreeBase!, slug);
    await mkdir(join(path, '.pipeline'), { recursive: true });
    if (halted) {
      await writeFile(join(path, '.pipeline', 'HALT'), 'rate limited\n');
      await writeFile(join(path, '.pipeline', 'HALT.class'), 'mechanical\n');
    }
    return path;
  }

  function recover(tracker: ReturnType<typeof createEpisodeHaltTracker>) {
    return async () => recoverEpisodeHalts({
      stampedHalts: () => tracker.listRecoverable(Date.now()),
      readHaltClass: (slug) => readRawHaltClass(join(worktreeBase!, slug)),
      clearMarker: (slug) => clearMarker(join(worktreeBase!, slug)),
    });
  }

  it('stamps an active-episode halt and a fresh daemon recovers it after its deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-episode-restart-'));
    const path = await worktree('episode-halt', false);
    const deadline = 2_000;
    let episodeActive = false;
    const episode = { active: () => episodeActive, deadline: () => episodeActive ? deadline : null };
    const firstTracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });

    await runDaemon({
      discoverBacklog: async () => [{ slug: 'episode-halt' }],
      runFeature: async () => {
        await writeFile(join(path, '.pipeline/HALT'), 'rate limited\n');
        await writeFile(join(path, '.pipeline/HALT.class'), 'mechanical\n');
        episodeActive = true;
        return { slug: 'episode-halt', status: 'halted' as const };
      },
      rateLimitEpisode: episode,
      onHaltWritten: (slug, caused, stampedDeadline) => firstTracker.onHaltWritten(slug, caused, stampedDeadline),
    }, { concurrency: 1, once: true });

    expect(JSON.parse(await readFile(join(worktreeBase, 'episode-halt/.pipeline/HALT.episode'), 'utf8'))).toMatchObject({ deadlineMs: deadline });
    vi.setSystemTime(deadline + 1);
    const restartedTracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });
    let redispatched = 0;
    await runDaemon({
      discoverBacklog: async () => [{ slug: 'episode-halt' }],
      runFeature: async () => { redispatched++; return { slug: 'episode-halt', status: 'done' as const }; },
      sweepEpisodeHalts: recover(restartedTracker),
      isHalted: async () => false,
    }, { concurrency: 1, once: true });

    await expect(access(join(worktreeBase, 'episode-halt/.pipeline/HALT'))).rejects.toThrow();
    await expect(access(join(worktreeBase, 'episode-halt/.pipeline/HALT.cleared'))).resolves.toBeUndefined();
    await expect(access(join(worktreeBase, 'episode-halt/.pipeline/REKICK'))).resolves.toBeUndefined();
    expect(redispatched).toBe(1);
  });

  it('keeps a failed stamp from changing the park or halting the loop', async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-episode-stamp-failure-'));
    const path = await worktree('episode-halt', false);
    const tracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });
    let calls = 0;
    let episodeActive = false;

    await runDaemon({
      discoverBacklog: async () => [{ slug: 'episode-halt' }],
      runFeature: async () => {
        await writeFile(join(path, '.pipeline/HALT'), 'rate limited\n');
        await writeFile(join(path, '.pipeline/HALT.class'), 'mechanical\n');
        await mkdir(join(path, '.pipeline/HALT.episode.tmp'));
        episodeActive = true;
        return { slug: 'episode-halt', status: 'halted' as const };
      },
      rateLimitEpisode: { active: () => episodeActive, deadline: () => 2_000 },
      onHaltWritten: (slug, caused, deadline) => tracker.onHaltWritten(slug, caused, deadline),
      onTick: () => { calls++; },
    }, { concurrency: 1, once: true });

    expect(calls).toBeGreaterThan(0);
    expect(await readFile(join(path, '.pipeline/HALT'), 'utf8')).toEqual('rate limited\n');
    expect(await readFile(join(path, '.pipeline/HALT.class'), 'utf8')).toEqual('mechanical\n');
  });

  it('leaves a future stamp intact at startup then recovers it on the first idle tick after deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-episode-future-'));
    const path = await worktree();
    const tracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });
    await tracker.onHaltWritten('episode-halt', true, 2_000);
    const before = await readFile(join(path, '.pipeline/HALT'));
    let stop = false;
    const run = runDaemon({
      discoverBacklog: async () => [], runFeature: async () => ({ slug: 'never', status: 'done' }),
      sweepEpisodeHalts: recover(tracker), sleep: async () => { vi.setSystemTime(2_001); stop = true; }, shouldStop: () => stop,
    }, { concurrency: 1, once: false, maxIdlePolls: 2 });
    await run;
    expect(before).toEqual(await readFile(join(path, '.pipeline/HALT.cleared')));
    await expect(access(join(path, '.pipeline/REKICK'))).resolves.toBeUndefined();
  });

  it('recovers a stamped halt on the idle tick when an in-process episode ends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-episode-idle-'));
    const path = await worktree();
    const tracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });
    await tracker.onHaltWritten('episode-halt', true, 2_000);
    let active = true;
    let stop = false;
    await runDaemon({
      discoverBacklog: async () => [], runFeature: async () => ({ slug: 'never', status: 'done' }),
      rateLimitEpisode: { active: () => active }, sweepEpisodeHalts: recover(tracker),
      sleep: async () => { vi.setSystemTime(2_001); active = false; stop = true; }, shouldStop: () => stop,
    }, { concurrency: 1, once: false, maxIdlePolls: 2 });
    await expect(access(join(path, '.pipeline/HALT.cleared'))).resolves.toBeUndefined();
  });

  it('never stamps or recovers a halt written outside an episode', async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-episode-ordinary-'));
    const path = await worktree();
    const tracker = createEpisodeHaltTracker({ worktreeBase, log: () => {} });
    await runDaemon({
      discoverBacklog: async () => [{ slug: 'episode-halt' }], runFeature: async () => ({ slug: 'episode-halt', status: 'halted' }),
      rateLimitEpisode: { active: () => false, deadline: () => null }, onHaltWritten: (slug, caused, deadline) => tracker.onHaltWritten(slug, caused, deadline),
    }, { concurrency: 1, once: true });
    const before = await readFile(join(path, '.pipeline/HALT'));
    await runDaemon({ discoverBacklog: async () => [], runFeature: async () => ({ slug: 'never', status: 'done' }), sweepEpisodeHalts: recover(tracker) }, { concurrency: 1, once: true });
    await expect(access(join(path, '.pipeline/HALT.episode'))).rejects.toThrow();
    expect(await readFile(join(path, '.pipeline/HALT'))).toEqual(before);
  });
});
