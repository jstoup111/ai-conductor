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
    const fixture = await mkdtemp(join(tmpdir(), 'vitest-temp-lifecycle-'));
    temporaryDirectories.push(fixture);
    const original = join(fixture, 'original');
    const selected = join(fixture, 'selected');
    const nested = join(selected, 'outer', 'child');
    const root = join(nested, 'ai-conductor-vitest-run-current');
    await mkdir(root, { recursive: true });
    const sweeps: string[] = [];
    const removed: string[] = [];
    let leakedEntry = false;
    await mkdir(original, { recursive: true });
    vi.doMock('./pipeline-leak-guard.js', () => ({ snapshotPipeline: async () => ({ exists: false, entries: new Map() }), diffPipeline: () => ({ added: [], modified: [] }) }));
    vi.doMock('./park-leak-guard.js', () => ({ resolveRealParkedDir: async () => null, snapshotParkedMarkers: async () => ({ exists: false, markers: {} }), diffParkedMarkers: () => ({ added: [], removed: [], modified: [] }) }));
    vi.doMock('./tmpdir-leak-guard.js', () => ({
      RUN_TMP_ROOT_ENV: 'AI_CONDUCTOR_TEST_TMP_ROOT', RUN_TMP_ROOT_STALE_AFTER_MS: 1, RUN_TMP_ROOT_LEGACY_STALE_AFTER_MS: 1, RUN_TMP_ROOT_SWEEP_FAILURE_PREFIX: 'failure',
      writeRunRootOwnerMarker: () => {}, startRunRootHeartbeat: () => ({ stop: () => {} }),
      sweepStaleRunTmpRoots: async (parent: string) => { sweeps.push(parent); return { reaped: [], retained: [], failures: [] }; },
      removeRunTmpRoot: async (path: string) => { removed.push(path); },
      snapshotTmpdirEntries: async () => ({ exists: true, entries: leakedEntry ? new Set(['bypass-leak']) : new Set<string>() }),
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
    await expect(teardown()).rejects.toThrow(/bypass-leak/);
    expect(existsSync(join(original, 'bypass-leak'))).toBe(true);
    expect(process.env).toMatchObject(callerEnvironment);
    expect(removed).toEqual([]);
  });
});
