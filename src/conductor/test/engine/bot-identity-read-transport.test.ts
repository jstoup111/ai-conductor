// Covers: task:1
// The bot identity read is a distinct, bot-only capability. The mocked child
// process boundary proves no real GitHub command is ever reached by this test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[]; options: Record<string, unknown> }>,
}));

// setup.ts imports engine modules before this file's mock is registered.
// Reset the cached graph so the production adapter reaches this fake boundary.
vi.hoisted(() => { vi.resetModules(); });
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_file, args: string[], options: Record<string, unknown>, callback) => {
      boundary.calls.push({ args, options });
      const env = options.env as NodeJS.ProcessEnv | undefined;
      const stdout = args[0] === 'issue'
        ? '[]'
        : env?.GH_TOKEN === 'bot-token' ? '{"login":"conductor-bot"}' : 'operator-login\n';
      queueMicrotask(() => callback(null, { stdout, stderr: '' }));
      return {};
    }),
  };
});

import { decodeGithubAmbientRead } from '../../src/engine/github-operations.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { ghLoginOwner } from '../../src/engine/owner-gate/identity.js';
import { createGithubTrackerClient, makeProductionGh, runBotIdentityRead } from '../../src/engine/tracker-client.js';

describe('bot identity read transport', () => {
  let root: string;
  const savedEnvironment = new Map<string, string | undefined>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bot-identity-read-transport-'));
    const home = join(root, 'home');
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, 'bot-token'), 'bot-token\n');
    await writeFile(join(home, '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${join(root, 'bot-token')}\n`);
    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'AI_CONDUCTOR_USER_CONFIG_DIR', 'GH_TOKEN', 'HOME']) savedEnvironment.set(key, process.env[key]);
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    process.env.GH_TOKEN = 'operator-token';
    process.env.HOME = home;
    boundary.calls.length = 0;
    vi.mocked(execFileCb).mockClear();
  });

  afterEach(async () => {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    savedEnvironment.clear();
    await rm(root, { recursive: true, force: true });
  });

  it('admits only gh api user for the bot identity operation and runs it with the bot credential', async () => {
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['api', 'user'] }).kind).toBe('accepted');
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['api', 'user', '--jq', '.login'] }).kind).toBe('refused');
    expect(decodeGithubAmbientRead({ operation: 'ambient.bot-identity.read', args: ['auth', 'status'] }).kind).toBe('refused');

    await expect(runBotIdentityRead(makeProductionGh(), root)).resolves.toBe('{"login":"conductor-bot"}');
    expect(boundary.calls).toEqual([{ args: ['api', 'user'], options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-token' }) }) }]);
    expect(process.env.GH_TOKEN).toBe('operator-token');
  });

  it('refuses an absent or unreadable bot token before spawning gh', async () => {
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), '');
    await expect(runBotIdentityRead(makeProductionGh(), root)).rejects.toBeInstanceOf(GithubBotAuthRefusalError);
    expect(boundary.calls).toEqual([]);

    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${join(root, 'missing-token')}\n`);
    await expect(runBotIdentityRead(makeProductionGh(), root)).rejects.toMatchObject({ reason: 'token-unavailable' });
    expect(boundary.calls).toEqual([]);
  });

  it('keeps the existing operator identity read on the ambient operator credential', async () => {
    await expect(makeProductionGh()(['api', 'user', '--jq', '.login'], { cwd: root, credential: 'operator' })).resolves.toEqual({ stdout: 'operator-login\n' });
    expect(boundary.calls).toEqual([{ args: ['api', 'user', '--jq', '.login'], options: expect.not.objectContaining({ env: expect.anything() }) }]);
  });

  it('keeps ownership and assigned-issue reads on the operator credential after resolving the bot identity', async () => {
    const gh = makeProductionGh();

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
