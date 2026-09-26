// Covers: task:10
// Entry-point wiring keeps both machine identity and bot credential on the
// same user-config HOME; the process boundary is mocked, never GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const boundary = vi.hoisted(() => ({ calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }> }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn((file, args: string[], options: Record<string, unknown>, callback) => {
    boundary.calls.push({ file, args, options });
    const stdout = file === 'gh' && args[0] === 'pr' && args[1] === 'create'
      ? 'https://github.com/acme/repo/pull/1\n'
      : file === 'gh' && args[0] === 'issue' && args[1] === 'create'
        ? 'https://github.com/acme/repo/issues/1\n'
        : '';
    queueMicrotask(() => callback(null, stdout, ''));
    return {};
  }) };
});
import { dispatchGithubOperationCommand } from '../../src/engine/github-operations-cli.js';
import { openSpecPr } from '../../src/engine/engineer/handoff.js';
import { createIntakeFilingOperations, fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { readMachineOwnerConfig } from '../../src/engine/owner-gate/machine-identity.js';
import { readGithubBotCredential } from '../../src/engine/github-bot-credential.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';
import { makeProductionGit } from '../../src/engine/pr-labels.js';

const originalHome = process.env.HOME;
describe('GitHub bot CLI entry points', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-cli-entry-'));
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    await writeFile(join(root, 'token'), 'bot-entry-token\n');
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), `spec_owner: pr-labels\ngithub_bot:\n  token_file: ${join(root, 'token')}\n`);
    process.env.HOME = join(root, 'home'); delete process.env.AI_CONDUCTOR_NO_REAL_EXEC; boundary.calls.length = 0; vi.mocked(execFileCb).mockClear();
  });
  afterEach(async () => { if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome; await rm(root, { recursive: true, force: true }); });
  it('dispatchGithubOperationCommand writes issue comments through the bot child and shares the user config with owner resolution', async () => {
    await expect(readMachineOwnerConfig()).resolves.toEqual({ spec_owner: 'pr-labels' });
    await expect(readGithubBotCredential()).resolves.toEqual({ kind: 'configured', tokenFile: join(root, 'token') });
    const gh = makeProductionGh();
    const guarded = createGuardedGithubOperationRunner(gh, { cwd: root, mutation: {
      provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'feature/topic', featureMarker: '.docs/intake/topic.md', publication: 'initial' },
      dependencies: { resolveMachineOwner: async () => ({ resolved: true as const, id: 'pr-labels' }), provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: pr-labels\n' }] } },
    } });
    const runner = Object.assign(gh, { run: guarded.run });
    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: root, runner, git: vi.fn(async () => ({ stdout: 'feature/topic\n' })), write: vi.fn(), readRequest: async () => JSON.stringify({ operation: 'issue.comment.create', repository: 'acme/repo', resource: { kind: 'issue', number: 1 }, context: { actor: 'pr-labels' }, payload: { body: 'entry' } }),
    });
    expect(exit).toBe(0);
    expect(boundary.calls).toContainEqual(expect.objectContaining({ file: 'gh', args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'entry'], options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-entry-token' }) }) }));
  });

  it('runs the engineer handoff PR create and HTTPS push through bot-authenticated children', async () => {
    const gh = makeProductionGh();
    const operations = createGuardedGithubOperationRunner(gh, { cwd: root, mutation: {
      provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'spec/topic', featureMarker: '.docs/intake/topic.md', publication: 'initial' },
      dependencies: { resolveMachineOwner: async () => ({ resolved: true as const, id: 'pr-labels' }), provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: pr-labels\n' }] } },
    } });
    const git = makeProductionGit();
    const rawGh = vi.fn(async (args: string[]) => ({
      stdout: args.join(' ') === 'pr view spec/topic --json url' ? '{"url":"https://github.com/acme/repo/pull/1"}' : '', stderr: '',
    }));

    await expect(openSpecPr({ name: 'repo', canonicalPath: root, remote: 'https://github.com/acme/repo.git' }, 'spec/topic', {
      runner: rawGh,
      gitRunner: vi.fn(async () => ({ stdout: '' })),
      ledgerOpts: { engineerDir: root },
      publication: {
        repository: 'acme/repo',
        operations,
        remote: {
          cwd: root,
          config: vi.fn(async () => ({ stdout: 'https://github.com/acme/repo.git\n' })),
          runRemoteGit: git,
          mutation: {
            provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'spec/topic', featureMarker: '.docs/intake/topic.md', publication: 'initial' },
            dependencies: { resolveMachineOwner: async () => ({ resolved: true as const, id: 'pr-labels' }), provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: pr-labels\n' }] } },
          },
        },
      },
    })).resolves.toEqual({ kind: 'pr-opened', url: 'https://github.com/acme/repo/pull/1' });

    const ghCreate = boundary.calls.find(({ file, args }) => file === 'gh' && args[0] === 'pr' && args[1] === 'create');
    expect(ghCreate).toEqual(expect.objectContaining({ options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-entry-token' }) }) }));
    const gitPush = boundary.calls.find(({ file, args }) => file === 'git' && args[0] === 'push');
    expect(gitPush).toEqual(expect.objectContaining({ options: expect.objectContaining({ env: expect.objectContaining({
      GH_TOKEN: 'bot-entry-token',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    }) }) }));
  });

  it('runs intake-file issue creation through a bot-authenticated gh child', async () => {
    const gh = makeProductionGh();
    const operations = createIntakeFilingOperations(gh, root, {
      resolveActor: async () => ({ resolved: true as const, id: 'pr-labels' }),
      intent: { kind: 'explicit-intake', repository: 'acme/repo' },
    });

    await fileIntakeIssue({ title: 'Entry intake', body: 'Entry body', size: 'S', priority: 'low', repo: 'acme/repo' }, {
      creation: { authority: { resolveActor: async () => ({ resolved: true as const, id: 'pr-labels' }), intent: { kind: 'explicit-intake', repository: 'acme/repo' } }, operations },
    });

    expect(boundary.calls).toContainEqual(expect.objectContaining({
      file: 'gh', args: ['issue', 'create', '-R', 'acme/repo', '--title', 'Entry intake', '--body', 'Entry body'],
      options: expect.objectContaining({ env: expect.objectContaining({ GH_TOKEN: 'bot-entry-token' }) }),
    }));
  });

  it('emits the intake creation bot refusal before its one operator retry', async () => {
    const trace: string[] = [];
    const gh = vi.fn(async (args: string[], options: { credential?: string }) => {
      trace.push(String(options.credential));
      if (options.credential === 'write') throw new GithubBotAuthRefusalError('auth-refused');
      return { stdout: 'https://github.com/acme/repo/issues/2\n' };
    });
    const events: unknown[] = [];
    const emitter = { emit: vi.fn(async (event) => { events.push(event); trace.push('event'); }) };
    const authority = {
      resolveActor: async () => ({ resolved: true as const, id: 'pr-labels' }),
      intent: { kind: 'explicit-intake' as const, repository: 'acme/repo' },
    };
    const operations = createIntakeFilingOperations(gh, root, authority, emitter);

    await operations.run({
      operation: 'issue.create',
      access: 'create',
      target: { repository: 'acme/repo', kind: 'repository' },
      context: { actor: 'pr-labels' },
      payload: { title: 'Fallback intake', body: 'Body' },
    });

    expect({ events, trace }).toEqual({
      events: [{
        type: 'github_write_credential_fallback',
        operation: 'issue.create',
        target: { repository: 'acme/repo', kind: 'repository' },
        reason: 'auth-refused',
      }],
      trace: ['write', 'event', 'operator'],
    });
  });
});
