import { describe, expect, it, vi } from 'vitest';
import {
  addLabel,
  comment,
  ensureLabel,
  findOrCreatePr,
  setReady,
  upsertComment,
  type FindOrCreatePrOpts,
  type GhRunner,
} from '../../../src/engine/pr-labels.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerResponse,
  GithubOperationRunnerRefusal,
} from '../../../src/engine/github-operations.js';

const CWD = '/fake/worktree';
const REPOSITORY = 'acme/widgets';
const PR_URL = `https://github.com/${REPOSITORY}/pull/47`;

function fakeOperations(
  handler: (request: GithubOperationRequest) => GithubOperationRunnerResponse | GithubOperationRunnerRefusal = () => ({}),
): { readonly runner: GithubOperationRunner; readonly calls: GithubOperationRequest[] } {
  const calls: GithubOperationRequest[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(async (request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => {
        calls.push(request);
        return handler(request);
      }),
    },
  };
}

// Covers: task:8
describe('pr-labels — guarded PR primitives and label definitions', () => {
  it('submits create, comment, ready, and association-label writes as canonical guarded requests', async () => {
    const terminal = fakeOperations((request) => request.operation === 'pull-request.create'
      ? { created: { repository: REPOSITORY, kind: 'pull-request', number: 47 } }
      : {});
    const opts: FindOrCreatePrOpts = {
      repository: REPOSITORY,
      branch: 'feature/widgets',
      base: 'main',
      title: 'feat: widgets',
      body: 'body',
    };

    await findOrCreatePr(terminal.runner, CWD, opts);
    await comment(terminal.runner, CWD, PR_URL, 'hello');
    await setReady(terminal.runner, CWD, PR_URL);
    await addLabel(terminal.runner, CWD, PR_URL, 'needs-review');

    expect(terminal.calls.map((request) => request.operation)).toEqual([
      'pull-request.create',
      'pull-request.comment.create',
      'pull-request.ready',
      'pull-request.label.add',
    ]);
    expect(terminal.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: { repository: REPOSITORY, kind: 'pull-request', number: 47 },
      }),
    ]));
  });

  it('returns a typed refusal and makes no terminal call for a refused PR mutation', async () => {
    const terminal = fakeOperations(() => ({ kind: 'refused', reason: 'other-owner' }));

    await expect(comment(terminal.runner, CWD, PR_URL, 'foreign')).resolves.toMatchObject({
      kind: 'refused',
      operation: 'pull-request.comment.create',
      reason: 'other-owner',
    });
    expect(terminal.calls).toHaveLength(1);
  });

  it('does not turn applying a label into a forced label-definition update, and refuses definition creation without scoped authorization', async () => {
    const terminal = fakeOperations((request): GithubOperationRunnerResponse | GithubOperationRunnerRefusal => request.operation === 'label-definition.create'
      ? { kind: 'refused', reason: 'explicit-authorization-required' }
      : {});

    await addLabel(terminal.runner, CWD, PR_URL, 'existing-label');
    await expect(ensureLabel(terminal.runner, CWD, 'existing-label', '0e8a16', undefined, {
      repository: REPOSITORY,
    })).resolves.toMatchObject({
      kind: 'refused',
      operation: 'label-definition.create',
      reason: 'explicit-authorization-required',
    });

    expect(terminal.calls).toEqual([
      expect.objectContaining({ operation: 'pull-request.label.add' }),
      expect.objectContaining({ operation: 'label-definition.create' }),
    ]);
  });

  it('updates a marked halt comment through the guarded operation seam and never creates a duplicate after an update refusal', async () => {
    const terminal = fakeOperations(() => ({ kind: 'refused', reason: 'other-owner' }));
    const comments = [{
      body: '<!-- conductor:needs-remediation -->\nold halt',
      url: `https://github.com/${REPOSITORY}/pull/47#issuecomment-81`,
    }];
    const rawReads: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments }) };
      throw new Error(`raw mutation attempted: ${args.join(' ')}`);
    };
    const hybrid = Object.assign(rawReads, terminal.runner);

    await upsertComment(
      hybrid,
      CWD,
      PR_URL,
      '<!-- conductor:needs-remediation -->',
      'new halt',
    );

    expect(terminal.calls).toEqual([expect.objectContaining({
      operation: 'pull-request.comment.update',
      target: { repository: REPOSITORY, kind: 'pull-request', number: 47 },
      payload: { commentId: '81', body: '<!-- conductor:needs-remediation -->\nnew halt' },
    })]);
  });
});
