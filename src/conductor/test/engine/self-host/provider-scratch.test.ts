// Covers: task:7, task:8, task:rem-prd-audit-R1, task:rem-as-built-R7, task:rem-as-built-rem-vg-ab2
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import * as providerCatalog from '../../../src/execution/provider-catalog.js';
import { startFeatureEventPersistence } from '../../../src/engine/event-persister.js';
import { LIVE_CHECKOUT_VOLATILE } from '../../../src/engine/self-host/live-boundary.js';
import { detectTranscriptsCommand, dispatchTranscripts } from '../../../src/engine/transcripts-cli.js';
import type { ConductorEvent } from '../../../src/types/events.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import {
  acquireScratchHome,
  collectLegacyScratch,
  readScratchLease,
  releaseScratchHome,
  resolveScratchHome,
  sweepFeatureWorktreeScratch,
  sweepScratch,
  type ScratchFs,
} from '../../../src/engine/self-host/provider-scratch.js';

const execFile = promisify(execFileCb);
// Above Linux's PID_MAX_LIMIT (2^22), so `kill(pid, 0)` always reports ESRCH.
// A small fixed PID such as 1001 can be a live process on a CI runner, which
// makes an "interrupted" owner look live and retains the capture instead.
const DEAD_OWNER_PID = 4_194_305;

describe('provider scratch homes', () => {
  it('retains interrupted sweep captures in the feature ledger and exposes them to transcripts', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'provider-scratch-sweep-retention-'));
    const slug = 'interrupted-feature';
    const worktreeBase = join(repo, '.worktrees');
    const worktreeRoot = join(worktreeBase, slug);
    const globalEvents = new ConductorEventEmitter();
    const home = await acquireScratchHome({
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: slug,
      runId: 'interrupted',
      attempt: 1,
      step: 'build',
      provider: 'codex',
      ownerPid: DEAD_OWNER_PID,
    });
    const scopedEmitters: ConductorEventEmitter[] = [];
    try {
      await mkdir(join(home, 'self-host-codex-interrupted', 'sessions'), { recursive: true });
      await writeFile(join(home, 'self-host-codex-interrupted', 'sessions', 'session.jsonl'), JSON.stringify({
        type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'interrupted result' }] },
      }));

      await sweepFeatureWorktreeScratch({
        worktreeBase,
        events: globalEvents,
        log: () => {},
        startFeatureEventScope: (path, featureSlug) => {
          const scope = startFeatureEventPersistence(path, globalEvents, featureSlug);
          scopedEmitters.push(scope.events);
          return scope;
        },
      });

      const capture = '.pipeline/transcripts/build/interrupted-a1-codex';
      const ledger = await readFile(join(worktreeRoot, '.pipeline', 'events.jsonl'), 'utf8');
      expect(ledger).toContain('"type":"provider_transcripts_captured"');
      expect(ledger).toContain(`"type":"provider_transcripts_retained"`);

      const command = detectTranscriptsCommand(['node', 'ai-conductor', 'transcripts', slug]);
      if (command === null) throw new Error('transcripts command was not detected');
      const output: string[] = [];
      const log = vi.spyOn(console, 'log').mockImplementation((line: string) => { output.push(line); });
      try {
        expect(await dispatchTranscripts(command, repo)).toBe(0);
      } finally {
        log.mockRestore();
      }
      expect(output).toEqual([expect.stringContaining(`interrupted=true path=${capture}`)]);

      const scopeEvents = scopedEmitters[0] as unknown as { handlers: Map<string, Set<unknown>> };
      expect(scopeEvents.handlers.get('provider_transcripts_captured')).toHaveLength(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('retains only its recovered interrupted capture beside a live pending capture', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'provider-scratch-live-pending-sweep-'));
    const slug = 'live-pending-feature';
    const worktreeBase = join(repo, '.worktrees');
    const worktreeRoot = join(worktreeBase, slug);
    const globalEvents = new ConductorEventEmitter();
    const liveCapture = '.pipeline/transcripts/build/live-a1-codex';
    const recoveredCapture = '.pipeline/transcripts/build/interrupted-a1-codex';
    const home = await acquireScratchHome({
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: slug,
      runId: 'interrupted',
      attempt: 1,
      step: 'build',
      provider: 'codex',
      ownerPid: DEAD_OWNER_PID,
    });
    try {
      await mkdir(join(worktreeRoot, liveCapture), { recursive: true });
      await writeFile(join(worktreeRoot, liveCapture, 'session.jsonl'), 'live pending transcript\n');
      await mkdir(join(home, 'self-host-codex-interrupted', 'sessions'), { recursive: true });
      await writeFile(join(home, 'self-host-codex-interrupted', 'sessions', 'session.jsonl'), 'interrupted transcript\n');
      await mkdir(join(worktreeRoot, '.pipeline'), { recursive: true });
      await writeFile(join(worktreeRoot, '.pipeline', 'events.jsonl'), `${JSON.stringify({
        type: 'provider_transcripts_captured',
        step: 'build',
        runId: 'live',
        attempt: 1,
        provider: 'codex',
        path: liveCapture,
        files: 1,
        bytes: 24,
        interrupted: false,
        skipped: 0,
        omittedLines: 0,
      })}\n`);

      await sweepFeatureWorktreeScratch({
        worktreeBase,
        events: globalEvents,
        log: () => {},
        startFeatureEventScope: (path, featureSlug) => startFeatureEventPersistence(path, globalEvents, featureSlug),
      });

      const events = (await readFile(join(worktreeRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(events.filter((event) => event.path === liveCapture).map((event) => event.type))
        .toStrictEqual(['provider_transcripts_captured']);
      expect(events.filter((event) => event.path === recoveredCapture).map((event) => event.type))
        .toStrictEqual(['provider_transcripts_captured', 'provider_transcripts_retained']);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

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
        provider: 'codex',
        ownerPid: 1234,
        startedAt: '2026-08-11T12:34:56.000Z',
      },
    });
    expect(events).toEqual([
      `mkdir:${home}`,
      `write:${join(home, 'owner.json')}`,
    ]);
  });

  it('round-trips the owning step, provider, and member with the scratch lease identity', async () => {
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
      step: 'build',
      provider: 'codex',
      member: 'rubric-a',
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
        step: 'build',
        provider: 'codex',
        member: 'rubric-a',
        ownerPid: 1234,
        startedAt: '2026-08-11T12:34:56.000Z',
      },
    });
  });

  it('reads pre-upgrade leases without transcript ownership metadata as present', async () => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => JSON.stringify({
        repository: 'owner/repository',
        featureSlug: 'provider-scratch',
        runId: 'R',
        attempt: 2,
        ownerPid: 1234,
        startedAt: '2026-08-11T12:34:56.000Z',
      }),
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => {},
    };

    await expect(readScratchLease('/wt/.daemon/scratch/R/2-codex', { fs })).resolves.toMatchObject({ kind: 'present' });
  });

  it.each([
    ['step', 'bogus'],
    ['provider', 'bogus'],
  ])('rejects a lease with an out-of-domain %s identity', async (field, value) => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => JSON.stringify({
        repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 2,
        step: 'build', provider: 'codex', ownerPid: 1234, startedAt: '2026-08-11T12:34:56.000Z',
        [field]: value,
      }),
      readdir: async () => [],
      rm: async () => {},
      rmdir: async () => {},
    };

    await expect(readScratchLease('/wt/.daemon/scratch/R/2-codex', { fs })).resolves.toStrictEqual({ kind: 'incomplete' });
  });

  it('serializes only scratch-home identity fields into an owner lease', async () => {
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
      'provider',
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

  it('gives concurrent auxiliary members of one run and attempt separate homes', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-members-'));
    const shared = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 0,
      provider: 'claude' as const,
    };

    try {
      const [testQualityHome, securityHome] = await Promise.all([
        acquireScratchHome({ ...shared, member: 'testQuality' }),
        acquireScratchHome({ ...shared, member: 'security' }),
      ]);
      expect(testQualityHome).not.toBe(securityHome);

      await releaseScratchHome({ ...shared, member: 'testQuality' });

      await expect(readdir(testQualityHome)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(securityHome, 'owner.json'), 'utf8')).resolves.toBeTypeOf('string');
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('keeps a member-keyed home a single leaf beneath its run directory', () => {
    const home = resolveScratchHome({
      worktreeRoot: '/worktree', runId: 'R', attempt: 0, provider: 'claude', member: '../escape/x:y',
    });

    expect(relative(join('/worktree', '.daemon', 'scratch', 'R'), home)).toBe('0-claude-..%002Fescape%002Fx%003Ay');
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

  // Covers: task:10
  it('acquires and releases a Pi scratch-home lease', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-pi-release-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 2,
      provider: 'pi' as const,
      ownerPid: 1234,
    };

    try {
      const home = await acquireScratchHome(options);

      await expect(readScratchLease(home)).resolves.toMatchObject({
        kind: 'present',
        lease: { ownerPid: 1234 },
      });
      await expect(releaseScratchHome(options)).resolves.toStrictEqual({ kind: 'released' });
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
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

  // Covers: task:10
  it('captures an interrupted dead-owner provider home before reclaiming it', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-interrupted-capture-'));
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('provider_transcripts_captured', (event) => { emitted.push(event); });
    const home = await acquireScratchHome({
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 1,
      step: 'build',
      provider: 'codex',
      ownerPid: 1001,
    });
    const providerHome = join(home, 'self-host-codex-interrupted');

    try {
      await mkdir(join(providerHome, 'sessions'), { recursive: true });
      await writeFile(join(providerHome, 'sessions', 'x.jsonl'), '{"message":"interrupted"}\n');

      await expect(sweepScratch({
        worktreeRoot,
        events,
        ownerLiveness: () => 'dead',
      })).resolves.toStrictEqual([{ kind: 'reclaimed', home }]);

      await expect(readFile(join(
        worktreeRoot, '.pipeline', 'transcripts', 'build', 'R-a1-codex', 'sessions', 'x.jsonl',
      ), 'utf8')).resolves.toBe('{"message":"interrupted"}\n');
      expect(emitted).toStrictEqual([{
        type: 'provider_transcripts_captured',
        owner: { kind: 'registered-step', step: 'build' },
        step: 'build', runId: 'R', attempt: 1, provider: 'codex',
        path: '.pipeline/transcripts/build/R-a1-codex',
        files: 1, bytes: 26, interrupted: true, skipped: 0, omittedLines: 0,
      }]);
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('recovers a member-bearing legacy home whose lease predates the provider field', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-legacy-member-capture-'));
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('provider_transcripts_captured', (event) => { emitted.push(event); });
    const home = join(worktreeRoot, '.daemon', 'scratch', 'R', '1-codex-rubric-a');

    try {
      await mkdir(join(home, 'self-host-codex-interrupted', 'sessions'), { recursive: true });
      await Promise.all([
        writeFile(join(home, 'owner.json'), JSON.stringify({
          repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1,
          step: 'build_review', member: 'rubric-a', ownerPid: 1001, startedAt: '2026-08-11T12:34:56.000Z',
        })),
        writeFile(join(home, 'self-host-codex-interrupted', 'sessions', 'x.jsonl'), '{"message":"interrupted"}\n'),
      ]);

      await expect(sweepScratch({ worktreeRoot, events, ownerLiveness: () => 'dead' }))
        .resolves.toStrictEqual([{ kind: 'reclaimed', home }]);

      await expect(readFile(join(
        worktreeRoot, '.pipeline', 'transcripts', 'build_review', 'R-a1-rubric-a-codex', 'sessions', 'x.jsonl',
      ), 'utf8')).resolves.toBe('{"message":"interrupted"}\n');
      expect(emitted).toEqual([expect.objectContaining({
        type: 'provider_transcripts_captured', provider: 'codex', member: 'rubric-a', interrupted: true,
        path: '.pipeline/transcripts/build_review/R-a1-rubric-a-codex',
      })]);
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('aggregates matching provider homes into one interrupted capture before reclaiming', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-multi-home-capture-'));
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('provider_transcripts_captured', (event) => { emitted.push(event); });
    const home = await acquireScratchHome({
      worktreeRoot, repository: 'owner/repository', featureSlug: 'provider-scratch',
      runId: 'R', attempt: 1, step: 'build', provider: 'codex', ownerPid: 1001,
    });

    try {
      await Promise.all([
        mkdir(join(home, 'self-host-codex-one', 'sessions'), { recursive: true }),
        mkdir(join(home, 'self-host-codex-two', 'sessions'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(home, 'self-host-codex-one', 'sessions', 'one.jsonl'), '{"message":"one"}\n'),
        writeFile(join(home, 'self-host-codex-two', 'sessions', 'two.jsonl'), '{"message":"two"}\n'),
      ]);

      await expect(sweepScratch({ worktreeRoot, events, ownerLiveness: () => 'dead' }))
        .resolves.toStrictEqual([{ kind: 'reclaimed', home }]);

      await expect(Promise.all([
        readFile(join(worktreeRoot, '.pipeline', 'transcripts', 'build', 'R-a1-codex', 'sessions', 'one.jsonl'), 'utf8'),
        readFile(join(worktreeRoot, '.pipeline', 'transcripts', 'build', 'R-a1-codex', 'sessions', 'two.jsonl'), 'utf8'),
      ])).resolves.toEqual(['{"message":"one"}\n', '{"message":"two"}\n']);
      expect(emitted).toEqual([expect.objectContaining({ files: 2, bytes: 36, skipped: 0, omittedLines: 0, interrupted: true })]);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('reports one failed event and removes a colliding multi-home capture before reclaiming', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-multi-home-collision-'));
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('provider_transcripts_harvest_failed', (event) => { emitted.push(event); });
    const home = await acquireScratchHome({
      worktreeRoot, repository: 'owner/repository', featureSlug: 'provider-scratch',
      runId: 'R', attempt: 1, step: 'build', provider: 'codex', ownerPid: 1001,
    });

    try {
      await Promise.all([
        mkdir(join(home, 'self-host-codex-one', 'sessions'), { recursive: true }),
        mkdir(join(home, 'self-host-codex-two', 'sessions'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(home, 'self-host-codex-one', 'sessions', 'same.jsonl'), '{"message":"one"}\n'),
        writeFile(join(home, 'self-host-codex-two', 'sessions', 'same.jsonl'), '{"message":"two"}\n'),
      ]);

      await expect(sweepScratch({ worktreeRoot, events, ownerLiveness: () => 'dead' }))
        .resolves.toStrictEqual([{ kind: 'reclaimed', home }]);

      expect(emitted).toEqual([expect.objectContaining({
        type: 'provider_transcripts_harvest_failed',
        path: '.pipeline/transcripts/build/R-a1-codex', error: expect.stringContaining('already exists'),
      })]);
      await expect(readdir(join(worktreeRoot, '.pipeline', 'transcripts', 'build', 'R-a1-codex'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('captures an interrupted Claude sandbox home before reclaiming it', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-claude-capture-'));
    const events = new ConductorEventEmitter();
    const captures: ConductorEvent[] = [];
    events.on('provider_transcripts_captured', (event) => { captures.push(event); });
    const home = await acquireScratchHome({
      worktreeRoot, repository: 'owner/repository', featureSlug: 'provider-scratch',
      runId: 'claude-run', attempt: 1, step: 'build', provider: 'claude', ownerPid: 1001,
    });
    try {
      const sandbox = join(home, 'harness-selfbuild-interrupted');
      await mkdir(join(sandbox, 'projects', 'w'), { recursive: true });
      await writeFile(join(sandbox, '.credentials.json'), '{"token":"claude-secret-value"}');
      await writeFile(join(sandbox, 'projects', 'w', 'session.jsonl'), '{"message":"interrupted claude-secret-value"}\n');
      await sweepScratch({ worktreeRoot, events, ownerLiveness: () => 'dead' });
      await expect(readFile(join(worktreeRoot, '.pipeline', 'transcripts', 'build', 'claude-run-a1-claude', 'projects', 'w', 'session.jsonl'), 'utf8'))
        .resolves.toBe('{"message":"interrupted [REDACTED]"}\n');
      expect(captures).toEqual([expect.objectContaining({ provider: 'claude', interrupted: true })]);
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:10
  it('leaves missing, unreadable, and live leases untouched without transcript events', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-retained-capture-'));
    const scratchRun = join(worktreeRoot, '.daemon', 'scratch', 'R');
    const missingHome = join(scratchRun, '1-codex');
    const unreadableHome = join(scratchRun, '2-codex');
    const events = new ConductorEventEmitter();
    const captures: ConductorEvent[] = [];
    events.on('provider_transcripts_captured', (event) => { captures.push(event); });

    try {
      await Promise.all([
        mkdir(join(missingHome, 'self-host-codex-missing', 'sessions'), { recursive: true }),
        mkdir(join(unreadableHome, 'self-host-codex-unreadable', 'sessions'), { recursive: true }),
      ]);
      await writeFile(join(unreadableHome, 'owner.json'), '{');
      const liveHome = await acquireScratchHome({
        worktreeRoot,
        repository: 'owner/repository',
        featureSlug: 'provider-scratch',
        runId: 'R',
        attempt: 3,
        step: 'build',
        provider: 'codex',
        ownerPid: 1003,
      });
      await mkdir(join(liveHome, 'self-host-codex-live', 'sessions'), { recursive: true });

      await sweepScratch({ worktreeRoot, events, ownerLiveness: () => 'live' });

      await expect(Promise.all([readdir(missingHome), readdir(unreadableHome), readdir(liveHome)])).resolves.toHaveLength(3);
      await expect(readdir(join(worktreeRoot, '.pipeline', 'transcripts'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(captures).toStrictEqual([]);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['step', 'bogus'],
    ['provider', 'bogus'],
  ])('does not harvest or select a provider for a dead lease with an out-of-domain %s', async (field, value) => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-invalid-lease-'));
    const home = join(worktreeRoot, '.daemon', 'scratch', 'R', '1-codex');
    const harvest = vi.fn(async () => ({ kind: 'captured' as const, files: 0, bytes: 0, skipped: [], omittedLines: 0 }));
    const descriptor = vi.spyOn(providerCatalog, 'providerDescriptor');

    try {
      await mkdir(join(home, 'self-host-codex-invalid', 'sessions'), { recursive: true });
      await writeFile(join(home, 'owner.json'), JSON.stringify({
        repository: 'owner/repository', featureSlug: 'provider-scratch', runId: 'R', attempt: 1,
        step: 'build', provider: 'codex', ownerPid: 1001, startedAt: '2026-08-11T12:34:56.000Z',
        [field]: value,
      }));

      await expect(sweepScratch({ worktreeRoot, ownerLiveness: () => 'dead', harvest }))
        .resolves.toStrictEqual([{ kind: 'retained', home, reason: 'incomplete-lease' }]);

      expect(harvest).not.toHaveBeenCalled();
      expect(descriptor).not.toHaveBeenCalled();
    } finally {
      descriptor.mockRestore();
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:10
  it('reports a failed interrupted harvest while retaining the dead-owner reclaim decision', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-failed-capture-'));
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('provider_transcripts_harvest_failed', (event) => { emitted.push(event); });
    const home = await acquireScratchHome({
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 1,
      step: 'build',
      provider: 'codex',
      ownerPid: 1001,
    });

    try {
      await mkdir(join(home, 'self-host-codex-interrupted', 'sessions'), { recursive: true });
      await expect(sweepScratch({
        worktreeRoot,
        events,
        ownerLiveness: () => 'dead',
        harvest: async () => ({ kind: 'failed', error: 'capture unavailable' }),
      })).resolves.toStrictEqual([{ kind: 'reclaimed', home }]);

      expect(emitted).toStrictEqual([{
        type: 'provider_transcripts_harvest_failed',
        owner: { kind: 'registered-step', step: 'build' },
        step: 'build', runId: 'R', attempt: 1, provider: 'codex',
        path: '.pipeline/transcripts/build/R-a1-codex', error: 'capture unavailable',
      }]);
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:10
  it('reclaims an abandoned Pi home alongside an equivalent Codex lease', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-pi-dead-sweep-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 1,
      ownerPid: 1001,
    };

    try {
      const [codexHome, piHome] = await Promise.all([
        acquireScratchHome({ ...options, provider: 'codex' }),
        acquireScratchHome({ ...options, attempt: 2, provider: 'pi' }),
      ]);

      await expect(sweepScratch({
        worktreeRoot,
        ownerLiveness: () => 'dead',
      })).resolves.toStrictEqual([
        { kind: 'reclaimed', home: codexHome },
        { kind: 'reclaimed', home: piHome },
      ]);
      await expect(Promise.all([readdir(codexHome), readdir(piHome)])).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:10
  it('keeps a live Pi lease and its home during a scratch sweep', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-pi-live-sweep-'));
    const options = {
      worktreeRoot,
      repository: 'owner/repository',
      featureSlug: 'provider-scratch',
      runId: 'R',
      attempt: 1,
      provider: 'pi' as const,
      ownerPid: 1001,
    };

    try {
      const home = await acquireScratchHome(options);

      await expect(sweepScratch({
        worktreeRoot,
        ownerLiveness: () => 'live',
      })).resolves.toStrictEqual([
        { kind: 'retained', home, reason: 'live-owner' },
      ]);
      await expect(readFile(join(home, 'owner.json'), 'utf8')).resolves.toContain('"ownerPid":1001');
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
