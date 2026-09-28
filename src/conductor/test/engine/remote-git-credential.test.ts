// Covers: task:7
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execa: vi.fn(),
  assertRealExecAllowed: vi.fn(),
  readCredential: vi.fn(),
  readToken: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mocks.execFile };
});
vi.mock('execa', () => ({ execa: mocks.execa }));
vi.mock('../../src/engine/tracker-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/tracker-client.js')>();
  return { ...actual, assertRealExecAllowed: mocks.assertRealExecAllowed };
});
vi.mock('../../src/engine/github-bot-credential.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/github-bot-credential.js')>();
  return { ...actual, readGithubBotCredential: mocks.readCredential, readGithubBotToken: mocks.readToken };
});

import { pushRefreshedBranch } from '../../src/engine/autoresolve.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { makeProductionGit } from '../../src/engine/pr-labels.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

const token = 'task-7-bot-token';
const tokenFile = '/private/task-7-bot-token';

function configuredBot(): void {
  mocks.readCredential.mockResolvedValue({ kind: 'configured', tokenFile });
  mocks.readToken.mockResolvedValue({ kind: 'token', token });
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/repo', defaultBranch: 'main', specBranch: 'feature/topic',
      featureMarker: '.docs/intake/topic.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: alice\n' }] },
    },
  };
}

function expectedWriteEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_1: '!gh auth git-credential',
  };
}

describe('remote Git write credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCredential.mockResolvedValue({ kind: 'unconfigured' });
    mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '', '');
    });
    mocks.execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('makes production git reach the mocked process boundary with a bot-only HTTPS credential environment', async () => {
    configuredBot();
    const args = ['push', 'origin', 'HEAD:refs/heads/topic'];

    await makeProductionGit()(args, { cwd: '/fixture', credential: 'write', endpoint: 'https' });

    // The process adapter is the boundary under test; prove it was reached before inspecting its options.
    expect(mocks.execFile).toHaveBeenCalledOnce();
    expect(mocks.execFile).toHaveBeenCalledWith('git', args, expect.objectContaining({
      cwd: '/fixture', env: expectedWriteEnvironment(),
    }), expect.any(Function));
  });

  it('keeps the production runner ambient without a write credential hint', async () => {
    await makeProductionGit()(['push', 'origin', 'HEAD:refs/heads/topic'], { cwd: '/fixture' });

    expect(mocks.execFile).toHaveBeenCalledOnce();
    expect(mocks.execFile.mock.calls[0][2]).toEqual({ cwd: '/fixture', maxBuffer: 32 * 1024 * 1024 });
  });

  it('makes the rebase runner reach execa with the same bot-only HTTPS credential environment', async () => {
    configuredBot();
    const args = ['push', 'origin', 'HEAD:refs/heads/topic'];

    await makeGitRunner('/fixture')(args, { credential: 'write', endpoint: 'https' });

    expect(mocks.execa).toHaveBeenCalledOnce();
    expect(mocks.execa).toHaveBeenCalledWith('git', args, { cwd: '/fixture', reject: false, env: expectedWriteEnvironment() });
  });

  it('keeps the rebase runner ambient without a write credential hint', async () => {
    await makeGitRunner('/fixture')(['push', 'origin', 'HEAD:refs/heads/topic']);

    expect(mocks.execa).toHaveBeenCalledOnce();
    expect(mocks.execa.mock.calls[0][2]).toEqual({ cwd: '/fixture', reject: false });
  });

  it('refuses unavailable tokens and SSH write hints before either process boundary', async () => {
    mocks.readCredential.mockResolvedValue({ kind: 'configured', tokenFile });
    mocks.readToken.mockResolvedValue({ kind: 'unavailable' });
    await expect(makeProductionGit()(['push'], { cwd: '/fixture', credential: 'write', endpoint: 'https' }))
      .rejects.toMatchObject({ reason: 'token-unavailable' } satisfies Partial<GithubBotAuthRefusalError>);
    expect(mocks.execFile).not.toHaveBeenCalled();

    configuredBot();
    await expect(makeGitRunner('/fixture')(['push'], { credential: 'write', endpoint: 'ssh' }))
      .rejects.toMatchObject({ reason: 'unsupported-remote-transport' } satisfies Partial<GithubBotAuthRefusalError>);
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it('converts an authenticated push refusal into the typed fallback signal', async () => {
    configuredBot();
    mocks.execa.mockResolvedValue({
      exitCode: 1, stdout: '', stderr: "fatal: Authentication failed for 'https://github.com/acme/repo.git/'",
    });

    await expect(makeGitRunner('/fixture')(['push', 'origin', 'HEAD:refs/heads/topic'], { credential: 'write', endpoint: 'https' }))
      .rejects.toMatchObject({ reason: 'auth-refused' } satisfies Partial<GithubBotAuthRefusalError>);
    expect(mocks.execa).toHaveBeenCalledOnce();
  });

  it('forwards the write credential hint through autoresolve’s inline remote runner', async () => {
    const calls: Array<{ args: string[]; options: unknown }> = [];
    const git = vi.fn(async (args: string[], options?: unknown) => {
      calls.push({ args, options });
      if (args.join(' ') === 'remote get-url --push origin') return { exitCode: 0, stdout: 'https://github.com/acme/repo.git\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(pushRefreshedBranch(git, 'feature/topic', undefined, { mutation: mutation() }))
      .resolves.toEqual({ pushed: true });
    expect(calls.find((call) => call.args[0] === 'push')).toEqual({
      args: ['push', 'origin', 'HEAD:refs/heads/feature/topic', '--force-with-lease'],
      options: { cwd: '.', credential: 'write', endpoint: 'https' },
    });
  });
});
