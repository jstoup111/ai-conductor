// Covers: task:5
import { describe, expect, it, vi } from 'vitest';

import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { createGithubTrackerClient, GhRunnerError, type GhRunner } from '../../src/engine/tracker-client.js';

const cwd = '/fixture';

describe('TrackerClient mutation bot-credential fallback (AB-1)', () => {
  it('lets the typed bot refusal reach the guarded runner: warns, then one operator retry', async () => {
    const calls: Array<Parameters<GhRunner>[1]> = [];
    const runner: GhRunner = async (_args, opts) => {
      calls.push(opts);
      if (opts.credential === 'write') throw new GithubBotAuthRefusalError('auth-refused');
      return { stdout: '' };
    };
    const emitted: unknown[] = [];
    const events = { emit: vi.fn(async (event: unknown) => { emitted.push(event); }) };
    const client = createGithubTrackerClient(runner, {
      intake: { authorize: async () => ({}) },
      events: events as never,
    });

    await client.commentOnIntakeIssue('acme/repo', 7, 'hello', cwd);

    expect(emitted).toContainEqual({
      type: 'github_write_credential_fallback',
      operation: 'intake.issue.comment.create',
      target: { repository: 'acme/repo', kind: 'issue', number: 7 },
      reason: 'auth-refused',
    });
    expect(calls.map((c) => c.credential)).toEqual(['write', 'operator']);
  });

  it('still surfaces a non-refusal transport failure as GhRunnerError', async () => {
    const runner: GhRunner = async () => { throw Object.assign(new Error('boom'), { code: 1 }); };
    const client = createGithubTrackerClient(runner, { intake: { authorize: async () => ({}) } });
    await expect(client.commentOnIntakeIssue('acme/repo', 7, 'x', cwd)).rejects.toBeInstanceOf(GhRunnerError);
  });
});
