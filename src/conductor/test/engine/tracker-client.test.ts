import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';

const productionGh = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  stdout: '',
}));

// The production adapter is the subject of the credential tests below. Keep
// its only process boundary fake even if the real-exec guard is rolled back.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_file, _args, _options, callback) => {
      queueMicrotask(() => callback(productionGh.error, { stdout: productionGh.stdout, stderr: '' }));
      return {};
    }),
  };
});

const botCredential = vi.hoisted(() => ({
  credential: { kind: 'unconfigured' } as { kind: 'unconfigured' } | { kind: 'configured'; tokenFile: string },
  token: { kind: 'unavailable' } as { kind: 'unavailable' } | { kind: 'token'; token: string },
}));

vi.mock('../../src/engine/github-bot-credential.js', () => ({
  readGithubBotCredential: vi.fn(async () => botCredential.credential),
  readGithubBotToken: vi.fn(async () => botCredential.token),
}));

import {
  createGithubTrackerClient,
  makeProductionGh,
  type GhRunner,
} from '../../src/engine/tracker-client.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';

const EFFECT_MARKER = '<!-- ai-conductor:remediation-effect:effect-123 -->';

function fakeRunner(stdout: string): {
  runner: GhRunner;
  calls: Array<{ args: string[]; opts: { cwd: string } }>;
} {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  const runner: GhRunner = async (args, opts) => {
    calls.push({ args, opts });
    return { stdout };
  };
  return { runner, calls };
}

function expectedSearchCall(): { args: string[]; opts: { cwd: string } } {
  return {
    args: [
      'issue',
      'list',
      '--state',
      'all',
      '--search',
      `"${EFFECT_MARKER}" in:body`,
      '--json',
      'url,body',
      '--limit',
      '2',
      '-R',
      'acme/intake',
    ],
    opts: { cwd: '/worktree' },
  };
}

describe('createGithubTrackerClient.findIssueByEffectMarker', () => {
  it('returns an open issue with the exact marker and searches every issue state in the configured repository', async () => {
    const { runner, calls } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/41', body: `Observed\n${EFFECT_MARKER}\nImpact` },
    ]));

    const found = await createGithubTrackerClient(runner).findIssueByEffectMarker(
      EFFECT_MARKER,
      'acme/intake',
      '/worktree',
    );

    expect(found).toBe('https://github.com/acme/intake/issues/41');
    expect(calls).toEqual([expectedSearchCall()]);
  });

  it('returns a closed issue with the exact marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/42', body: `${EFFECT_MARKER}\nClosed after triage` },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBe('https://github.com/acme/intake/issues/42');
  });

  it('returns null when no issue has the marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      { url: 'https://github.com/acme/intake/issues/43', body: 'No remediation marker here.' },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBeNull();
  });

  it('does not mistake a similar marker for the reserved effect marker', async () => {
    const { runner } = fakeRunner(JSON.stringify([
      {
        url: 'https://github.com/acme/intake/issues/44',
        body: '<!-- ai-conductor:remediation-effect:effect-1234 -->',
      },
    ]));

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).resolves.toBeNull();
  });

  it('propagates malformed search output as a named parse error', async () => {
    const { runner } = fakeRunner('not json');

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).rejects.toThrow(/findIssueByEffectMarker/);
  });

  it('propagates runner failures as a typed gh error', async () => {
    const runner: GhRunner = async () => {
      const error = new Error('authentication failed') as Error & { code: number; stderr: string };
      error.code = 1;
      error.stderr = 'HTTP 401';
      throw error;
    };

    await expect(
      createGithubTrackerClient(runner).findIssueByEffectMarker(EFFECT_MARKER, 'acme/intake', '/worktree'),
    ).rejects.toMatchObject({
      name: 'GhRunnerError',
      argv: expectedSearchCall().args,
      stderr: 'HTTP 401',
    });
  });
});

describe('createGithubTrackerClient.readPullRequestMergeState', () => {
  it('uses the single typed PR-view operation and preserves classified runner failures', async () => {
    const calls: string[][] = [];
    const runner: GhRunner = async (args) => {
      calls.push(args);
      throw new Error('upstream unavailable');
    };

    const state = await createGithubTrackerClient(runner).readPullRequestMergeState(
      'https://github.com/acme/widget/pull/7',
      '/worktree',
    );

    expect(calls).toEqual([[
      'pr', 'view', 'https://github.com/acme/widget/pull/7',
      '--json', 'state,mergeable,statusCheckRollup,labels,isDraft,body',
    ]]);
    expect(state).toMatchObject({ state: 'UNKNOWN', readFailure: { kind: 'runner' } });
  });
});

describe('makeProductionGh bot write credential', () => {
  const savedEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.mocked(execFileCb).mockClear();
    productionGh.error = undefined;
    productionGh.stdout = '{"login":"bot"}';
    botCredential.credential = { kind: 'unconfigured' };
    botCredential.token = { kind: 'unavailable' };
    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'GH_TOKEN', 'GITHUB_TOKEN']) {
      savedEnvironment.set(key, process.env[key]);
    }
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
  });

  afterEach(() => {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEnvironment.clear();
  });

  it('injects the configured bot token into only the child environment without changing the operator environment', async () => {
    process.env.GH_TOKEN = 'operator-token';
    process.env.GITHUB_TOKEN = 'operator-github-token';
    const environmentBefore = { ...process.env };
    botCredential.credential = { kind: 'configured', tokenFile: '/private/bot-token' };
    botCredential.token = { kind: 'token', token: 'bot-token' };

    await makeProductionGh()(['api', 'user'], { cwd: '/worktree', credential: 'write' });

    // First prove the production adapter reached the mocked process boundary.
    expect(execFileCb).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileCb).mock.calls[0]?.slice(0, 3)).toEqual(['gh', ['api', 'user'], {
      cwd: '/worktree',
      maxBuffer: 32 * 1024 * 1024,
      timeout: undefined,
      env: { ...environmentBefore, GH_TOKEN: 'bot-token' },
    }]);
    expect(process.env.GH_TOKEN).toBe('operator-token');
    expect(process.env.GITHUB_TOKEN).toBe('operator-github-token');
  });

  it.each([
    ['operator credential', { credential: 'operator' as const }],
    ['no credential hint', {}],
  ])('leaves the child environment ambient for %s', async (_label, options) => {
    await makeProductionGh()(['api', 'user'], { cwd: '/worktree', ...options });

    expect(execFileCb).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileCb).mock.calls[0]?.[2]).toEqual({
      cwd: '/worktree',
      maxBuffer: 32 * 1024 * 1024,
      timeout: undefined,
    });
  });

  it('leaves the child environment ambient when no bot is configured', async () => {
    await makeProductionGh()(['api', 'user'], { cwd: '/worktree', credential: 'write' });

    expect(execFileCb).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileCb).mock.calls[0]?.[2]).toEqual({
      cwd: '/worktree',
      maxBuffer: 32 * 1024 * 1024,
      timeout: undefined,
    });
  });

  it('refuses an unavailable configured bot token before spawning', async () => {
    botCredential.credential = { kind: 'configured', tokenFile: '/private/missing-token' };

    await expect(makeProductionGh()(['api', 'user'], { cwd: '/worktree', credential: 'write' }))
      .rejects.toMatchObject({ name: 'GithubBotAuthRefusalError', reason: 'token-unavailable' });
    expect(execFileCb).not.toHaveBeenCalled();
  });

  it('converts a bot authentication refusal to a secret-safe typed error', async () => {
    botCredential.credential = { kind: 'configured', tokenFile: '/private/bot-token' };
    botCredential.token = { kind: 'token', token: 'bot-token' };
    const failure = new Error('gh refused bot-token') as Error & { stderr: string };
    failure.stderr = 'HTTP 401: Bad credentials';
    productionGh.error = failure;

    const attempt = makeProductionGh()(['api', 'user'], { cwd: '/worktree', credential: 'write' });
    const rejected = attempt.catch((error: unknown) => error);
    await vi.waitFor(() => expect(execFileCb).toHaveBeenCalledTimes(1));
    await expect(rejected).resolves.toBeInstanceOf(GithubBotAuthRefusalError);
    await expect(makeProductionGh()(['api', 'user'], { cwd: '/worktree', credential: 'write' }))
      .rejects.toMatchObject({ reason: 'auth-refused', message: expect.not.stringContaining('bot-token') });
  });
});
