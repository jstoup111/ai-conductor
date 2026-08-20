// Unit tests for the tmpdir leak guard (#1112) — the redirect helpers, the
// pure stray/ignored classification, and the throw-vs-warn teardown decision.
// No vitest wiring involved: each seam is exercised directly, the same split
// used by signals-leak-guard.test.ts and global-setup-engineer-signals.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, realpath, readdir, rm, symlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRunTmpRoot,
  ensureRunTmpRootSync,
  removeRunTmpRoot,
  RUN_TMP_ROOT_ENV,
  snapshotTmpdirEntries,
  diffTmpdirEntries,
  IGNORED_TMPDIR_PREFIXES,
  RUN_TMP_ROOT_PREFIX,
  type TmpdirSnapshot,
} from './tmpdir-leak-guard.js';
import { applyTmpdirTeardownDecision } from './global-setup.js';

const snap = (entries: string[]): TmpdirSnapshot => ({ exists: true, entries });

describe('tmpdir-leak-guard: run root lifecycle', () => {
  // A fake "real tmpdir" so these tests never depend on — or dirty — the
  // operator's actual one.
  let fakeRealTmpdir: string;

  beforeEach(async () => {
    fakeRealTmpdir = await mkdtemp(join(tmpdir(), 'tmpdir-guard-unit-'));
  });

  afterEach(async () => {
    await rm(fakeRealTmpdir, { recursive: true, force: true });
  });

  it('creates the run root inside the given real tmpdir under the known prefix', async () => {
    const runRoot = await createRunTmpRoot(fakeRealTmpdir);

    expect(runRoot.startsWith(join(fakeRealTmpdir, RUN_TMP_ROOT_PREFIX))).toBe(true);
    expect(existsSync(runRoot)).toBe(true);
  });

  it('installs the run root and the TMPDIR redirect into the given env', () => {
    const env: NodeJS.ProcessEnv = {};

    const runRoot = ensureRunTmpRootSync(fakeRealTmpdir, env);

    expect(existsSync(runRoot)).toBe(true);
    expect(env.TMPDIR).toBe(runRoot);
    expect(env[RUN_TMP_ROOT_ENV]).toBe(runRoot);
  });

  it('is idempotent — a config reload reuses the root instead of leaking another', async () => {
    const env: NodeJS.ProcessEnv = {};

    const first = ensureRunTmpRootSync(fakeRealTmpdir, env);
    const second = ensureRunTmpRootSync(fakeRealTmpdir, env);

    expect(second).toBe(first);
    expect(await readdir(fakeRealTmpdir)).toHaveLength(1);
  });

  it('canonicalizes the run root and appends it to the Git ceiling directories', async () => {
    const aliasedTmpdir = join(fakeRealTmpdir, 'symlink-to-real-tmpdir');
    await symlink(fakeRealTmpdir, aliasedTmpdir, 'dir');
    const env: NodeJS.ProcessEnv = { GIT_CEILING_DIRECTORIES: '/already/a/ceiling' };

    const runRoot = ensureRunTmpRootSync(aliasedTmpdir, env);
    const canonicalRoot = await realpath(runRoot);

    expect(runRoot).toBe(canonicalRoot);
    expect(env.TMPDIR).toBe(canonicalRoot);
    expect(env[RUN_TMP_ROOT_ENV]).toBe(canonicalRoot);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(`/already/a/ceiling:${canonicalRoot}`);
  });

  it('sets the Git ceiling directories to the canonical run root when no ceiling exists', async () => {
    const env: NodeJS.ProcessEnv = {};

    const runRoot = ensureRunTmpRootSync(fakeRealTmpdir, env);
    const canonicalRoot = await realpath(runRoot);

    expect(env.GIT_CEILING_DIRECTORIES).toBe(canonicalRoot);
  });

  it('does not add a second root or duplicate ceiling entry after a config reload', async () => {
    const env: NodeJS.ProcessEnv = { GIT_CEILING_DIRECTORIES: '/already/a/ceiling' };

    const first = ensureRunTmpRootSync(fakeRealTmpdir, env);
    const canonicalRoot = await realpath(first);
    const second = ensureRunTmpRootSync(fakeRealTmpdir, env);

    expect(second).toBe(canonicalRoot);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(`/already/a/ceiling:${canonicalRoot}`);
    expect(env.GIT_CEILING_DIRECTORIES?.split(':')).toEqual([
      '/already/a/ceiling',
      canonicalRoot,
    ]);
    expect((await readdir(fakeRealTmpdir)).filter(entry => entry.startsWith(RUN_TMP_ROOT_PREFIX)))
      .toHaveLength(1);
  });

  it('throws a named error when the run root cannot be canonicalized', async () => {
    const env: NodeJS.ProcessEnv = {};
    vi.resetModules();
    vi.doMock('fs', async importOriginal => {
      const original = await importOriginal<typeof import('fs')>();
      return {
        ...original,
        realpathSync: () => {
          throw new Error('simulated realpath failure');
        },
      };
    });

    try {
      const { ensureRunTmpRootSync: ensureWithFailingRealpath } = await import(
        './tmpdir-leak-guard.js'
      );
      expect(() => ensureWithFailingRealpath(fakeRealTmpdir, env)).toThrow(
        /^tmpdir-leak-guard:.*realpath.*run root/i
      );
    } finally {
      vi.doUnmock('fs');
      vi.resetModules();
    }
  });

  it('removes the run root and everything a leaking test left inside it', async () => {
    const runRoot = await createRunTmpRoot(fakeRealTmpdir);
    // Stand in for the ~1,426 mkdtemp call sites that never clean up: nested
    // dirs with files, exactly what teardown must reclaim wholesale.
    const leaked = join(runRoot, 'governor-test-abc123', 'nested');
    await mkdir(leaked, { recursive: true });
    await writeFile(join(leaked, 'signals.jsonl'), '{}\n', 'utf-8');

    await removeRunTmpRoot(runRoot);

    expect(existsSync(runRoot)).toBe(false);
    // The real tmpdir itself survives — only the run root is reclaimed.
    expect(await readdir(fakeRealTmpdir)).toEqual([]);
  });

  it('removes a run root containing a read-only fixture directory', async () => {
    const runRoot = await createRunTmpRoot(fakeRealTmpdir);
    const protectedDir = join(runRoot, 'fixture', '.pipeline');
    await mkdir(protectedDir, { recursive: true });
    await writeFile(join(protectedDir, 'task-status.json'), '{}\n', 'utf-8');
    await chmod(protectedDir, 0o555);

    await removeRunTmpRoot(runRoot);

    expect(existsSync(runRoot)).toBe(false);
  });

  it('treats an already-absent run root as success (interrupted run, manual cleanup)', async () => {
    const runRoot = await createRunTmpRoot(fakeRealTmpdir);
    await rm(runRoot, { recursive: true, force: true });

    await expect(removeRunTmpRoot(runRoot)).resolves.toBeUndefined();
  });

  it('snapshots top-level entry names, and reports a missing dir as not existing', async () => {
    await mkdir(join(fakeRealTmpdir, 'alpha'));
    await writeFile(join(fakeRealTmpdir, 'beta'), '', 'utf-8');

    const present = await snapshotTmpdirEntries(fakeRealTmpdir);
    expect(present.exists).toBe(true);
    expect([...present.entries].sort()).toEqual(['alpha', 'beta']);

    const missing = await snapshotTmpdirEntries(join(fakeRealTmpdir, 'does-not-exist'));
    expect(missing).toEqual({ exists: false, entries: [] });
  });
});

describe('tmpdir-leak-guard: diffTmpdirEntries', () => {
  it('classifies an entry that appeared outside the run root as stray', () => {
    const diff = diffTmpdirEntries(snap(['existing']), snap(['existing', 'governor-test-XyZ']));

    expect(diff.stray).toEqual(['governor-test-XyZ']);
    expect(diff.ignored).toEqual([]);
  });

  it('reports nothing when the run only added the run root and concurrent tooling noise', () => {
    const before = snap(['existing']);
    const after = snap([
      'existing',
      `${RUN_TMP_ROOT_PREFIX}A1b2C3`,
      'self-host-daemon-home',
      'claude-1000',
      '.X11-unix',
    ]);

    const diff = diffTmpdirEntries(before, after);

    expect(diff.stray).toEqual([]);
    expect(diff.ignored).toEqual([
      `${RUN_TMP_ROOT_PREFIX}A1b2C3`,
      'self-host-daemon-home',
      'claude-1000',
      '.X11-unix',
    ]);
  });

  it('reports nothing for a clean run that added no entries at all', () => {
    expect(diffTmpdirEntries(snap(['a', 'b']), snap(['a', 'b']))).toEqual({
      stray: [],
      ignored: [],
    });
  });

  it('ignores entries that DISAPPEARED — another process cleaning up is not a leak', () => {
    expect(diffTmpdirEntries(snap(['a', 'b']), snap(['a']))).toEqual({ stray: [], ignored: [] });
  });

  it('fails open when either snapshot failed, rather than calling every entry new', () => {
    const noBaseline = diffTmpdirEntries({ exists: false, entries: [] }, snap(['a', 'b']));
    expect(noBaseline).toEqual({ stray: [], ignored: [] });

    const noAfter = diffTmpdirEntries(snap(['a']), { exists: false, entries: [] });
    expect(noAfter).toEqual({ stray: [], ignored: [] });
  });

  it('honours an injected ignore list instead of the built-in one', () => {
    const diff = diffTmpdirEntries(snap([]), snap(['keep-me-1', 'governor-test-1']), ['keep-me-']);

    expect(diff.ignored).toEqual(['keep-me-1']);
    expect(diff.stray).toEqual(['governor-test-1']);
  });

  it('exempts the run root prefix by default so the guard never trips on its own root', () => {
    expect(IGNORED_TMPDIR_PREFIXES).toContain(RUN_TMP_ROOT_PREFIX);
  });
});

describe('tmpdir-leak-guard: applyTmpdirTeardownDecision', () => {
  it('throws naming the stray entries, so the leaking run fails', () => {
    const logged: string[] = [];

    expect(() =>
      applyTmpdirTeardownDecision(
        { stray: ['governor-test-1', 'authored-ledger-test-2'], ignored: [] },
        '/tmp',
        m => logged.push(m)
      )
    ).toThrow(/governor-test-1, authored-ledger-test-2/);

    expect(logged).toEqual([]);
  });

  it('passes silently on a clean run', () => {
    const logged: string[] = [];

    expect(() =>
      applyTmpdirTeardownDecision({ stray: [], ignored: [] }, '/tmp', m => logged.push(m))
    ).not.toThrow();

    expect(logged).toEqual([]);
  });

  it('warns but does not fail when only concurrent tooling wrote to the real tmpdir', () => {
    const logged: string[] = [];

    expect(() =>
      applyTmpdirTeardownDecision(
        { stray: [], ignored: ['self-host-abc'] },
        '/tmp',
        m => logged.push(m)
      )
    ).not.toThrow();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('self-host-abc');
  });

  it('still throws when stray entries accompany ignored ones — the warning cannot mask a leak', () => {
    const logged: string[] = [];

    expect(() =>
      applyTmpdirTeardownDecision(
        { stray: ['governor-test-1'], ignored: ['self-host-abc'] },
        '/tmp',
        m => logged.push(m)
      )
    ).toThrow(/governor-test-1/);

    expect(logged).toHaveLength(1);
  });
});
