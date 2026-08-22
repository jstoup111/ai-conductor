import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  diffParkedMarkers,
  resolveRealParkedDir,
  snapshotParkedMarkers,
} from './park-leak-guard.js';
import { applyParkTeardownDecision } from './global-setup.js';
import { writeAutoPark } from '../src/engine/park-marker.js';

const CHILD_FIXTURE_ENV = 'AI_CONDUCTOR_PARK_LEAK_CHILD_FIXTURE';
const DOCUMENTED_LEAKED_SLUGS = ['slug-1', 'non-git-feature', 'callback-fire-test'];

if (process.env[CHILD_FIXTURE_ENV] === '1') {
  describe('park leak ceiling child fixture', () => {
    it('writes documented slugs under config-owned run root', async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'park-leak-fixture-'));
      try {
        expect(process.env.GIT_CEILING_DIRECTORIES?.split(':')).toContain(tmpdir());

        await Promise.all(
          DOCUMENTED_LEAKED_SLUGS.map((slug) => writeAutoPark(fixture, slug, 'fixture regression')),
        );

        await expect(readdir(join(fixture, '.daemon', 'parked'))).resolves.toEqual(
          [...DOCUMENTED_LEAKED_SLUGS].sort(),
        );
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    });
  });
}

describe('park-leak-guard: snapshotParkedMarkers & diffParkedMarkers', () => {
  const temporaryDirectories: string[] = [];

  async function createMarkerDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(markers, { recursive: true });
    return markers;
  }

  async function createGitRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-repo-'));
    temporaryDirectories.push(root);
    await execa('git', ['init', '--initial-branch=main', root]);
    await execa('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    await execa('git', ['-C', root, 'config', 'user.name', 'Test User']);
    await execa('git', ['-C', root, 'commit', '--allow-empty', '-m', 'initial']);
    return root;
  }

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('snapshots top-level regular marker files by slug and content', async () => {
    const markers = await createMarkerDirectory();
    await writeFile(join(markers, 'feature-a'), 'parked by operator\n');
    await mkdir(join(markers, 'nested'));

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: true,
      markers: { 'feature-a': 'parked by operator\n' },
    });
  });

  it('returns an empty snapshot when the parked marker directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);

    await expect(snapshotParkedMarkers(join(root, '.daemon', 'parked'))).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('returns an absent snapshot when the parked marker baseline cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(join(root, '.daemon'));
    await writeFile(markers, 'not a directory');

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('classifies added, removed, and changed marker content without false positives', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { unchanged: 'same', removed: 'before', modified: 'old' } },
      { exists: true, markers: { unchanged: 'same', added: 'after', modified: 'new' } },
    )).toEqual({
      added: ['added'],
      removed: ['removed'],
      modified: ['modified'],
    });
  });

  it('returns empty diff arrays for identical snapshots', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { feature: 'parked by operator\n' } },
      { exists: true, markers: { feature: 'parked by operator\n' } },
    )).toEqual({ added: [], removed: [], modified: [] });
  });

  it('returns an empty diff when either snapshot is absent', () => {
    expect([
      diffParkedMarkers(
        { exists: false, markers: {} },
        { exists: true, markers: { feature: 'parked by operator\n' } },
      ),
      diffParkedMarkers(
        { exists: true, markers: { feature: 'parked by operator\n' } },
        { exists: false, markers: {} },
      ),
    ]).toEqual([
      { added: [], removed: [], modified: [] },
      { added: [], removed: [], modified: [] },
    ]);
  });

  it.each([
    ['added', { added: ['added-slug'], removed: [], modified: [] }, 'added-slug'],
    ['removed', { added: [], removed: ['removed-slug'], modified: [] }, 'removed-slug'],
    ['modified', { added: [], removed: [], modified: ['modified-slug'] }, 'modified-slug'],
  ])('throws for %s parked marker leaks', (_kind, diff, slug) => {
    expect(() => applyParkTeardownDecision(diff)).toThrow(new RegExp(`${slug}.*#1251`));
  });

  it('returns silently when the parked marker diff is empty', () => {
    expect(() => applyParkTeardownDecision({ added: [], removed: [], modified: [] })).not.toThrow();
  });

  it('resolves the real parked directory from a fixture repository and linked worktree', async () => {
    const root = await createGitRepository();
    const worktree = join(root, 'linked-worktree');
    await execa('git', ['-C', root, 'worktree', 'add', '-b', 'linked', worktree]);

    await expect(Promise.all([
      resolveRealParkedDir(root),
      resolveRealParkedDir(worktree),
    ])).resolves.toEqual([
      join(root, '.daemon', 'parked'),
      join(root, '.daemon', 'parked'),
    ]);
  });

  it('returns null outside a Git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-non-git-'));
    temporaryDirectories.push(root);

    await expect(resolveRealParkedDir(root)).resolves.toBeNull();
  });

  it('snapshots the real parked directory at setup and evaluates it after pipeline, tmux, and signals', async () => {
    const calls: string[] = [];
    const teardown = await loadParkLifecycleSetup(calls);

    await teardown();

    expect(calls).toEqual([
      'park:before',
      'pipeline',
      'tmux',
      'signals',
      'park:after',
    ]);
  });

  it('warns on unexpected parked-ledger checking failures but rethrows a guard verdict', async () => {
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const unexpectedTeardown = await loadParkLifecycleSetup([], { throwOnAfterSnapshot: true });
      await expect(unexpectedTeardown()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('park-leak-guard: NOT enforced'));

      const guardTeardown = await loadParkLifecycleSetup([], { addedAfter: true });
      await expect(guardTeardown()).rejects.toThrow(/#1251/);
    } finally {
      warning.mockRestore();
      vi.doUnmock('./park-leak-guard.js');
      vi.doUnmock('./pipeline-leak-guard.js');
      vi.doUnmock('./tmpdir-leak-guard.js');
      vi.doUnmock('./tmux-leak-guard.js');
      vi.doUnmock('./signals-leak-guard.js');
      vi.doUnmock('./engine-dist-guard.js');
      vi.resetModules();
    }
  });

  it('keeps the documented fixture slugs out of an enclosing repository parked ledger', async () => {
    const enclosingRepository = await createGitRepository();
    const nestedTmpdir = join(enclosingRepository, 'nested-tmpdir');
    await mkdir(nestedTmpdir);
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: nestedTmpdir,
      [CHILD_FIXTURE_ENV]: '1',
    };
    delete childEnv.AI_CONDUCTOR_TEST_TMP_ROOT;

    await execa(
      process.execPath,
      [
        join('node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        'test/fixtures/park-leak-child.vitest.config.ts',
        'test/park-leak-guard.test.ts',
        '--testNamePattern',
        'writes documented slugs under config-owned run root',
        '--reporter=dot',
        '--silent',
      ],
      { cwd: process.cwd(), env: childEnv },
    );

    const enclosingMarkers = await readdir(join(enclosingRepository, '.daemon', 'parked'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });

    expect(enclosingMarkers).toEqual([]);
  });

  async function loadParkLifecycleSetup(
    calls: string[],
    options: { addedAfter?: boolean; throwOnAfterSnapshot?: boolean } = {},
  ): Promise<() => Promise<void>> {
    vi.resetModules();
    let parkedSnapshots = 0;
    vi.doMock('./park-leak-guard.js', () => ({
      resolveRealParkedDir: async () => '/real/.daemon/parked',
      snapshotParkedMarkers: async () => {
        parkedSnapshots += 1;
        calls.push(parkedSnapshots === 1 ? 'park:before' : 'park:after');
        if (options.throwOnAfterSnapshot && parkedSnapshots === 2) throw new Error('unexpected');
        return { exists: true, markers: parkedSnapshots === 2 && options.addedAfter ? { leaked: 'yes' } : {} };
      },
      diffParkedMarkers: (before: { markers: Record<string, string> }, after: { markers: Record<string, string> }) => ({
        added: Object.keys(after.markers).filter(slug => !(slug in before.markers)),
        removed: [],
        modified: [],
      }),
    }));
    vi.doMock('./pipeline-leak-guard.js', () => ({
      snapshotPipeline: async () => ({ exists: false, entries: new Map() }),
      diffPipeline: () => {
        calls.push('pipeline');
        return { added: [], modified: [] };
      },
    }));
    vi.doMock('./tmpdir-leak-guard.js', () => ({
      RUN_TMP_ROOT_ENV: 'TEST_RUN_TMP_ROOT',
      createRunTmpRoot: async () => '/tmp/run-root',
      removeRunTmpRoot: async () => {},
      snapshotTmpdirEntries: async () => ({ exists: true, entries: new Set() }),
      diffTmpdirEntries: () => ({ stray: [], ignored: [] }),
    }));
    vi.doMock('./tmux-leak-guard.js', () => ({
      snapshotDaemonSessions: () => ({ exists: true, sessions: new Map() }),
      sweepStaleDaemonSessions: () => ({ killed: [] }),
      reapLeakedDaemonSessions: () => {
        calls.push('tmux');
        return { killed: [], indeterminate: [] };
      },
    }));
    vi.doMock('./signals-leak-guard.js', () => ({
      snapshotEngineerSignals: async () => ({ exists: true, lines: [] }),
      diffEngineerSignals: () => {
        calls.push('signals');
        return { addedTestProjectLines: 0 };
      },
    }));
    vi.doMock('./engine-dist-guard.js', () => ({ ensureEngineDist: async () => false }));

    const { default: setup } = await import('./global-setup.js');
    return await setup();
  }
});
