import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { LIVE_CHECKOUT_VOLATILE } from '../../../src/engine/self-host/live-boundary.js';
import type { ConductorEvent } from '../../../src/types/events.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import {
  acquireScratchHome,
  collectLegacyScratch,
  readScratchLease,
  releaseScratchHome,
  resolveScratchHome,
  sweepScratch,
  type ScratchFs,
} from '../../../src/engine/self-host/provider-scratch.js';

const execFile = promisify(execFileCb);

describe('provider scratch homes', () => {
  it('retains legacy entries that are not provably stale while continuing after a failed removal', async () => {
    const tempRoot = '/legacy-scratch-refusal';
    const processStartedAt = new Date('2026-08-11T12:00:00.000Z');
    const failedHome = join(tempRoot, 'harness-selfbuild-failed');
    const deadHome = join(tempRoot, 'harness-selfbuild-dead');
    const liveHome = join(tempRoot, 'self-host-live');
    const newerHome = join(tempRoot, 'self-host-newer');
    const unknownHome = join(tempRoot, 'self-host-unknown');
    const sibling = join(tempRoot, 'unrelated-self-host-old');
    const lease = JSON.stringify({
      repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1, ownerPid: 1001, startedAt: '2026-08-11T10:00:00.000Z',
    });
    const removed: string[] = [];
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('scratch_cleanup_retained', (event) => { emitted.push(event); });
    events.on('scratch_cleanup_failed', (event) => { emitted.push(event); });
    const fs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async (path: string) => path === join(liveHome, 'owner.json')
        ? lease
        : path === join(unknownHome, 'owner.json')
          ? lease.replace('1001', '1002')
          : null,
      readdir: async (path: string) => path === tempRoot
        ? ['unrelated-self-host-old', 'harness-selfbuild-failed', 'harness-selfbuild-dead', 'self-host-live', 'self-host-newer', 'self-host-unknown']
        : [],
      stat: async (path: string) => ({
        mtime: path === newerHome ? new Date('2026-08-11T12:00:01.000Z') : new Date('2026-08-11T11:59:59.000Z'),
        isDirectory: () => true,
      }),
      rm: async (path: string) => {
        if (path === failedHome) throw new Error('removal blocked');
        removed.push(path);
      },
      rmdir: async () => {},
    } satisfies ScratchFs;

    await expect(collectLegacyScratch({
      tempRoot,
      fs,
      processStartedAt,
      ownerLiveness: (pid) => pid === 1001 ? 'live' : 'unknown',
      events,
    })).resolves.toStrictEqual([
      { kind: 'reclaimed', home: deadHome },
      { kind: 'failed', home: failedHome, error: 'removal blocked' },
      { kind: 'retained', home: liveHome, reason: 'legacy-live-owner' },
      { kind: 'retained', home: newerHome, reason: 'legacy-newer-than-process-start' },
      { kind: 'retained', home: unknownHome, reason: 'legacy-unknown-owner' },
      { kind: 'retained', home: sibling, reason: 'legacy-nonmatching' },
    ]);
    expect(removed).toStrictEqual([deadHome]);
    expect(emitted).toStrictEqual([
      { type: 'scratch_cleanup_failed', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: failedHome, reason: 'removal blocked' },
      { type: 'scratch_cleanup_retained', repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1, path: liveHome, reason: 'legacy-live-owner' },
      { type: 'scratch_cleanup_retained', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: newerHome, reason: 'legacy-newer-than-process-start' },
      { type: 'scratch_cleanup_retained', repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1, path: unknownHome, reason: 'legacy-unknown-owner' },
      { type: 'scratch_cleanup_retained', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: sibling, reason: 'legacy-nonmatching' },
    ]);
  });

  it('reports an unlistable legacy temp root without throwing', async () => {
    const tempRoot = '/legacy-scratch-unlistable';
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('scratch_cleanup_failed', (event) => { emitted.push(event); });
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => null,
      readdir: async () => { throw new Error('temp root unavailable'); },
      rm: async () => {},
      rmdir: async () => {},
    };

    await expect(collectLegacyScratch({ tempRoot, fs, events })).resolves.toStrictEqual([
      { kind: 'failed', home: tempRoot, error: 'temp root unavailable' },
    ]);
    expect(emitted).toStrictEqual([
      { type: 'scratch_cleanup_failed', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: tempRoot, reason: 'temp root unavailable' },
    ]);
  });

  it('rechecks a legacy lease immediately before removal', async () => {
    const tempRoot = '/legacy-scratch-racing-acquisition';
    const home = join(tempRoot, 'self-host-racing-acquisition');
    const liveLease = JSON.stringify({
      repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1, ownerPid: 1001, startedAt: '2026-08-11T10:00:00.000Z',
    });
    let leaseReads = 0;
    const removed: string[] = [];
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => ++leaseReads === 1 ? null : liveLease,
      readdir: async () => ['self-host-racing-acquisition'],
      stat: async () => ({ mtime: new Date('2026-08-11T11:59:59.000Z'), isDirectory: () => true }),
      rm: async (path) => { removed.push(path); },
      rmdir: async () => {},
    };

    await expect(collectLegacyScratch({
      tempRoot,
      fs,
      processStartedAt: new Date('2026-08-11T12:00:00.000Z'),
      ownerLiveness: () => 'live',
    })).resolves.toStrictEqual([
      { kind: 'retained', home, reason: 'legacy-live-owner' },
    ]);
    expect(removed).toStrictEqual([]);
  });

  it('collects historical temporary-provider homes once at the daemon boundary', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-legacy-root-'));
    const legacyHomes = [
      join(tempRoot, 'self-host-interrupted-run'),
      join(tempRoot, 'harness-selfbuild-interrupted-run'),
    ];
    const unrelatedHome = join(tempRoot, 'another-tool-interrupted-run');
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('scratch_cleanup_reclaimed', (event) => { emitted.push(event); });

    try {
      await Promise.all([...legacyHomes, unrelatedHome].map((path) => mkdir(path)));
      const beforeProcessStart = new Date(Date.now() - (process.uptime() * 1_000) - 1_000);
      await Promise.all(legacyHomes.map((path) => utimes(path, beforeProcessStart, beforeProcessStart)));

      const sortedLegacyHomes = [...legacyHomes].sort();
      await expect(collectLegacyScratch({ tempRoot, events })).resolves.toStrictEqual(
        [
          { kind: 'retained', home: unrelatedHome, reason: 'legacy-nonmatching' },
          ...sortedLegacyHomes.map((home) => ({ kind: 'reclaimed' as const, home })),
        ],
      );
      await expect(Promise.all(legacyHomes.map((path) => readdir(path).then(() => 'present', () => 'missing')))).resolves.toStrictEqual([
        'missing',
        'missing',
      ]);
      await expect(readdir(unrelatedHome)).resolves.toEqual([]);
      expect(emitted).toEqual(sortedLegacyHomes.map((path) => ({
        type: 'scratch_cleanup_reclaimed',
        repository: 'unknown',
        featureSlug: 'unknown',
        runId: 'unknown',
        attempt: 'unknown',
        path,
        reason: 'legacy-preexisting',
      })));

      await expect(collectLegacyScratch({ tempRoot, events })).resolves.toStrictEqual([]);
      expect(emitted).toHaveLength(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('resolves beneath the owning worktree', () => {
    expect(resolveScratchHome({ worktreeRoot: '/wt', runId: 'R', attempt: 2, provider: 'codex' })).toBe(
      '/wt/.daemon/scratch/R/2-codex',
    );
  });

  it.each([
    ['worktree root', { runId: 'R', attempt: 2, provider: 'codex' }],
    ['run id', { worktreeRoot: '/wt', attempt: 2, provider: 'codex' }],
    ['attempt', { worktreeRoot: '/wt', runId: 'R', provider: 'codex' }],
    ['provider', { worktreeRoot: '/wt', runId: 'R', attempt: 2 }],
  ])('rejects a missing %s', (missing, options) => {
    expect(() => resolveScratchHome(options as Parameters<typeof resolveScratchHome>[0])).toThrow(missing);
  });

  it('does not fall back to the current or main worktree root', async () => {
    const source = await readFile(new URL('../../../src/engine/self-host/provider-scratch.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/process\.cwd|mainRoot|resolveMainRoot/);
  });

  it('remains in the worktree when pipeline state is relocated', async () => {
    const mainRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-main-'));
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-worktree-'));
    const relocatedPipeline = await mkdtemp(join(tmpdir(), 'provider-scratch-pipeline-'));

    try {
      await symlink(relocatedPipeline, join(worktreeRoot, '.pipeline'));

      const home = resolveScratchHome({ worktreeRoot, runId: 'R', attempt: 2, provider: 'codex' });
      await mkdir(home, { recursive: true });

      const [realWorktree, realHome] = await Promise.all([realpath(worktreeRoot), realpath(home)]);

      expect(relative(realWorktree, realHome)).not.toMatch(/^\.\.(?:[/\\]|$)/);
      expect(realHome).not.toContain(mainRoot);
    } finally {
      await Promise.all([rm(mainRoot, { recursive: true, force: true }), rm(worktreeRoot, { recursive: true, force: true }), rm(relocatedPipeline, { recursive: true, force: true })]);
    }
  });

  it('resolves beneath an ignored live-boundary-excluded worktree prefix', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-worktree-'));
    const home = resolveScratchHome({ worktreeRoot, runId: 'R', attempt: 2, provider: 'codex' });

    try {
      const gitignore = await readFile(new URL('../../../../../.gitignore', import.meta.url), 'utf8');
      await Promise.all([
        writeFile(join(worktreeRoot, '.gitignore'), gitignore),
        mkdir(home, { recursive: true }),
      ]);
      await execFile('git', ['init', '--quiet', '-b', 'main', worktreeRoot]);

      const relativeHome = relative(worktreeRoot, home);
      await expect(execFile('git', ['-C', worktreeRoot, 'check-ignore', '--quiet', '--', relativeHome])).resolves.toBeDefined();
      expect(LIVE_CHECKOUT_VOLATILE).toContain(relativeHome.split(/[\\/]/, 1)[0]);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('writes the owner lease before returning an acquired home and round-trips its identity', async () => {
    const files = new Map<string, string>();
    const events: string[] = [];
    const fs: ScratchFs = {
      mkdir: async (path) => { events.push(`mkdir:${path}`); },
      writeFile: async (path, content) => {
        events.push(`write:${path}`);
        files.set(path, content);
      },
      readFile: async (path) => files.get(path) ?? null,
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => {},
    };

    const home = await acquireScratchHome({
      worktreeRoot: '/wt',
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'codex',
      ownerPid: 1234,
      now: () => new Date('2026-08-11T12:34:56.000Z'),
      fs,
    });

    await expect(readScratchLease(home, { fs })).resolves.toEqual({
      kind: 'present',
      lease: {
        repository: 'owner/repository',
        featureSlug: 'provider-scratch',
        runId: 'R',
        attempt: 2,
        ownerPid: 1234,
        startedAt: '2026-08-11T12:34:56.000Z',
      },
    });
    expect(events).toEqual([
      `mkdir:${home}`,
      `write:${join(home, 'owner.json')}`,
    ]);
  });

  it('serializes only the six scratch-home identity fields into an owner lease', async () => {
    const files = new Map<string, string>();
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async (path, content) => { files.set(path, content); },
      readFile: async (path) => files.get(path) ?? null,
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => {},
    };

    const home = await acquireScratchHome({
      worktreeRoot: '/wt',
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'codex',
      ownerPid: 1234,
      now: () => new Date('2026-08-11T12:34:56.000Z'),
      token: 'secret-token',
      apiKey: 'secret-api-key',
      credentials: { password: 'secret-password' },
      environment: { CODEX_HOME: '/sensitive/home' },
      fs,
    } as Parameters<typeof acquireScratchHome>[0]);

    expect(Object.keys(JSON.parse(files.get(join(home, 'owner.json'))!))).toStrictEqual([
      'repository',
      'featureSlug',
      'runId',
      'attempt',
      'ownerPid',
      'startedAt',
    ]);
  });

  it('removes a partial home when writing its owner lease fails', async () => {
    const directories = new Set<string>();
    const fs: ScratchFs = {
      mkdir: async (path) => { directories.add(path); },
      writeFile: async () => { throw new Error('lease write failed'); },
      readFile: async () => null,
      readdir: async () => [],
      rm: async (path) => { directories.delete(path); },
      rmdir: async () => {},
    };

    const acquisition = acquireScratchHome({
      worktreeRoot: '/wt',
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'codex',
      ownerPid: 1234,
      now: () => new Date('2026-08-11T12:34:56.000Z'),
      fs,
    });

    await expect(acquisition).rejects.toThrow('lease write failed');
    expect(directories).toEqual(new Set());
  });

  it('releases each home without deleting a sibling attempt, then prunes its empty run directory', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-release-'));
    const first = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      provider: 'codex' as const,
    };

    try {
      const [firstHome, siblingHome] = await Promise.all([
        acquireScratchHome({ ...first, attempt: 1 }),
        acquireScratchHome({ ...first, attempt: 2 }),
      ]);
      const runDirectory = join(worktreeRoot, '.daemon', 'scratch', first.runId);

      await releaseScratchHome({ ...first, attempt: 1 });

      await expect(readdir(firstHome)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(firstHome, 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(siblingHome, 'owner.json'), 'utf8')).resolves.toBeTypeOf('string');
      await expect(readdir(runDirectory)).resolves.toContain('2-codex');

      await releaseScratchHome({ ...first, attempt: 2 });

      await expect(readdir(runDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('releases an already released home idempotently', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-idempotent-release-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'codex' as const,
    };
    const home = resolveScratchHome(options);
    const runDirectory = join(worktreeRoot, '.daemon', 'scratch', options.runId);

    try {
      await acquireScratchHome(options);

      await expect(releaseScratchHome(options)).resolves.toStrictEqual({ kind: 'released' });
      await expect(releaseScratchHome(options)).resolves.toStrictEqual({ kind: 'released' });

      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(runDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('releases a home after it is externally removed', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-externally-removed-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'codex' as const,
    };

    try {
      const home = await acquireScratchHome(options);
      await rm(home, { recursive: true, force: true });

      await expect(releaseScratchHome(options)).resolves.toStrictEqual({ kind: 'released' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('reclaims a dead-owner home while retaining and reporting a live-owner home', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-sweep-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      provider: 'codex' as const,
    };

    try {
      const [deadHome, liveHome] = await Promise.all([
        acquireScratchHome({ ...options, attempt: 1, ownerPid: 1001 }),
        acquireScratchHome({ ...options, attempt: 2, ownerPid: 1002 }),
      ]);

      const decisions = await sweepScratch({
        worktreeRoot,
        ownerLiveness: (pid) => pid === 1001 ? 'dead' : 'live',
      });

      await expect(Promise.all([
        readdir(deadHome).then(() => 'present', () => 'missing'),
        readdir(liveHome).then(() => 'present', () => 'missing'),
        Promise.resolve(decisions),
      ])).resolves.toStrictEqual([
        'missing',
        'present',
        [
          { kind: 'reclaimed', home: deadHome },
          { kind: 'retained', home: liveHome, reason: 'live-owner' },
        ],
      ]);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('reports a failed orphan removal and continues reclaiming later homes', async () => {
    const scratchRoot = '/wt/.daemon/scratch';
    const runDirectory = join(scratchRoot, 'R');
    const firstHome = join(runDirectory, '1-codex');
    const secondHome = join(runDirectory, '2-codex');
    const lease = (attempt: number, ownerPid: number) => JSON.stringify({
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt,
      ownerPid,
      startedAt: '2026-08-11T12:34:56.000Z',
    });
    const removals: string[] = [];
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async (path) => path === join(firstHome, 'owner.json')
        ? lease(1, 1001)
        : path === join(secondHome, 'owner.json')
          ? lease(2, 1002)
          : null,
      readdir: async (path) => path === scratchRoot ? ['R'] : path === runDirectory ? ['1-codex', '2-codex'] : [],
      rm: async (path) => {
        if (path === firstHome) throw new Error('first removal failed');
        removals.push(path);
      },
      rmdir: async () => {},
    };

    await expect(sweepScratch({
      worktreeRoot: '/wt',
      fs,
      ownerLiveness: () => 'dead',
    })).resolves.toStrictEqual([
      { kind: 'failed', home: firstHome, error: 'first removal failed' },
      { kind: 'reclaimed', home: secondHome },
    ]);
    expect(removals).toStrictEqual([secondHome]);
  });

  it('retains every uncertain lease state with a distinct reason', async () => {
    const scratchRoot = '/wt/.daemon/scratch';
    const runDirectory = join(scratchRoot, 'R');
    const files = new Map<string, string | null>([
      [join(runDirectory, 'missing', 'owner.json'), null],
      [join(runDirectory, 'malformed', 'owner.json'), '{'],
      [join(runDirectory, 'incomplete', 'owner.json'), JSON.stringify({ ownerPid: 1003 })],
      [join(runDirectory, 'unknown', 'owner.json'), JSON.stringify({
        repository: 'owner/repository',
        featureSlug: 'provider-scratch',
        runId: 'R',
        attempt: 4,
        ownerPid: 1004,
        startedAt: '2026-08-11T12:34:56.000Z',
      })],
      [join(runDirectory, 'acquired', 'owner.json'), null],
    ]);
    const acquiredLease = JSON.stringify({
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 5,
      ownerPid: 1005,
      startedAt: '2026-08-11T12:34:56.000Z',
    });
    let acquiredReadCount = 0;
    const removals: string[] = [];
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async (path) => {
        if (path === join(runDirectory, 'acquired', 'owner.json')) {
          acquiredReadCount += 1;
          return acquiredReadCount === 1 ? null : acquiredLease;
        }
        return files.get(path) ?? null;
      },
      readdir: async (path) => path === scratchRoot
        ? ['R']
        : path === runDirectory
          ? ['missing', 'malformed', 'incomplete', 'unknown', 'acquired']
          : [],
      rm: async (path) => { removals.push(path); },
      rmdir: async () => {},
    };

    await expect(sweepScratch({
      worktreeRoot: '/wt',
      fs,
      ownerLiveness: () => 'unknown',
    })).resolves.toStrictEqual([
      { kind: 'retained', home: join(runDirectory, 'missing'), reason: 'no-lease' },
      { kind: 'retained', home: join(runDirectory, 'malformed'), reason: 'malformed-lease' },
      { kind: 'retained', home: join(runDirectory, 'incomplete'), reason: 'incomplete-lease' },
      { kind: 'retained', home: join(runDirectory, 'unknown'), reason: 'unknown-owner' },
      { kind: 'retained', home: join(runDirectory, 'acquired'), reason: 'concurrent-acquisition' },
    ]);
    expect(removals).toStrictEqual([]);
  });

  it('reports unknown identity for unreadable leases and survives cleanup-event emission failures', async () => {
    const scratchRoot = '/wt/.daemon/scratch';
    const runDirectory = join(scratchRoot, 'R');
    const deadHome = join(runDirectory, 'dead');
    const leases = new Map<string, string | null>([
      [join(runDirectory, 'missing', 'owner.json'), null],
      [join(runDirectory, 'malformed', 'owner.json'), '{'],
      [join(runDirectory, 'incomplete', 'owner.json'), JSON.stringify({ ownerPid: 1003 })],
      [join(runDirectory, 'unknown', 'owner.json'), JSON.stringify({
        repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 4, ownerPid: 1004, startedAt: '2026-08-11T12:34:56.000Z',
      })],
      [join(runDirectory, 'acquired', 'owner.json'), null],
      [join(deadHome, 'owner.json'), JSON.stringify({
        repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 6, ownerPid: 1006, startedAt: '2026-08-11T12:34:56.000Z',
      })],
    ]);
    let acquiredReadCount = 0;
    const emitted: unknown[] = [];
    const removals: string[] = [];
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async (path) => {
        if (path === join(runDirectory, 'acquired', 'owner.json')) {
          acquiredReadCount += 1;
          return acquiredReadCount === 1 ? null : JSON.stringify({
            repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 5, ownerPid: 1005, startedAt: '2026-08-11T12:34:56.000Z',
          });
        }
        return leases.get(path) ?? null;
      },
      readdir: async (path) => path === scratchRoot ? ['R'] : path === runDirectory ? ['missing', 'malformed', 'incomplete', 'unknown', 'acquired', 'dead'] : [],
      rm: async (path) => { removals.push(path); },
      rmdir: async () => {},
    };
    const recordingEvents = new class extends ConductorEventEmitter {
      override async emit(event: ConductorEvent): Promise<void> { emitted.push(event); }
    }();
    const throwingEvents = new class extends ConductorEventEmitter {
      override async emit(_event: ConductorEvent): Promise<void> { throw new Error('event sink unavailable'); }
    }();

    await expect(sweepScratch({
      worktreeRoot: '/wt', fs, events: recordingEvents,
      ownerLiveness: (pid) => pid === 1006 ? 'dead' : pid === 1004 ? 'unknown' : 'live',
    })).resolves.toContainEqual({ kind: 'reclaimed', home: deadHome });
    expect(emitted).toEqual(expect.arrayContaining([
      { type: 'scratch_cleanup_retained', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: join(runDirectory, 'missing'), reason: 'no-lease' },
      { type: 'scratch_cleanup_retained', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: join(runDirectory, 'malformed'), reason: 'malformed-lease' },
      { type: 'scratch_cleanup_retained', repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown', path: join(runDirectory, 'incomplete'), reason: 'incomplete-lease' },
      { type: 'scratch_cleanup_retained', repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 4, path: join(runDirectory, 'unknown'), reason: 'unknown-owner' },
      { type: 'scratch_cleanup_retained', repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 5, path: join(runDirectory, 'acquired'), reason: 'concurrent-acquisition' },
    ]));

    removals.length = 0;
    await expect(sweepScratch({
      worktreeRoot: '/wt', fs, events: throwingEvents, ownerLiveness: () => 'dead',
    })).resolves.toContainEqual({ kind: 'reclaimed', home: deadHome });
    expect(removals).toContain(deadHome);
  });

  it('keeps reclamation platform-neutral and scheduler-free', async () => {
    const source = await readFile(new URL('../../../src/engine/self-host/provider-scratch.ts', import.meta.url), 'utf8');

    expect([
      /process\.platform/.test(source),
      /scheduler/i.test(source),
      /service[- ]manager/i.test(source),
      /cron/i.test(source),
    ]).toStrictEqual([false, false, false, false]);
  });

  it('reports a failed home removal without throwing', async () => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => null,
      readdir: async () => [],
      rm: async () => { throw new Error('home removal failed'); },
      rmdir: async () => {},
    };

    await expect(releaseScratchHome({
      worktreeRoot: '/wt',
      runId: 'R',
      attempt: 2,
      provider: 'codex',
      fs,
    })).resolves.toStrictEqual({ kind: 'failed', error: 'home removal failed' });
  });

  it('reports a failed run-directory prune without throwing', async () => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => null,
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => { throw new Error('run-directory prune failed'); },
    };

    await expect(releaseScratchHome({
      worktreeRoot: '/wt',
      runId: 'R',
      attempt: 2,
      provider: 'codex',
      fs,
    })).resolves.toStrictEqual({ kind: 'failed', error: 'run-directory prune failed' });
  });

  it.each([
    ['absent', null, { kind: 'missing' }],
    ['invalid', '{', { kind: 'malformed' }],
    ['without a pid', JSON.stringify({
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      startedAt: '2026-08-11T12:34:56.000Z',
    }), { kind: 'incomplete' }],
  ])('reads a %s lease without throwing or defaulting its pid', async (_case, content, expected) => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => content,
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => {},
    };

    await expect(readScratchLease('/wt/.daemon/scratch/R/2-codex', { fs })).resolves.toStrictEqual(expected);
  });
});
