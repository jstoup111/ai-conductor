// Covers: task:10

import { describe, expect, it } from 'vitest';

import {
  announceGatedIssue,
  announceGatedPr,
  OWNER_GATED_MARKER,
  type GatedSpecEntry,
} from '../../../src/engine/gate-writeback.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
} from '../../../src/engine/github-operations.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const CWD = '/fake/worktree';
const PR_URL = 'https://github.com/acme/widgets/pull/47';
const SOURCE_REF = 'acme/widgets#18';
const SPEC: GatedSpecEntry = {
  kind: 'spec',
  slug: 'widget',
  reason: 'other-owner',
  otherOwner: 'bob',
  remedy: 'declare an Owner',
};

function readOnlyGh(commentBody?: string): { readonly runner: GhRunner; readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runner: async (args) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('state,mergeable,statusCheckRollup,labels')) {
        return { stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [], labels: [] }) };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return {
          stdout: JSON.stringify({
            comments: commentBody ? [{ body: commentBody, url: `${PR_URL}#issuecomment-123` }] : [],
          }),
        };
      }
      throw new Error(`raw mutation escape hatch: ${args.join(' ')}`);
    },
  };
}

function fakeOperations(
  result: (request: GithubOperationRequest) => { readonly kind: 'refused'; readonly reason: 'other-owner' } | {},
  timeline: string[],
): {
  readonly runner: GithubOperationRunner;
  readonly attempts: GithubOperationRequest[];
  readonly writes: GithubOperationRequest[];
} {
  const attempts: GithubOperationRequest[] = [];
  const writes: GithubOperationRequest[] = [];
  return {
    attempts,
    writes,
    runner: {
      async run(request) {
        attempts.push(request);
        timeline.push(`remote:${request.operation}`);
        const outcome = result(request);
        if (!('kind' in outcome) || outcome.kind !== 'refused') writes.push(request);
        return outcome;
      },
    },
  };
}

describe('gate write-back ownership', () => {
  it('keeps local GATED discovery visible before remote work, refuses foreign PR/source issue writes, and preserves an authorized marker update through the guarded seam', async () => {
    const timeline = ['GATED widget'];
    const foreignPrGh = readOnlyGh();
    const foreignPr = fakeOperations(() => ({ kind: 'refused', reason: 'other-owner' }), timeline);
    const foreignIssueGh = readOnlyGh();
    const foreignIssue = fakeOperations(() => ({ kind: 'refused', reason: 'other-owner' }), timeline);
    const authorizedGh = readOnlyGh(`${OWNER_GATED_MARKER}\nold`);
    const authorized = fakeOperations(() => ({}), timeline);
    const authorizedIssue = fakeOperations(() => ({}), timeline);

    await announceGatedPr(SPEC, PR_URL, {
      cwd: CWD,
      runGh: foreignPrGh.runner,
      operations: foreignPr.runner,
    });
    await announceGatedIssue(SPEC, SOURCE_REF, {
      cwd: CWD,
      runGh: foreignIssueGh.runner,
      operations: foreignIssue.runner,
    });
    await announceGatedPr(SPEC, PR_URL, {
      cwd: CWD,
      runGh: authorizedGh.runner,
      operations: authorized.runner,
    });
    await announceGatedIssue(SPEC, SOURCE_REF, {
      cwd: CWD,
      operations: authorizedIssue.runner,
    });

    expect({
      timeline,
      foreignPrAttempts: foreignPr.attempts,
      foreignPrWrites: foreignPr.writes,
      foreignIssueAttempts: foreignIssue.attempts,
      foreignIssueWrites: foreignIssue.writes,
      authorizedWrites: authorized.writes.map((request) => ({
        operation: request.operation,
        payload: request.payload,
      })),
      authorizedIssueWrites: authorizedIssue.writes.map((request) => ({
        operation: request.operation,
        payload: request.payload,
      })),
      rawMutationCalls: [
        ...foreignPrGh.calls,
        ...foreignIssueGh.calls,
        ...authorizedGh.calls,
      ].filter((args) => args[0] === 'api' || args[1] === 'comment'),
    }).toEqual({
      timeline: [
        'GATED widget',
        'remote:pull-request.label.add',
        'remote:issue.label.add',
        'remote:pull-request.label.add',
        'remote:pull-request.comment.update',
        'remote:issue.label.add',
        'remote:intake.issue.comment.create',
      ],
      foreignPrAttempts: [expect.objectContaining({ operation: 'pull-request.label.add' })],
      foreignPrWrites: [],
      foreignIssueAttempts: [expect.objectContaining({ operation: 'issue.label.add' })],
      foreignIssueWrites: [],
      authorizedWrites: [
        { operation: 'pull-request.label.add', payload: { label: 'owner-gated' } },
        {
          operation: 'pull-request.comment.update',
          payload: { commentId: '123', body: expect.stringContaining(OWNER_GATED_MARKER) },
        },
      ],
      authorizedIssueWrites: [
        { operation: 'issue.label.add', payload: { label: 'owner-gated' } },
        {
          operation: 'intake.issue.comment.create',
          payload: { body: expect.stringContaining(OWNER_GATED_MARKER) },
        },
      ],
      rawMutationCalls: [],
    });
  });
});
