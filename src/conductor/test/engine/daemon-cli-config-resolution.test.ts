import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDaemonMode } from '../../src/daemon-cli.js';

vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engine/ci-fix.js')>();
  return {
    ...original,
    defaultCiFixProbe: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
});

vi.mock('../../src/engine/daemon-lock.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engine/daemon-lock.js')>();
  return {
    ...original,
    holdLock: async () => ({
      owned: true,
      pid: 1,
      uuid: 'test-daemon-lock',
      release: async () => {},
      releaseSync: () => {},
    }),
  };
});

vi.mock('../../src/engine/daemon-log.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engine/daemon-log.js')>();
  return {
    ...original,
    openDaemonLog: async () => ({
      write: () => {},
      close: async () => {},
      closeSync: () => {},
    }),
  };
});

const workDirs: string[] = [];
let savedHome: string | undefined;
let savedSelfGuard: string | undefined;
let savedSelfVersion: string | undefined;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

afterEach(async () => {
  vi.restoreAllMocks();
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  savedHome = undefined;
  if (savedSelfGuard === undefined) delete process.env.CONDUCT_ENGINE_SELF_GUARD;
  else process.env.CONDUCT_ENGINE_SELF_GUARD = savedSelfGuard;
  if (savedSelfVersion === undefined) delete process.env.CONDUCT_ENGINE_SELF_VERSION;
  else process.env.CONDUCT_ENGINE_SELF_VERSION = savedSelfVersion;
  savedSelfGuard = undefined;
  savedSelfVersion = undefined;
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runDaemonMode configuration resolution', () => {
  it('uses a user-only provider selection before backlog dispatch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'daemon-config-user-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-config-project-'));
    workDirs.push(home, projectRoot);
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'llm_provider: [codex, ghost-user-tail]\n',
      'utf8',
    );
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'auto_restart_on_stale_engine: false\n',
      'utf8',
    );
    savedHome = process.env.HOME;
    savedSelfGuard = process.env.CONDUCT_ENGINE_SELF_GUARD;
    savedSelfVersion = process.env.CONDUCT_ENGINE_SELF_VERSION;
    process.env.HOME = home;
    vi.spyOn(process, 'once').mockImplementation((() => process) as typeof process.once);
    vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
    const discover = vi.fn(async () => []);

    let errorMessage: string | undefined;
    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        workSource: { discover },
        watch: false,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect({ errorMessage, dispatchCount: discover.mock.calls.length }).toEqual({
      errorMessage: expect.stringMatching(
        /llm_provider names unknown provider "ghost-user-tail"/,
      ),
      dispatchCount: 0,
    });
  });
});
