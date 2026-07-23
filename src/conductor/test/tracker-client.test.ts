import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { execFile as execFileSpy } from 'node:child_process';
import {
  makeProductionGh,
  assertRealExecAllowed,
  createGithubTrackerClient,
  type GhRunner,
} from '../src/engine/tracker-client.js';

describe('tracker-client: canonical GhRunner + guarded makeProductionGh', () => {
  it('typechecks GhRunner, makeProductionGh, assertRealExecAllowed imports', () => {
    const runner: GhRunner = async () => ({ stdout: '' });
    expect(typeof runner).toBe('function');
    expect(typeof makeProductionGh).toBe('function');
    expect(typeof assertRealExecAllowed).toBe('function');
  });

  it('makeProductionGh() throws under AI_CONDUCTOR_NO_REAL_EXEC before spawning a process', async () => {
    vi.mocked(execFileSpy).mockClear();
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();

    const gh = makeProductionGh();

    await expect(gh(['pr', 'view'], { cwd: '/tmp' })).rejects.toThrow(
      /AI_CONDUCTOR_NO_REAL_EXEC|real .*(gh|exec).* blocked/i,
    );
    expect(execFileSpy).not.toHaveBeenCalled();
  });
});

function fakeRunner(stdout: string) {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  const runner: GhRunner = async (args, opts) => {
    calls.push({ args, opts });
    return { stdout };
  };
  return { runner, calls };
}

/** Fake runner that rejects the way execFileP does on non-zero exit: an Error with `.code` and `.stderr`. */
function failingRunner(opts: { code?: number; stderr: string; message?: string }) {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  const runner: GhRunner = async (args, callOpts) => {
    calls.push({ args, opts: callOpts });
    const err = new Error(opts.message ?? `Command failed: gh ${args.join(' ')}`) as Error & {
      code?: number;
      stderr?: string;
    };
    err.code = opts.code;
    err.stderr = opts.stderr;
    throw err;
  };
  return { runner, calls };
}

describe('createGithubTrackerClient — loud error semantics', () => {
  it('closeIssue: non-zero exit rejection carries argv and stderr', async () => {
    const { runner } = failingRunner({ code: 1, stderr: 'gh: some failure occurred' });
    const client = createGithubTrackerClient(runner);

    await expect(client.closeIssue('owner/repo', '12', '.')).rejects.toMatchObject({
      message: expect.stringContaining('gh: some failure occurred'),
    });
    await expect(client.closeIssue('owner/repo', '12', '.')).rejects.toMatchObject({
      message: expect.stringContaining('issue'),
    });
  });

  it('getIssueLabels: non-zero exit rejection carries argv and stderr', async () => {
    const { runner } = failingRunner({ code: 1, stderr: 'gh: boom' });
    const client = createGithubTrackerClient(runner);

    await expect(client.getIssueLabels('owner/repo', 42, '.')).rejects.toMatchObject({
      message: expect.stringContaining('gh: boom'),
    });
    await expect(client.getIssueLabels('owner/repo', 42, '.')).rejects.toMatchObject({
      message: expect.stringContaining('repos/owner/repo/issues/42'),
    });
  });

  it('getIssueLabels: invalid JSON stdout rejects with a named parse error, not a raw JSON.parse message', async () => {
    const { runner } = fakeRunner('not json {{{');
    const client = createGithubTrackerClient(runner);

    await expect(client.getIssueLabels('owner/repo', 42, '.')).rejects.toMatchObject({
      message: expect.stringMatching(/getIssueLabels/i),
    });
  });

  it('viewIssue: invalid JSON stdout rejects with a named parse error, not a raw JSON.parse message', async () => {
    const { runner } = fakeRunner('not json {{{');
    const client = createGithubTrackerClient(runner);

    await expect(client.viewIssue('owner/repo#12', '.')).rejects.toMatchObject({
      message: expect.stringMatching(/viewIssue/i),
    });
  });

  it('getIssueLabels: 404-shaped gh failure preserves 404 evidence for downstream detection', async () => {
    const { runner } = failingRunner({
      code: 1,
      stderr: 'HTTP 404: Not Found (https://api.github.com/repos/owner/repo/issues/42)',
    });
    const client = createGithubTrackerClient(runner);

    await expect(client.getIssueLabels('owner/repo', 42, '.')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('createGithubTrackerClient — read ops argv parity', () => {
  it('getIssueLabels: matches backlog-priority.ts:335 `gh api repos/<owner>/<repo>/issues/<n>`', async () => {
    const { runner, calls } = fakeRunner(
      JSON.stringify({ labels: [{ name: 'bug' }, { name: 'p1' }] }),
    );
    const client = createGithubTrackerClient(runner);

    const labels = await client.getIssueLabels('owner/repo', 42, '.');

    expect(calls).toEqual([
      { args: ['api', 'repos/owner/repo/issues/42'], opts: { cwd: '.' } },
    ]);
    expect(labels).toEqual(['bug', 'p1']);
  });

  it('getBlockedBy: matches blocker-resolver.ts:151 `gh api repos/<repo>/issues/<n>/dependencies/blocked_by`', async () => {
    const { runner, calls } = fakeRunner(JSON.stringify([]));
    const client = createGithubTrackerClient(runner);

    await client.getBlockedBy('owner/repo', 7, '.');

    expect(calls).toEqual([
      {
        args: ['api', 'repos/owner/repo/issues/7/dependencies/blocked_by'],
        opts: { cwd: '.' },
      },
    ]);
  });

  it('viewerIdentity: matches identity.ts:72 `gh api user --jq .login`', async () => {
    const { runner, calls } = fakeRunner('octocat\n');
    const client = createGithubTrackerClient(runner);

    const login = await client.viewerIdentity('/repo/cwd');

    expect(calls).toEqual([
      { args: ['api', 'user', '--jq', '.login'], opts: { cwd: '/repo/cwd' } },
    ]);
    expect(login).toBe('octocat');
  });

  it('viewIssue: matches wiring-probe.ts:539 `gh issue view <slug> --json state`', async () => {
    const { runner, calls } = fakeRunner(JSON.stringify({ state: 'OPEN' }));
    const client = createGithubTrackerClient(runner);

    await client.viewIssue('owner/repo#12', '.');

    expect(calls).toEqual([
      { args: ['issue', 'view', 'owner/repo#12', '--json', 'state'], opts: { cwd: '.' } },
    ]);
  });

  it('getIssueState: uses viewIssue argv and extracts uppercased state', async () => {
    const { runner, calls } = fakeRunner(JSON.stringify({ state: 'closed' }));
    const client = createGithubTrackerClient(runner);

    const state = await client.getIssueState('owner/repo#12', '.');

    expect(calls).toEqual([
      { args: ['issue', 'view', 'owner/repo#12', '--json', 'state'], opts: { cwd: '.' } },
    ]);
    expect(state).toBe('CLOSED');
  });

  it('listAssignedIssues: matches github-issues.ts assignee-scoped poll argv', async () => {
    const { runner, calls } = fakeRunner(
      JSON.stringify([{ number: 1, title: 't', body: 'b', labels: [] }]),
    );
    const client = createGithubTrackerClient(runner);

    const issues = await client.listAssignedIssues('owner/repo', '/repo/path');

    expect(calls).toEqual([
      {
        args: [
          'issue',
          'list',
          '--assignee',
          '@me',
          '--state',
          'open',
          '--json',
          'number,title,body,labels',
          '-R',
          'owner/repo',
        ],
        opts: { cwd: '/repo/path' },
      },
    ]);
    expect(issues).toEqual([{ number: 1, title: 't', body: 'b', labels: [] }]);
  });
});

describe('createGithubTrackerClient — write ops argv parity', () => {
  it('commentOnIssue: matches github-issues.ts:302 `gh issue comment <n> -R <repo> --body <body>`', async () => {
    const { runner, calls } = fakeRunner('');
    const client = createGithubTrackerClient(runner);

    await client.commentOnIssue('owner/repo', 42, 'hello', '.');

    expect(calls).toEqual([
      {
        args: ['issue', 'comment', '42', '-R', 'owner/repo', '--body', 'hello'],
        opts: { cwd: '.' },
      },
    ]);
  });

  it('createIssue: matches file-issue.ts:135 `gh issue create --title <t> --body <b> [--repo <r>]`', async () => {
    const { runner, calls } = fakeRunner('https://github.com/owner/repo/issues/9\n');
    const client = createGithubTrackerClient(runner);

    const url = await client.createIssue({ title: 'T', body: 'B', repo: 'owner/repo' }, '.');

    expect(calls).toEqual([
      {
        args: ['issue', 'create', '--title', 'T', '--body', 'B', '--repo', 'owner/repo'],
        opts: { cwd: '.' },
      },
    ]);
    expect(url).toBe('https://github.com/owner/repo/issues/9');
  });

  it('createIssue: omits --repo when not provided', async () => {
    const { runner, calls } = fakeRunner('https://github.com/owner/repo/issues/9\n');
    const client = createGithubTrackerClient(runner);

    await client.createIssue({ title: 'T', body: 'B' }, '.');

    expect(calls).toEqual([
      { args: ['issue', 'create', '--title', 'T', '--body', 'B'], opts: { cwd: '.' } },
    ]);
  });

  it('addIssueLabel: matches pr-labels.ts restAddLabelArgs REST POST shape', async () => {
    const { runner, calls } = fakeRunner('');
    const client = createGithubTrackerClient(runner);

    await client.addIssueLabel('owner/repo', 42, 'engineer:handled', '.');

    expect(calls).toEqual([
      {
        args: ['api', '--method', 'POST', 'repos/owner/repo/issues/42/labels', '-f', 'labels[]=engineer:handled'],
        opts: { cwd: '.' },
      },
    ]);
  });

  it('closeIssue: matches halt-issues-cli.ts closeIssue `gh issue close <ref>` cross-repo targeting', async () => {
    const { runner, calls } = fakeRunner('');
    const client = createGithubTrackerClient(runner);

    await client.closeIssue('owner/repo', '12', '.');

    expect(calls).toEqual([
      { args: ['issue', 'close', '12', '-R', 'owner/repo'], opts: { cwd: '.' } },
    ]);
  });

  it('upsertIssueBody: matches halt-issues-cli.ts upsertIssueBody `gh issue edit <ref> --body <body>` cross-repo targeting', async () => {
    const { runner, calls } = fakeRunner('');
    const client = createGithubTrackerClient(runner);

    await client.upsertIssueBody('owner/repo', '12', 'new body', '.');

    expect(calls).toEqual([
      { args: ['issue', 'edit', '12', '--body', 'new body', '-R', 'owner/repo'], opts: { cwd: '.' } },
    ]);
  });

  it('upsertIssueComment: matches halt-issues-cli.ts upsertIssueComment `gh issue comment <ref> --body <body>` cross-repo targeting', async () => {
    const { runner, calls } = fakeRunner('');
    const client = createGithubTrackerClient(runner);

    await client.upsertIssueComment('owner/repo', '12', 'a comment', '.');

    expect(calls).toEqual([
      { args: ['issue', 'comment', '12', '--body', 'a comment', '-R', 'owner/repo'], opts: { cwd: '.' } },
    ]);
  });
});
