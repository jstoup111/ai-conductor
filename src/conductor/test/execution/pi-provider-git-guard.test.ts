// Covers: task:1, task:3
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions } from 'execa';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { ManagedSessionContext } from '../../src/execution/managed-session-context.js';
import type { PiEnvironment, PiSubprocessFactory } from '../../src/execution/pi-provider.js';

const { mockEnsureGitGuardForDispatch } = vi.hoisted(() => ({
  mockEnsureGitGuardForDispatch: vi.fn(),
}));

vi.mock('../../src/engine/git-guard.js', () => ({
  ensureGitGuardForDispatch: (...args: Parameters<typeof mockEnsureGitGuardForDispatch>) =>
    mockEnsureGitGuardForDispatch(...args),
}));

vi.resetModules();

const [
  { PiProvider },
  { prepareManagedGhObservation },
] = await Promise.all([
  import('../../src/execution/pi-provider.js'),
  import('../../src/execution/managed-session-preparation.js'),
]);

const harnessPath = '/home/agent/.agents/skills/HARNESS.md';
const inheritedPath = '/usr/local/bin:/usr/bin';
const baseOptions: InvokeOptions = {
  prompt: 'Implement the requested change.',
  sessionId: 'pi-guard-session',
  resume: false,
  cwd: '/prepared',
};

function completePi() {
  return {
    stdout: JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Completed.' }] },
    }),
    stderr: '',
    exitCode: 0,
  };
}

function fakeEnvironment(): PiEnvironment {
  return {
    stat: async (path) => {
      if (path === harnessPath) return { isFile: () => true, isDirectory: () => false };
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
    env: { PATH: inheritedPath },
    homeDir: () => '/home/agent',
    cwd: () => '/prepared',
  };
}

describe('PiProvider git guard dispatch environment', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  let provider: InstanceType<typeof PiProvider>;
  const temporaryRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureGitGuardForDispatch.mockResolvedValue('/prepared/.pipeline/bin');
    spawn.mockResolvedValue(completePi());
    provider = new PiProvider('pi', spawn, fakeEnvironment());
  });

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.each([
    ['ordinary', undefined],
    ['self-host with an empty HOME', {
      executable: '/isolated/pi', env: { HOME: '' }, args: [], teardown: async () => {},
    }],
  ] as const)('prepends the guard to the materialized PATH for a $0 dispatch', async (_name, selfHost) => {
    const result = await provider.invoke({ ...baseOptions, ...(selfHost === undefined ? {} : { selfHost }) });
    const [, , launch] = spawn.mock.calls[0] as [string, readonly string[], ExecaOptions];

    expect(mockEnsureGitGuardForDispatch).toHaveBeenCalledWith('/prepared');
    expect((launch.env as NodeJS.ProcessEnv).PATH).toBe(`/prepared/.pipeline/bin:${inheritedPath}`);
    expect(result.gitGuardInstalled).toBe(true);
  });

  it('places the guard ahead of the prepared managed-session gh wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-provider-git-guard-'));
    temporaryRoots.push(root);
    const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-8');
    await mkdir(producerRoot, { recursive: true });
    const context: ManagedSessionContext = {
      projectRoot: root,
      worktreeRoot: root,
      producerRoot,
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      dispatchId: 'dispatch-8',
      provider: 'pi',
    };
    const prepared = await prepareManagedGhObservation({
      context,
      environment: { PATH: inheritedPath },
      resolveExecutable: async () => '/usr/bin/gh',
    });

    await provider.invoke({ ...baseOptions, managedSessionContext: context });
    const [, , launch] = spawn.mock.calls[0] as [string, readonly string[], ExecaOptions];

    expect((launch.env as NodeJS.ProcessEnv).PATH?.split(':').slice(0, 2)).toEqual([
      '/prepared/.pipeline/bin',
      prepared.wrapperDirectory,
    ]);
  });

  it('fails before launch when the git guard cannot be verified', async () => {
    const error = 'git guard repair failed: /prepared/.pipeline/bin/git: guard is not a regular executable file';
    mockEnsureGitGuardForDispatch.mockRejectedValue(new Error(error));

    const result = await provider.invoke(baseOptions);

    expect(mockEnsureGitGuardForDispatch).toHaveBeenCalledWith('/prepared');
    expect(result).toEqual({ success: false, output: error, exitCode: 1 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['an aborted run', (controller: AbortController) => {
      spawn.mockImplementationOnce(async () => {
        controller.abort();
        return completePi();
      });
      return { abortSignal: controller.signal };
    }],
    ['a missing Pi binary', () => {
      spawn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 127 });
      return {};
    }],
  ] as const)('reports guard installation after $0', async (_name, configure) => {
    const controller = new AbortController();
    const options = configure(controller);

    const result = await provider.invoke({ ...baseOptions, ...options });

    expect(result.gitGuardInstalled).toBe(true);
  });
});
