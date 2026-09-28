// Covers: task:9
// Identity resolution and assigned-issue discovery are ambient operator reads.
// Exercise their real production runner through the mocked execFile boundary so
// a future credential hint cannot quietly turn either lookup into a bot read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const botToken = 'task-9-bot-token';
const operatorToken = 'task-9-operator-token';

const processBoundary = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[]; options: Record<string, unknown> }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_file, args: string[], options: Record<string, unknown>, callback) => {
      processBoundary.calls.push({ args, options });
      const env = options.env as NodeJS.ProcessEnv | undefined;
      const stdout = args[0] === 'api'
        ? (env?.GH_TOKEN === botToken ? 'daemon-bot\n' : 'operator-login\n')
        : '[]';
      queueMicrotask(() => callback(null, { stdout, stderr: '' }));
      return {};
    }),
  };
});

import { createGithubIssuesAdapter } from '../../src/engine/engineer/intake/github-issues.js';
import type { Ledger } from '../../src/engine/engineer/intake/ledger.js';
import { ghLoginOwner } from '../../src/engine/owner-gate/identity.js';
import { makeProductionGh } from '../../src/engine/tracker-client.js';

function emptyLedger(): Ledger {
  return {
    known: async () => false,
    record: async () => undefined,
    transition: async () => undefined,
    get: async () => undefined,
    forget: async () => undefined,
    list: async () => [],
    reopen: async () => undefined,
    requeueClaimed: async () => ({ acted: false }),
  };
}

describe('bot configuration does not affect identity or @me intake reads', () => {
  let root: string;
  const savedEnvironment = new Map<string, string | undefined>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-read-identity-'));
    const home = join(root, 'home');
    const repo = join(root, 'repo');
    const tokenFile = join(root, 'bot-token');
    await Promise.all([mkdir(join(home, '.ai-conductor'), { recursive: true }), mkdir(repo, { recursive: true })]);
    await writeFile(tokenFile, `${botToken}\n`);
    await writeFile(join(home, '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${tokenFile}\n`);

    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'GH_TOKEN', 'HOME']) {
      savedEnvironment.set(key, process.env[key]);
    }
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    process.env.GH_TOKEN = operatorToken;
    process.env.HOME = home;
    processBoundary.calls.length = 0;
    vi.mocked(execFileCb).mockClear();
  });

  afterEach(async () => {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEnvironment.clear();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps gh api user and gh issue list --assignee @me on the ambient operator credential', async () => {
    const repo = join(root, 'repo');
    const gh = makeProductionGh();

    await expect(ghLoginOwner(gh, repo)).resolves.toEqual({ resolved: true, id: 'operator-login' });
    const intake = createGithubIssuesAdapter({
      gh,
      registry: { list: async () => [{ name: 'acme/widgets', path: repo }] },
      ledger: emptyLedger(),
      resolveActor: async () => ({ resolved: true, id: 'operator-login' }),
    });
    await expect(intake.poll()).resolves.toEqual([]);

    expect(execFileCb).toHaveBeenCalledTimes(2);
    expect(processBoundary.calls.map(({ args }) => args)).toEqual([
      ['api', 'user', '--jq', '.login'],
      ['issue', 'list', '--assignee', '@me', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '1000', '-R', 'acme/widgets'],
    ]);
    for (const { options } of processBoundary.calls) {
      expect(options).not.toHaveProperty('env');
    }
    // With no child env option, the gh child inherits this operator token;
    // returning operator-login above confirms it never observed the bot token.
    expect(process.env.GH_TOKEN).toBe(operatorToken);
  });
});
