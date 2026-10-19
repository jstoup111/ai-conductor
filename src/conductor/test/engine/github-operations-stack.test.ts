// Covers: task:6
import { describe, expect, it } from 'vitest';

import { GITHUB_OPERATION_REGISTRY, executeGithubOperation } from '../../src/engine/github-operations.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../src/engine/tracker-client.js';

describe('guarded stack GitHub operations', () => {
  it('registers and translates the stack and retarget operations only through the injected transport', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return { stdout: '{}' };
    };
    const operations = createGuardedGithubOperationRunner(gh, {
      cwd: '/fixture/worktree',
      creation: { authorize: async () => ({}) },
    });

    await executeGithubOperation({
      operation: 'stack.read', repository: 'jstoup111/ai-conductor', resource: { kind: 'repository' },
      context: { actor: 'operator' }, payload: { pullRequest: 101 },
    }, operations);
    await executeGithubOperation({
      operation: 'stack.create', repository: 'jstoup111/ai-conductor', resource: { kind: 'repository' },
      context: { actor: 'operator' }, payload: { pullRequests: [101, 103, 500] },
    }, operations);
    await executeGithubOperation({
      operation: 'stack.add', repository: 'jstoup111/ai-conductor', resource: { kind: 'stack', number: 88 },
      context: { actor: 'operator' }, payload: { pullRequests: [500] },
    }, operations);
    await executeGithubOperation({
      operation: 'pull-request.retarget', repository: 'jstoup111/ai-conductor', resource: { kind: 'pull-request', number: 500 },
      context: { actor: 'operator' }, payload: { base: 'feat/c3/demo' },
    }, operations);

    expect({
      registered: ['stack.read', 'stack.create', 'stack.add', 'pull-request.retarget']
        .every((operation) => Object.hasOwn(GITHUB_OPERATION_REGISTRY, operation)),
      calls,
    }).toEqual({
      registered: true,
      calls: [
        ['api', `repos/jstoup111/ai-conductor/stacks?pull_request=101`],
        ['api', '--method', 'POST', 'repos/jstoup111/ai-conductor/stacks', '-F', 'pull_requests[]=101', '-F', 'pull_requests[]=103', '-F', 'pull_requests[]=500'],
        ['api', '--method', 'POST', 'repos/jstoup111/ai-conductor/stacks/88/add', '-F', 'pull_requests[]=500'],
        ['pr', 'edit', '500', '-R', 'jstoup111/ai-conductor', '--base', 'feat/c3/demo'],
      ],
    });
  });

  it('refuses a base field on a regular pull-request edit before the injected transport', async () => {
    const calls: string[][] = [];
    const result = await executeGithubOperation({
      operation: 'pull-request.edit', repository: 'jstoup111/ai-conductor', resource: { kind: 'pull-request', number: 500 },
      context: { actor: 'operator' }, payload: { body: 'body only', base: 'feat/c3/demo' },
    }, createGuardedGithubOperationRunner(async (args) => {
      calls.push(args);
      return { stdout: '{}' };
    }, {
      cwd: '/fixture/worktree',
      creation: { authorize: async () => ({}) },
    }));

    expect({ result, calls }).toEqual({ result: { kind: 'refused', reason: 'invalid-payload' }, calls: [] });
  });
});
