import { describe, expect, it, vi } from 'vitest';

import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import type { GithubOperationAccess, GithubOperationRequest } from '../../src/engine/github-operations.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../src/engine/tracker-client.js';

const cwd = '/fixture';
const issueTarget = { repository: 'acme/repo', kind: 'issue', number: 1 } as const;

function requestFor(access: Exclude<GithubOperationAccess, 'remote-ref-write'>): GithubOperationRequest {
  const context = { actor: 'operator' } as const;
  switch (access) {
    case 'read':
      return { operation: 'issue.read', access, target: issueTarget, context };
    case 'feature-write':
      return { operation: 'issue.comment.create', access, target: issueTarget, context, payload: { body: 'comment' } };
    case 'intake-write':
      return { operation: 'intake.issue.comment.create', access, target: issueTarget, context, payload: { body: 'comment' } };
    case 'create':
      return {
        operation: 'issue.create', access, target: { repository: 'acme/repo', kind: 'repository' }, context,
        payload: { title: 'Title', body: 'Body' },
      };
    case 'shared-write':
      return {
        operation: 'label-definition.create', access,
        target: { repository: 'acme/repo', kind: 'label-definition', name: 'label' }, context,
        payload: { name: 'label', color: '123456' },
      };
  }
}

function authorizedRunner(transport: GhRunner, events?: { emit: (event: never) => Promise<void> }) {
  return createGuardedGithubOperationRunner(transport, {
    cwd,
    events,
    // An injected creation scope is the narrow policy seam before transport;
    // these tests do not consult ownership files or an external GitHub API.
    creation: { authorize: async () => ({}) },
  });
}

describe('bot write fallback boundary', () => {
  it.each([
    ['feature-write', 'write'],
    ['intake-write', 'write'],
    ['create', 'write'],
    ['shared-write', 'write'],
    ['read', 'operator'],
  ] as const)('selects %s credentials for %s access', async (access, credential) => {
    const calls: Array<{ args: string[]; opts: Parameters<GhRunner>[1] }> = [];
    const transport: GhRunner = async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: '{}' };
    };

    await expect(authorizedRunner(transport).run(requestFor(access))).resolves.toEqual({});
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts).toEqual({ cwd, credential });
  });

  it.each(['token-unavailable', 'auth-refused', 'unsupported-remote-transport'] as const)(
    'emits %s before exactly one operator retry and returns that retry result',
    async (reason) => {
      const calls: Array<{ args: string[]; opts: Parameters<GhRunner>[1] }> = [];
      const transport: GhRunner = async (args, opts) => {
        calls.push({ args, opts });
        if (calls.length === 1) throw new GithubBotAuthRefusalError(reason);
        return { stdout: 'operator-result' };
      };
      const emitted: unknown[] = [];
      const events = { emit: vi.fn(async (event) => { emitted.push(event); }) };
      const request = requestFor('feature-write');

      await expect(authorizedRunner(transport, events as never).run(request)).resolves.toEqual({});
      expect(emitted).toEqual([{
        type: 'github_write_credential_fallback', operation: request.operation, target: request.target, reason,
      }]);
      expect(calls).toEqual([
        { args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'comment'], opts: { cwd, credential: 'write' } },
        { args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'comment'], opts: { cwd, credential: 'operator' } },
      ]);
    },
  );

  it('returns the operator retry failure without a third attempt', async () => {
    const operatorFailure = new Error('operator unavailable');
    const transport = vi.fn<GhRunner>(async (_args, opts) => {
      if (opts.credential === 'write') throw new GithubBotAuthRefusalError('auth-refused');
      throw operatorFailure;
    });
    const events = { emit: vi.fn(async () => undefined) };

    await expect(authorizedRunner(transport, events as never).run(requestFor('feature-write'))).rejects.toBe(operatorFailure);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('rethrows the bot refusal without an operator attempt when event emission fails', async () => {
    const refusal = new GithubBotAuthRefusalError('auth-refused');
    const transport = vi.fn<GhRunner>(async () => { throw refusal; });
    const events = { emit: vi.fn(async () => { throw new Error('event sink unavailable'); }) };

    await expect(authorizedRunner(transport, events as never).run(requestFor('feature-write'))).rejects.toBe(refusal);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('passes timeouts and other non-bot failures through without fallback', async () => {
    const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const transport = vi.fn<GhRunner>(async () => { throw timeout; });
    const events = { emit: vi.fn(async () => undefined) };

    await expect(authorizedRunner(transport, events as never).run(requestFor('feature-write'))).rejects.toBe(timeout);
    expect(events.emit).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses unowned writes and missing access before transport or fallback telemetry', async () => {
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '{}' }));
    const events = { emit: vi.fn(async () => undefined) };
    const unowned = createGuardedGithubOperationRunner(transport, { cwd, events: events as never });

    await expect(unowned.run(requestFor('feature-write'))).resolves.toEqual({ kind: 'refused', reason: 'missing-provenance' });
    const missingAccess = { ...requestFor('read'), access: undefined } as unknown as GithubOperationRequest;
    await expect(unowned.run(missingAccess)).resolves.toEqual({ kind: 'refused', reason: 'missing-provenance' });
    expect(transport).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('uses the bot credential again for a later authorized operation after a fallback', async () => {
    const calls: Array<Parameters<GhRunner>[1]> = [];
    const transport: GhRunner = async (_args, opts) => {
      calls.push(opts);
      if (calls.length === 1) throw new GithubBotAuthRefusalError('token-unavailable');
      return { stdout: '{}' };
    };
    const events = { emit: vi.fn(async () => undefined) };
    const runner = authorizedRunner(transport, events as never);

    await runner.run(requestFor('feature-write'));
    await runner.run(requestFor('feature-write'));
    expect(calls.map(({ credential }) => credential)).toEqual(['write', 'operator', 'write']);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
});
