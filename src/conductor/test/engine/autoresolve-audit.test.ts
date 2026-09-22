// Covers: task:11, task:12
import { describe, expect, it } from 'vitest';
import {
  SUPERSESSION_AUDIT_MARKER,
  guardedPrRunner,
  postSupersessionAudit,
  type GhRunner,
} from '../../src/engine/pr-labels.js';
import type { GithubOperationRunner } from '../../src/engine/github-operations.js';

/** Route guarded comment mutations back through the recording gh fake as argv. */
function guarded(gh: GhRunner) {
  const operations: GithubOperationRunner = {
    run: async (request) => {
      if (request.target.kind !== 'pull-request' || !request.payload || !('body' in request.payload)) {
        throw new Error(`unexpected request ${request.operation}`);
      }
      const repo = request.target.repository;
      switch (request.operation) {
        case 'pull-request.comment.create':
          await gh(['pr', 'comment', String(request.target.number), '--repo', repo, '--body', String(request.payload.body)], { cwd: '/repo' });
          return {};
        case 'pull-request.comment.update':
          if (!('commentId' in request.payload)) throw new Error('invalid comment update request');
          await gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${request.payload.commentId}`, '-f', `body=${String(request.payload.body)}`], { cwd: '/repo' });
          return {};
        default:
          throw new Error(`unexpected operation ${request.operation}`);
      }
    },
  };
  return guardedPrRunner(gh, operations);
}

describe('postSupersessionAudit', () => {
  it('creates one marker-tagged comment containing the judgement and literal successful suite command', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'pr') return { stdout: JSON.stringify({ comments: [] }) };
      return { stdout: '' };
    };
    await postSupersessionAudit(guarded(gh), '/repo', 'https://github.com/o/r/pull/1', {
      choice: 'superseded', rationale: 'base already has it', superseded: ['abc'], suiteCommand: 'npm test',
    });
    const create = calls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(create?.join(' ')).toContain(SUPERSESSION_AUDIT_MARKER);
    expect(create?.join(' ')).toContain('base already has it');
    expect(create?.join(' ')).toContain('npm test');
    expect(create?.join(' ')).toContain('exit 0');
  });

  it('updates the existing marked comment instead of creating another', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'pr') return { stdout: JSON.stringify({ comments: [{ body: SUPERSESSION_AUDIT_MARKER, url: 'https://github.com/o/r/pull/1#issuecomment-9' }] }) };
      return { stdout: '' };
    };
    await postSupersessionAudit(guarded(gh), '/repo', 'https://github.com/o/r/pull/1', {
      choice: 'merged', rationale: 'combined', superseded: [], suiteCommand: 'pnpm test',
    });
    expect(calls.some((args) => args.includes('PATCH'))).toBe(true);
    expect(calls.some((args) => args[0] === 'pr' && args[1] === 'comment')).toBe(false);
  });
});
