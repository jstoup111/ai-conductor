// Covers: task:1
// The bot identity read is a distinct, bot-only capability. The mocked child
// process boundary proves no real GitHub command is ever reached by this test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';

const boundary = {
  calls: [] as Array<{ args: string[]; options: Record<string, unknown> }>,
};

import { decodeGithubAmbientRead } from '../../src/engine/github-operations.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { ghLoginOwner } from '../../src/engine/owner-gate/identity.js';
import { createGithubTrackerClient, makeProductionGh, runBotIdentityRead } from '../../src/engine/tracker-client.js';

describe('bot identity read transport', () => {
  const root = '/fixture';
  const savedEnvironment = new Map<string, string | undefined>();
  let credential: { kind: 'configured'; tokenFile: string } | { kind: 'unconfigured' };
  let token: { kind: 'token'; token: string } | { kind: 'unavailable' };

  const makeTestGh = () => makeProductionGh({
    // This fixture owns the process boundary.  Supplying it to the production
    // adapter proves the mock is reached even if module mocks are reset.
    execFile: ((_file, args: string[], options: Record<string, unknown>, callback) => {
      boundary.calls.push({ args, options });
      const env = options.env as NodeJS.ProcessEnv | undefined;
      const stdout = args[0] === 'issue'
        ? '[]'
        : env?.GH_TOKEN === 'bot-token' ? '{"login":"conductor-bot"}' : 'operator-login\n';
      queueMicrotask(() => (callback as unknown as (error: null, result: { stdout: string; stderr: string }) => void)(null, { stdout, stderr: '' }));
      return {};
    }) as typeof execFileCb,
    readCredential: async () => credential,
    readToken: async () => token,
  });

  beforeEach(() => {
    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'GH_TOKEN']) savedEnvironment.set(key, process.env[key]);
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    process.env.GH_TOKEN = 'operator-token';
    credential = { kind: 'configured', tokenFile: '/fixture/bot-token' };
    token = { kind: 'token', token: 'bot-token' };
    boundary.calls.length = 0;
  });

  afterEach(() => {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    savedEnvironment.clear();
  });

  it('admits only gh api user for the bot identity operation and runs it with the bot credential', async () => {
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['api', 'user'] }).kind).toBe('accepted');
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['api', 'user', '--jq', '.login'] }).kind).toBe('refused');
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['auth', 'status'] }).kind).toBe('refused');

    await expect(runBotIdentityRead(makeTestGh(), root)).resolves.toBe('{"login":"conductor-bot"}');
    expect(boundary.calls).toEqual([{ args: ['api', 'user'], options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-token' }) }) }]);
    expect(process.env.GH_TOKEN).toBe('operator-token');
  });

  it('refuses an absent or unreadable bot token before spawning gh', async () => {
    credential = { kind: 'unconfigured' };
    await expect(runBotIdentityRead(makeTestGh(), root)).rejects.toBeInstanceOf(GithubBotAuthRefusalError);
    expect(boundary.calls).toEqual([]);

    credential = { kind: 'configured', tokenFile: '/fixture/missing-token' };
    token = { kind: 'unavailable' };
    await expect(runBotIdentityRead(makeTestGh(), root)).rejects.toMatchObject({ reason: 'token-unavailable' });
    expect(boundary.calls).toEqual([]);
  });

  it('keeps the existing operator identity read on the ambient operator credential', async () => {
    await expect(makeTestGh()(['api', 'user', '--jq', '.login'], { cwd: root, credential: 'operator' })).resolves.toEqual({ stdout: 'operator-login\n' });
    expect(boundary.calls).toEqual([{ args: ['api', 'user', '--jq', '.login'], options: expect.not.objectContaining({ env: expect.anything() }) }]);
  });

  it('keeps ownership and assigned-issue reads on the operator credential after resolving the bot identity', async () => {
    const gh = makeTestGh();

    await expect(runBotIdentityRead(gh, root)).resolves.toBe('{"login":"conductor-bot"}');
    await expect(ghLoginOwner(gh, root)).resolves.toEqual({ resolved: true, id: 'operator-login' });
    await expect(createGithubTrackerClient(gh).listAssignedIssues('acme/widgets', root)).resolves.toEqual([]);

    expect(boundary.calls.map(({ args }) => args)).toEqual([
      ['api', 'user'],
      ['api', 'user', '--jq', '.login'],
      ['issue', 'list', '--assignee', '@me', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '1000', '-R', 'acme/widgets'],
    ]);
    expect(boundary.calls[0]?.options).toEqual(expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-token' }) }));
    for (const { options } of boundary.calls.slice(1)) {
      expect(options).not.toHaveProperty('env');
    }
    expect(process.env.GH_TOKEN).toBe('operator-token');
  });
});
