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
