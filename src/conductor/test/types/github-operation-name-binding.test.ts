import { describe, expect, it } from 'vitest';

import { GITHUB_OPERATION_REGISTRY } from '../../src/engine/github-operations.js';
import type { GithubOperationName } from '../../src/types/github.js';

type GithubOperationDefinition = (typeof GITHUB_OPERATION_REGISTRY)[GithubOperationName];

const operationNames: Record<GithubOperationName, true> = {
  'issue.read': true,
  'pull-request.read': true,
  'repository.read': true,
  'issue.comment.create': true,
  'issue.comment.update': true,
  'issue.edit': true,
  'issue.close': true,
  'issue.label.add': true,
  'issue.label.remove': true,
  'issue.dependency.add': true,
  'issue.dependency.remove': true,
  'pull-request.comment.create': true,
  'pull-request.comment.update': true,
  'pull-request.edit': true,
  'pull-request.retarget': true,
  'pull-request.ready': true,
  'pull-request.draft': true,
  'pull-request.label.add': true,
  'pull-request.label.remove': true,
  'intake.issue.comment.create': true,
  'intake.issue.comment.update': true,
  'intake.issue.close': true,
  'intake.issue.label.add': true,
  'intake.issue.label.remove': true,
  'intake.issue.dependency.add': true,
  'issue.create': true,
  'pull-request.create': true,
  'commit.status.create': true,
  'stack.read': true,
  'stack.create': true,
  'stack.add': true,
  'label-definition.create': true,
  'label-definition.update': true,
  'repository.create': true,
  'remote-ref.push': true,
  'remote-ref.delete': true,
};

const definition = GITHUB_OPERATION_REGISTRY['issue.read'];
const complete: Record<GithubOperationName, GithubOperationDefinition> = GITHUB_OPERATION_REGISTRY;

// @ts-expect-error GithubOperationName records must include every operation in the union.
const missing: Record<GithubOperationName, GithubOperationDefinition> = {
  'issue.read': definition,
};

const extra: Record<GithubOperationName, GithubOperationDefinition> = {
  ...complete,
  // @ts-expect-error GithubOperationName records reject unknown operation keys.
  'unknown.operation': definition,
};

describe('type binding: GitHub operation names', () => {
  it('keeps the operation-name union aligned with the live registry', () => {
    expect(Object.keys(GITHUB_OPERATION_REGISTRY).sort()).toEqual(Object.keys(operationNames).sort());
    expect(complete).toBeDefined();
    expect(missing).toBeDefined();
    expect(extra).toBeDefined();
  });
});
