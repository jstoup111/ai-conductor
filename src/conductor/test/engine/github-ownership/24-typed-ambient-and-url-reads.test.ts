// Covers: task:24
import { describe, expect, it, vi } from 'vitest';
import {
  GithubTrackerOperationRefusalError,
  runTrackerAmbientRead,
  runTrackerUrlRead,
  type GhRunner,
} from '../../../src/engine/tracker-client.js';
import { auditGithubInvocationSource } from '../../../src/engine/github-invocation-audit.js';

function fakeGh(stdout = '{}'): ReturnType<typeof vi.fn<GhRunner>> {
  return vi.fn<GhRunner>(async () => ({ stdout }));
}

describe('typed ambient reads', () => {
  it('forwards a registered checkout-scoped read unchanged and returns its stdout', async () => {
    const gh = fakeGh('{"nameWithOwner":"o/r"}');
    const stdout = await runTrackerAmbientRead(gh, '/w', 'ambient.repository.read', ['repo', 'view', '--json', 'nameWithOwner'], { timeout: 5 });
    expect(stdout).toBe('{"nameWithOwner":"o/r"}');
    expect(gh).toHaveBeenCalledExactlyOnceWith(['repo', 'view', '--json', 'nameWithOwner'], { cwd: '/w', timeout: 5 });
  });

  it.each([
    ['ambient.identity.read', ['api', 'user', '--jq', '.login']],
    ['ambient.identity.read', ['auth', 'status']],
    ['ambient.pull-request.read', ['pr', 'list', '--head', 'b', '--json', 'url']],
    ['ambient.pull-request.read', ['pr', 'view', 'branch', '--json', 'url,state']],
    ['ambient.cli.read', ['--version']],
  ] as const)('admits %s %j', async (operation, args) => {
    const gh = fakeGh();
    await runTrackerAmbientRead(gh, '/w', operation, [...args]);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a command outside the operation', 'ambient.repository.read', ['pr', 'view', 'x']],
    ['a mutation', 'ambient.pull-request.read', ['pr', 'edit', 'x', '--body', 'y']],
    ['a mutating api call', 'ambient.identity.read', ['api', 'user', '-X', 'PATCH']],
    ['an api field write', 'ambient.identity.read', ['api', 'user', '-f', 'name=x']],
    ['a repository api path', 'ambient.identity.read', ['api', 'repos/o/r/issues/1']],
    ['a repository-bound flag', 'ambient.pull-request.read', ['pr', 'view', '1', '-R', 'o/r']],
    ['a cli probe that is not the version banner', 'ambient.cli.read', ['--help']],
    ['a cli probe with a trailing subcommand', 'ambient.cli.read', ['version', 'pr', 'view', '1']],
    ['an unregistered operation', 'ambient.anything.read', ['repo', 'view']],
  ])('refuses %s before the runner is reached', async (_label, operation, args) => {
    const gh = fakeGh();
    await expect(runTrackerAmbientRead(gh, '/w', operation as never, args)).rejects.toBeInstanceOf(GithubTrackerOperationRefusalError);
    expect(gh).not.toHaveBeenCalled();
  });

  it('rethrows the transport failure itself so callers keep their error handling', async () => {
    const failure = Object.assign(new Error('boom'), { stderr: 'HTTP 404' });
    const gh = vi.fn<GhRunner>(async () => { throw failure; });
    await expect(runTrackerAmbientRead(gh, '/w', 'ambient.repository.read', ['repo', 'view'])).rejects.toBe(failure);
  });
});

describe('typed URL reads', () => {
  it('binds a pull-request URL to its repository and number', async () => {
    const gh = fakeGh('{"body":"b"}');
    const url = 'https://github.com/o/r/pull/7';
    expect(await runTrackerUrlRead(gh, '/w', 'pull-request', url, ['pr', 'view', url, '--json', 'body'])).toBe('{"body":"b"}');
    expect(gh).toHaveBeenCalledExactlyOnceWith(['pr', 'view', url, '--json', 'body'], { cwd: '/w' });
  });

  it('refuses a URL read whose flags name another repository', async () => {
    const gh = fakeGh();
    const url = 'https://github.com/o/r/pull/7';
    await expect(runTrackerUrlRead(gh, '/w', 'pull-request', url, ['pr', 'view', url, '-R', 'x/y'])).rejects.toBeInstanceOf(GithubTrackerOperationRefusalError);
    expect(gh).not.toHaveBeenCalled();
  });

  it('reads an issue URL as an issue target', async () => {
    const gh = fakeGh('{"comments":[]}');
    const url = 'https://github.com/o/r/issues/3';
    await runTrackerUrlRead(gh, '/w', 'issue', url, ['issue', 'view', url, '--json', 'comments']);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it('treats a branch or number handle as a checkout-scoped read', async () => {
    const gh = fakeGh('{}');
    await runTrackerUrlRead(gh, '/w', 'pull-request', 'feat/x', ['pr', 'view', 'feat/x', '--json', 'url,state']);
    expect(gh).toHaveBeenCalledExactlyOnceWith(['pr', 'view', 'feat/x', '--json', 'url,state'], { cwd: '/w' });
  });

  it('rethrows the transport failure itself', async () => {
    const failure = new Error('gh missing');
    const gh = vi.fn<GhRunner>(async () => { throw failure; });
    const url = 'https://github.com/o/r/pull/7';
    await expect(runTrackerUrlRead(gh, '/w', 'pull-request', url, ['pr', 'view', url])).rejects.toBe(failure);
  });
});

describe('audit has no site-level read exemption', () => {
  it.each(['engine/pr-labels.ts', 'engine/merged-pr-guard.ts', 'intake-backfill-cli.ts'])('flags a direct injected read in %s at any line', (file) => {
    const lines = Array.from({ length: 1100 }, () => '');
    lines[0] = "import type { GhRunner } from './tracker-client.js';";
    for (const line of [40, 43, 527]) if (line < lines.length) lines[line - 1] = "export async function f" + line + "(gh: GhRunner) { await gh(['pr', 'view', 'x', '--json', 'body'], { cwd: '.' }); }";
    const findings = auditGithubInvocationSource(file, lines.join('\n'));
    expect(findings.filter((finding) => finding.message === 'direct injected GitHub read outside guarded adapter').map((finding) => finding.line)).toEqual([40, 43, 527]);
  });
});
