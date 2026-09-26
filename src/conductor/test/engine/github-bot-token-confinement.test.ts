// Covers: task:12
// A configured bot credential is a capability of exactly one gh/git child. It
// must never become daemon state that later reaches provider or build children.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

const boundary = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
  failure: undefined as (Error & { stderr?: string }) | undefined,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((file, args: string[], options: Record<string, unknown>, callback) => {
      boundary.calls.push({ file, args, options });
      queueMicrotask(() => callback(boundary.failure, { stdout: '', stderr: boundary.failure?.stderr ?? '' }));
      return {};
    }),
  };
});

import { filterReviewChildEnvironment } from '../../src/execution/child-environment.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';
import { makeProductionGit } from '../../src/engine/pr-labels.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';
import { provisionSandboxBuildEnv } from '../../src/engine/self-host/sandbox-build-env.js';

const sentinel = 'task-12-bot-token-must-not-escape';
const savedEnvironment = new Map<string, string | undefined>();

function propagatedErrorText(error: unknown): string {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return String(value ?? '');
    seen.add(value);
    const record = value as Record<string, unknown>;
    return `${String(record.message ?? '')} ${String(record.stderr ?? '')} ${String(record.stdout ?? '')} ${String(record.cmd ?? '')} ${visit(record.cause)}`;
  };
  return `${visit(error)} ${inspect(error, { depth: null })}`;
}

describe('GitHub bot token confinement', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-token-confinement-'));
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    await writeFile(join(root, 'bot-token'), `${sentinel}\n`);
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${join(root, 'bot-token')}\n`);
    await mkdir(join(root, 'worktree', 'skills'), { recursive: true });
    await mkdir(join(root, 'homes'), { recursive: true });
    await mkdir(join(root, 'builds'), { recursive: true });

    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'GH_TOKEN', 'HOME']) savedEnvironment.set(key, process.env[key]);
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    process.env.GH_TOKEN = 'operator-token';
    process.env.HOME = join(root, 'home');
    boundary.calls.length = 0;
    boundary.failure = undefined;
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

  it('confines a bot write to gh/git children and redacts a failed child stderr before later children are built', async () => {
    const gh = makeProductionGh();

    await gh(['issue', 'comment', '1'], { cwd: root, credential: 'write' });
    expect(boundary.calls[0]).toMatchObject({
      file: 'gh', args: ['issue', 'comment', '1'], options: { env: expect.objectContaining({ GH_TOKEN: sentinel }) },
    });
    expect(process.env.GH_TOKEN).toBe('operator-token');

    const leakedStderr = `fatal: Authentication failed for ${sentinel}`;
    boundary.failure = Object.assign(new Error(`gh failed: ${leakedStderr}`), { stderr: leakedStderr });
    const events: unknown[] = [];
    const guarded = createGuardedGithubOperationRunner(gh, {
      cwd: root,
      creation: { authorize: async () => ({}) },
      // Make the fallback stop here so the tested failure remains observable.
      events: { emit: async (event) => { events.push(event); throw new Error('event sink stopped retry'); } },
    });
    const rejected = await guarded.run({
      operation: 'issue.comment.create', access: 'feature-write',
      target: { repository: 'acme/repo', kind: 'issue', number: 1 },
      context: { actor: 'task-12' }, payload: { body: 'comment' },
    }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).not.toContain(sentinel);
    expect(propagatedErrorText(rejected)).not.toContain(sentinel);
    expect(JSON.stringify(events)).not.toContain(sentinel);

    const provider = await provisionProviderHome({
      provider: { id: 'codex' }, worktreeRoot: join(root, 'worktree'), baseDir: join(root, 'homes'),
      parentEnv: process.env,
    });
    const build = await provisionSandboxBuildEnv({
      worktreeRoot: join(root, 'worktree'), harnessRoot: join(root, 'worktree'), baseDir: join(root, 'builds'),
      parentEnv: process.env, globalStateFile: join(root, 'missing-state.json'),
    });
    try {
      const children = [
        provider.childEnv(),
        filterReviewChildEnvironment('codex', process.env),
        build.childEnv(),
      ];
      for (const environment of children) expect(Object.values(environment)).not.toContain(sentinel);

      boundary.failure = undefined;
      await makeProductionGit()(['push', 'origin', 'HEAD:refs/heads/topic'], {
        cwd: root, credential: 'write', endpoint: 'https',
      });
      const push = boundary.calls.find((call) => call.file === 'git');
      expect(push?.args).toEqual(['push', 'origin', 'HEAD:refs/heads/topic']);
      expect(JSON.stringify(push?.args)).not.toContain(sentinel);
      expect(JSON.stringify(push?.args)).not.toMatch(/[^:]:[^@]+@/);

      boundary.failure = Object.assign(new Error(`push failed: ${sentinel}`), { stderr: `fatal ${sentinel}` });
      const pushFailure = await makeProductionGit()(['push', 'origin', 'HEAD:refs/heads/topic'], {
        cwd: root, credential: 'write', endpoint: 'https',
      }).catch((error: unknown) => error);
      expect(propagatedErrorText(pushFailure)).not.toContain(sentinel);
    } finally {
      await Promise.all([provider.teardown(), build.teardown()]);
    }
  });
});
