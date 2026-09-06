// Covers: task:1, task:2
// Unit tests for the tmpdir leak guard (#1112) — the redirect helpers, the
// pure stray/ignored classification, and the throw-vs-warn teardown decision.
// No vitest wiring involved: each seam is exercised directly, the same split
// used by signals-leak-guard.test.ts and global-setup-engineer-signals.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRunTmpRoot,
  ensureRunTmpRootSync,
  removeRunTmpRoot,
  RUN_TMP_ROOT_ENV,
  RUN_TMP_ROOT_OWNER_MARKER,
  startRunRootHeartbeat,
  snapshotTmpdirEntries,
  diffTmpdirEntries,
  decideStaleRunRoots,
  writeRunRootOwnerMarker,
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

describe('tmpdir-leak-guard: owner marker', () => {
  let fixtureRoot: string;
  const owner = { pid: 42, hostname: 'test-host', startedAt: '2026-09-05T12:00:00.000Z' };

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'tmpdir-guard-owner-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('writes the owner identity to the marker and gives it an mtime', async () => {
    const runRoot = join(fixtureRoot, 'run-root');
    await mkdir(runRoot);

    writeRunRootOwnerMarker(runRoot, owner);

    const marker = join(runRoot, RUN_TMP_ROOT_OWNER_MARKER);
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual(owner);
    expect((await stat(marker)).mtimeMs).toBeGreaterThan(0);
  });

  it('refreshes only the marker mtime on every heartbeat interval', async () => {
    vi.useFakeTimers();
    const runRoot = join(fixtureRoot, 'run-root');
    await mkdir(runRoot);
    writeRunRootOwnerMarker(runRoot, owner);
    const marker = join(runRoot, RUN_TMP_ROOT_OWNER_MARKER);
    const rootEntries = await readdir(runRoot);
    const parentEntries = await readdir(fixtureRoot);
    const firstMtime = (await stat(marker)).mtimeMs;

    // The initial write uses the real filesystem clock; begin the fake clock
    // after it so each virtual heartbeat is observably newer.
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
    const heartbeat = startRunRootHeartbeat(runRoot, { intervalMs: 1_000, logger: vi.fn() });
    await vi.advanceTimersByTimeAsync(1_000);
    const secondMtime = (await stat(marker)).mtimeMs;
    await vi.advanceTimersByTimeAsync(1_000);
    const thirdMtime = (await stat(marker)).mtimeMs;
    heartbeat.stop();

    expect(secondMtime).toBeGreaterThan(firstMtime);
    expect(thirdMtime).toBeGreaterThan(secondMtime);
    expect(await readdir(runRoot)).toEqual(rootEntries);
    expect(await readdir(fixtureRoot)).toEqual(parentEntries);
  });

  it('stops refreshing the marker after stop is called', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    const runRoot = join(fixtureRoot, 'run-root');
    await mkdir(runRoot);
    writeRunRootOwnerMarker(runRoot, owner);
    const marker = join(runRoot, RUN_TMP_ROOT_OWNER_MARKER);
    const heartbeat = startRunRootHeartbeat(runRoot, { intervalMs: 1_000, logger: vi.fn() });

    await vi.advanceTimersByTimeAsync(1_000);
    heartbeat.stop();
    const stoppedMtime = (await stat(marker)).mtimeMs;
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await stat(marker)).mtimeMs).toBe(stoppedMtime);
  });

  it('fails open and logs once when the root disappears before a heartbeat tick', async () => {
    vi.useFakeTimers();
    const runRoot = join(fixtureRoot, 'run-root');
    await mkdir(runRoot);
    writeRunRootOwnerMarker(runRoot, owner);
    const logger = vi.fn();
    const heartbeat = startRunRootHeartbeat(runRoot, { intervalMs: 1_000, logger });
    await rm(runRoot, { recursive: true, force: true });

    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    heartbeat.stop();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/^tmpdir-leak-guard: owner marker /));
  });

  it('fails open and logs once when the owner marker cannot be written', () => {
    const logger = vi.fn();

    expect(() => writeRunRootOwnerMarker(join(fixtureRoot, 'missing-root'), owner, logger)).not.toThrow();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/^tmpdir-leak-guard: owner marker /));
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
      'moshi-codex-rl.json.tmp',
      '.X11-unix',
    ]);

    const diff = diffTmpdirEntries(before, after);

    expect(diff.stray).toEqual([]);
    expect(diff.ignored).toEqual([
      `${RUN_TMP_ROOT_PREFIX}A1b2C3`,
      'self-host-daemon-home',
      'claude-1000',
      'moshi-codex-rl.json.tmp',
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

describe('tmpdir-leak-guard: stale run root decision', () => {
  const now = 1_000_000;
  const staleAfterMs = 10_000;
  const legacyStaleAfterMs = 86_400_000;
  const root = (suffix: string) => `${RUN_TMP_ROOT_PREFIX}${suffix}`;

  it('reaps a root whose owner marker heartbeat is stale and ignores unrelated entries', () => {
    expect(
      decideStaleRunRoots({
        entries: [
          {
            name: root('stale-marker'),
            isDirectory: true,
            dirMtimeMs: now,
            marker: { kind: 'present', mtimeMs: now - staleAfterMs - 1 },
          },
          {
            name: 'unrelated-stale-entry',
            isDirectory: true,
            dirMtimeMs: now,
            marker: { kind: 'present', mtimeMs: 0 },
          },
        ],
        ownRoot: '/tmp/another-run-root',
        now,
        staleAfterMs,
        legacyStaleAfterMs,
      })
    ).toEqual({ reap: [root('stale-marker')], retain: [] });
  });

  it('retains fresh markers, including two concurrent roots created within one second', () => {
    const decision = decideStaleRunRoots({
      entries: [
        {
          name: root('fresh-a'),
          isDirectory: true,
          dirMtimeMs: now,
          marker: { kind: 'present', mtimeMs: now },
        },
        {
          name: root('fresh-b'),
          isDirectory: true,
          dirMtimeMs: now,
          marker: { kind: 'present', mtimeMs: now - 1_000 },
        },
      ],
      ownRoot: '/tmp/another-run-root',
      now,
      staleAfterMs,
      legacyStaleAfterMs,
    });

    expect(decision).toEqual({
      reap: [],
      retain: [
        { name: root('fresh-a'), reason: 'live' },
        { name: root('fresh-b'), reason: 'live' },
      ],
    });
  });

  it('retains its own root even when its owner marker is stale', () => {
    expect(
      decideStaleRunRoots({
        entries: [
          {
            name: root('own'),
            isDirectory: true,
            dirMtimeMs: now - legacyStaleAfterMs - 1,
            marker: { kind: 'present', mtimeMs: 0 },
          },
        ],
        ownRoot: `/tmp/${root('own')}`,
        now,
        staleAfterMs,
        legacyStaleAfterMs,
      })
    ).toEqual({ reap: [], retain: [{ name: root('own'), reason: 'own-root' }] });
  });

  it('reaps only legacy unmarked directories older than the fallback window', () => {
    const decision = decideStaleRunRoots({
      entries: [
        {
          name: root('legacy'),
          isDirectory: true,
          dirMtimeMs: now - legacyStaleAfterMs - 1,
          marker: { kind: 'absent' },
        },
        {
          name: root('recent'),
          isDirectory: true,
          dirMtimeMs: now - legacyStaleAfterMs + 1,
          marker: { kind: 'absent' },
        },
      ],
      ownRoot: '/tmp/another-run-root',
      now,
      staleAfterMs,
      legacyStaleAfterMs,
    });

    expect(decision).toEqual({
      reap: [root('legacy')],
      retain: [{ name: root('recent'), reason: 'unmarked-recent' }],
    });
  });

  it('retains unreadable markers and non-directory entries without following them', () => {
    expect(
      decideStaleRunRoots({
        entries: [
          {
            name: root('unreadable'),
            isDirectory: true,
            dirMtimeMs: now - legacyStaleAfterMs - 1,
            marker: { kind: 'unreadable', error: 'EACCES' },
          },
          {
            name: root('symlink'),
            isDirectory: false,
            dirMtimeMs: now - legacyStaleAfterMs - 1,
            marker: { kind: 'present', mtimeMs: 0 },
          },
        ],
        ownRoot: '/tmp/another-run-root',
        now,
        staleAfterMs,
        legacyStaleAfterMs,
      })
    ).toEqual({
      reap: [],
      retain: [
        { name: root('unreadable'), reason: 'marker-unreadable' },
        { name: root('symlink'), reason: 'not-a-directory' },
      ],
    });
  });

  it('honours a caller-provided staleness window and has no filesystem seam', () => {
    const entry = {
      name: root('custom-window'),
      isDirectory: true,
      dirMtimeMs: now,
      marker: { kind: 'present' as const, mtimeMs: now - 101 },
    };
    const customInput = {
      entries: [
        entry,
      ],
      ownRoot: '/tmp/another-run-root',
      now,
      staleAfterMs: 100,
      legacyStaleAfterMs,
    };

    const first = decideStaleRunRoots(customInput);
    const second = decideStaleRunRoots(customInput);

    expect(first).toEqual({
      reap: [root('custom-window')],
      retain: [],
    });
    expect(second).toEqual(first);
    expect(
      decideStaleRunRoots({ ...customInput, staleAfterMs })
    ).toEqual({
      reap: [],
      retain: [{ name: root('custom-window'), reason: 'live' }],
    });
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
