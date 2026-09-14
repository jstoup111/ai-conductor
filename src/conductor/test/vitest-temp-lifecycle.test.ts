// Covers: task:6, task:7, task:8
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];
const environmentKeys = [
  'TMPDIR',
  'AI_CONDUCTOR_TEST_TMP_ROOT',
  'AI_CONDUCTOR_TEST_TMP_SCOPE',
  'AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR',
  'AI_CONDUCTOR_TEST_TMP_BASE',
  'GIT_CEILING_DIRECTORIES',
] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('./pipeline-leak-guard.js');
  vi.doUnmock('./park-leak-guard.js');
  vi.doUnmock('./tmpdir-leak-guard.js');
  vi.doUnmock('./tmux-leak-guard.js');
  vi.doUnmock('./signals-leak-guard.js');
  vi.doUnmock('./engine-dist-guard.js');
  vi.resetModules();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('relocated Vitest temporary lifecycle', () => {
  it('sweeps the original, selected, and nested parents and restores the caller environment on SIGINT', async () => {
    const fixture = await mkdtemp(join(process.env.AI_CONDUCTOR_TEST_TMP_ROOT ?? tmpdir(), 'vitest-temp-lifecycle-'));
    temporaryDirectories.push(fixture);
    const original = join(fixture, 'original');
    const selected = join(fixture, 'selected');
    const nested = join(selected, 'outer', 'child');
    const root = join(nested, 'ai-conductor-vitest-run-current');
    await mkdir(root, { recursive: true });
    const sweeps: string[] = [];
    const removed: string[] = [];
    const snapshotted: string[] = [];
    let leakedEntry = false;
    await mkdir(original, { recursive: true });
    vi.doMock('./pipeline-leak-guard.js', () => ({ snapshotPipeline: async () => ({ exists: false, entries: new Map() }), diffPipeline: () => ({ added: [], modified: [] }) }));
    vi.doMock('./park-leak-guard.js', () => ({ resolveRealParkedDir: async () => null, snapshotParkedMarkers: async () => ({ exists: false, markers: {} }), diffParkedMarkers: () => ({ added: [], removed: [], modified: [] }) }));
    vi.doMock('./tmpdir-leak-guard.js', () => ({
      RUN_TMP_ROOT_ENV: 'AI_CONDUCTOR_TEST_TMP_ROOT', RUN_TMP_ROOT_STALE_AFTER_MS: 1, RUN_TMP_ROOT_LEGACY_STALE_AFTER_MS: 1, RUN_TMP_ROOT_SWEEP_FAILURE_PREFIX: 'failure',
      writeRunRootOwnerMarker: () => {}, startRunRootHeartbeat: () => ({ stop: () => {} }),
      sweepStaleRunTmpRoots: async (parent: string) => { sweeps.push(parent); return { reaped: [], retained: [], failures: [] }; },
      removeRunTmpRoot: async (path: string) => { removed.push(path); },
      snapshotTmpdirEntries: async (path: string) => { snapshotted.push(path); return { exists: true, entries: leakedEntry ? new Set(['bypass-leak']) : new Set<string>() }; },
      diffTmpdirEntries: (_before: unknown, after: { entries: Set<string> }) => ({ stray: [...after.entries], ignored: [] }),
    }));
    vi.doMock('./tmux-leak-guard.js', () => ({ snapshotDaemonSessions: () => ({ sessions: [], failed: false }), sweepStaleDaemonSessions: () => ({ killed: [] }), reapLeakedDaemonSessions: () => ({ killed: [], indeterminate: [] }) }));
    vi.doMock('./signals-leak-guard.js', () => ({ snapshotEngineerSignals: async () => ({ exists: false, lines: [] }), diffEngineerSignals: () => ({ addedTestProjectLines: 0 }) }));
    vi.doMock('./engine-dist-guard.js', () => ({ ensureEngineDist: async () => false }));
    const callerEnvironment = {
      TMPDIR: root,
      AI_CONDUCTOR_TEST_TMP_ROOT: `${root}/.`,
      AI_CONDUCTOR_TEST_TMP_SCOPE: `${join(selected, 'outer')}/.`,
      AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR: original,
      GIT_CEILING_DIRECTORIES: '/caller/git-ceiling',
    };
    Object.assign(process.env, callerEnvironment);
    process.env.AI_CONDUCTOR_TEST_TMP_BASE = selected;
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { default: setup } = await import('./global-setup.js');
    const teardown = await setup();

    expect(sweeps).toEqual([original, selected, nested]);
    process.emit('SIGINT');
    vi.runAllTimers();
    expect(exit).toHaveBeenCalledWith(1);
    expect(process.env).toMatchObject(callerEnvironment);
    expect(removed).toEqual([]);
    await writeFile(join(original, 'bypass-leak'), 'must survive');
    leakedEntry = true;
    // Task 8: the leak guard must watch the SAVED original tmpdir — not the
    // relocated run root or the selected storage parent — before and after.
    const failure = await teardown().then(() => undefined, (err: unknown) => err as Error);
    expect(failure?.message).toContain('bypass-leak');
    expect(failure?.message).toContain(original);
    expect(snapshotted).toEqual([original, original]);
    expect(existsSync(join(original, 'bypass-leak'))).toBe(true);
    expect(process.env).toMatchObject(callerEnvironment);
    expect(removed).toEqual([]);
  });

  for (const [name, pipelineLeak] of [
    ['on successful teardown', false],
    ['when a teardown guard fails', true],
  ] as const) {
    it(`reclaims a root allocated by this process's config ${name}`, async () => {
      const fixture = await mkdtemp(join(process.env.AI_CONDUCTOR_TEST_TMP_ROOT ?? tmpdir(), 'vitest-temp-lifecycle-'));
      temporaryDirectories.push(fixture);
      const original = join(fixture, 'original');
      const selected = join(fixture, 'selected');
      const removed: string[] = [];
      await Promise.all([mkdir(original, { recursive: true }), mkdir(selected, { recursive: true })]);
      vi.doMock('./pipeline-leak-guard.js', () => ({
        snapshotPipeline: async () => ({ exists: false, entries: new Map() }),
        diffPipeline: () => ({ added: pipelineLeak ? ['guard-failure'] : [], modified: [] }),
      }));
      vi.doMock('./park-leak-guard.js', () => ({ resolveRealParkedDir: async () => null, snapshotParkedMarkers: async () => ({ exists: false, markers: {} }), diffParkedMarkers: () => ({ added: [], removed: [], modified: [] }) }));
      vi.doMock('./tmpdir-leak-guard.js', () => ({
        RUN_TMP_ROOT_ENV: 'AI_CONDUCTOR_TEST_TMP_ROOT', RUN_TMP_ROOT_STALE_AFTER_MS: 1, RUN_TMP_ROOT_LEGACY_STALE_AFTER_MS: 1, RUN_TMP_ROOT_SWEEP_FAILURE_PREFIX: 'failure',
        writeRunRootOwnerMarker: () => {}, startRunRootHeartbeat: () => ({ stop: () => {} }),
        sweepStaleRunTmpRoots: async () => ({ reaped: [], retained: [], failures: [] }),
        removeRunTmpRoot: async (path: string) => { removed.push(path); },
        snapshotTmpdirEntries: async () => ({ exists: true, entries: new Set<string>() }),
        diffTmpdirEntries: () => ({ stray: [], ignored: [] }),
      }));
      vi.doMock('./tmux-leak-guard.js', () => ({ snapshotDaemonSessions: () => ({ sessions: [], failed: false }), sweepStaleDaemonSessions: () => ({ killed: [] }), reapLeakedDaemonSessions: () => ({ killed: [], indeterminate: [] }) }));
      vi.doMock('./signals-leak-guard.js', () => ({ snapshotEngineerSignals: async () => ({ exists: false, lines: [] }), diffEngineerSignals: () => ({ addedTestProjectLines: 0 }) }));
      vi.doMock('./engine-dist-guard.js', () => ({ ensureEngineDist: async () => false }));
      delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      delete process.env.AI_CONDUCTOR_TEST_TMP_SCOPE;
      delete process.env.AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR;
      Object.assign(process.env, { TMPDIR: original, AI_CONDUCTOR_TEST_TMP_BASE: selected });
      const { installVitestTmpRoot } = await import('../scripts/vitest-temp.mjs');
      const configInstallation = installVitestTmpRoot();
      const callerEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
      const { default: setup } = await import('./global-setup.js');
      const teardown = await setup();

      if (pipelineLeak) {
        await expect(teardown()).rejects.toThrow(/guard-failure/);
      } else {
        await expect(teardown()).resolves.toBeUndefined();
      }
      expect(removed).toEqual([configInstallation.root]);
      expect(existsSync(selected)).toBe(true);
      expect(process.env).toMatchObject(callerEnvironment);
    });
  }
});
