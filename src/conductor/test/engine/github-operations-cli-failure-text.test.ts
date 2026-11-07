// Covers: task:2
import { describe, expect, it } from 'vitest';

import { boundGithubOperationFailureText } from '../../src/engine/github-operations-cli.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

const title = 'Private FINISH title';
const body = 'Private line one\nPrivate line two';

function pullRequestEditRequest(payload: Record<string, unknown> = { title, body }): GithubOperationRequest {
  return {
    operation: 'pull-request.edit',
    access: 'feature-write',
    target: { repository: 'owner/repo', kind: 'pull-request', number: 3372 },
    context: { actor: 'operator' },
    payload,
  } as GithubOperationRequest;
}

describe('boundGithubOperationFailureText', () => {
  it('drops a command prelude and retains the GitHub missing-scope error without request prose', () => {
    const error = `Command failed: gh pr edit 3372 -R owner/repo --title ${title} --body ${body}\nGraphQL: Your token has not been granted the required scopes: read:org`;

    const result = boundGithubOperationFailureText(error, pullRequestEditRequest());

    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result).toContain('GraphQL: Your token has not been granted the required scopes');
    expect(result).not.toContain('Command failed');
    expect(result).not.toContain('--body');
    expect(result).not.toContain(body);
    expect(result).not.toContain(title);
  });

  it('truncates a long GitHub error to 1000 characters', () => {
    expect(boundGithubOperationFailureText('x'.repeat(3000), pullRequestEditRequest())).toHaveLength(1000);
  });

  it('trims a prefix-less error and replaces every non-empty payload string value', () => {
    const request = pullRequestEditRequest({ title: 'private title', body: 'private body', head: 'private head', blank: '' });

    expect(boundGithubOperationFailureText('  private title: private body from private head  ', request))
      .toBe('«payload»: «payload» from «payload»');
  });
});
