import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { LIVE_CHECKOUT_VOLATILE } from '../../../src/engine/self-host/live-boundary.js';
import {
  acquireScratchHome,
  readScratchLease,
  releaseScratchHome,
  resolveScratchHome,
  type ScratchFs,
} from '../../../src/engine/self-host/provider-scratch.js';

const execFile = promisify(execFileCb);

describe('provider scratch homes', () => {
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
      await execFile('git', ['init', '--quiet', worktreeRoot]);

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

  it('reports a failed home removal without throwing', async () => {
    const fs: ScratchFs = {
      mkdir: async () => {},
      writeFile: async () => {},
      readFile: async () => null,
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
      rm: async () => {},
      rmdir: async () => {},
    };

    await expect(readScratchLease('/wt/.daemon/scratch/R/2-codex', { fs })).resolves.toStrictEqual(expected);
  });
});
