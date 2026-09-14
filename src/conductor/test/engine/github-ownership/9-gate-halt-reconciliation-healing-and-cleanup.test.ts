// Covers: task:9
import { describe, expect, it, vi } from 'vitest';
import { reconcileHaltPrs } from '../../../src/engine/halt-pr-reconciliation.js';
import {
  NEEDS_REMEDIATION_BODY_MARKER,
  NEEDS_REMEDIATION_MARKER,
} from '../../../src/engine/pr-labels.js';
import type {
  GithubOperationRequest,
  GithubOperationRefusalReason,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../../src/engine/github-operations.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const CWD = '/fixture';
const REPOSITORY = 'acme/widgets';

interface FakePr {
  readonly number: number;
  readonly url: string;
  readonly headRefName: string;
  body: string;
  isDraft: boolean;
  labels: string[];
  comments: Array<{ body: string; url: string }>;
}

interface Fixture {
  readonly gh: GhRunner;
  readonly operations: GithubOperationRunner;
  readonly attempts: GithubOperationRequest[];
  readonly writes: GithubOperationRequest[];
  readonly rawMutationCalls: string[][];
  readonly refused: Map<number, GithubOperationRefusalReason>;
  readonly shippedBranches: Set<string>;
  readonly runGit: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
}

function marked(number: number, slug: string, overrides: Partial<FakePr> = {}): FakePr {
  return {
    number,
    url: `https://github.com/${REPOSITORY}/pull/${number}`,
    headRefName: `feat/daemon-${slug}`,
    body: `halted\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    isDraft: true,
    labels: ['needs-remediation'],
    comments: [],
    ...overrides,
  };
}

function reconciliationFixture(prs: FakePr[]): Fixture {
  const byUrl = new Map(prs.map((pr) => [pr.url, pr]));
  const attempts: GithubOperationRequest[] = [];
  const writes: GithubOperationRequest[] = [];
  const rawMutationCalls: string[][] = [];
  const refused = new Map<number, GithubOperationRefusalReason>();
  const shippedBranches = new Set<string>();

  const gh: GhRunner = vi.fn(async (args) => {
    if (args[0] === 'pr' && args[1] === 'list') {
      return {
        stdout: JSON.stringify(prs.map((pr) => ({
          number: pr.number,
          url: pr.url,
          body: pr.body,
          isDraft: pr.isDraft,
          labels: pr.labels.map((name) => ({ name })),
          headRefName: pr.headRefName,
        }))),
      };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = byUrl.get(args[2]);
      if (!pr) throw new Error(`unknown PR read: ${args.join(' ')}`);
      if (args.includes('comments')) return { stdout: JSON.stringify({ comments: pr.comments }) };
      return {
        stdout: JSON.stringify({
          isDraft: pr.isDraft,
          labels: pr.labels.map((name) => ({ name })),
          body: pr.body,
        }),
      };
    }
    rawMutationCalls.push(args);
    throw new Error(`raw mutation escaped the guarded runner: ${args.join(' ')}`);
  });

  const operations: GithubOperationRunner = {
    run: vi.fn(async (request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => {
      attempts.push(request);
      if (request.target.kind !== 'pull-request') throw new Error('expected PR mutation');
      const refusal = refused.get(request.target.number);
      if (refusal) return { kind: 'refused', reason: refusal };

      const pr = prs.find((candidate) => candidate.number === request.target.number);
      if (!pr) throw new Error(`unknown PR operation: ${request.target.number}`);
      writes.push(request);
      switch (request.operation) {
        case 'pull-request.draft':
          pr.isDraft = true;
          break;
        case 'pull-request.ready':
          pr.isDraft = false;
          break;
        case 'pull-request.label.add':
          if (request.payload && 'label' in request.payload && !pr.labels.includes(request.payload.label)) {
            pr.labels.push(request.payload.label);
          }
          break;
        case 'pull-request.label.remove':
          if (request.payload && 'label' in request.payload) {
            pr.labels = pr.labels.filter((label) => label !== request.payload.label);
          }
          break;
        case 'pull-request.edit':
          if (request.payload && 'body' in request.payload && request.payload.body !== undefined) {
            pr.body = request.payload.body;
          }
          break;
        case 'pull-request.comment.update': {
          if (!request.payload || !('commentId' in request.payload)) throw new Error('missing comment update payload');
          const comment = pr.comments.find((candidate) => candidate.url.endsWith(`#issuecomment-${request.payload.commentId}`));
          if (!comment) throw new Error(`unknown comment: ${request.payload.commentId}`);
          comment.body = request.payload.body;
          break;
        }
        case 'pull-request.comment.create':
          if (!request.payload || !('body' in request.payload)) throw new Error('missing comment body');
          pr.comments.push({
            body: request.payload.body,
            url: `${pr.url}#issuecomment-${pr.comments.length + 1}`,
          });
          break;
        default:
          throw new Error(`unexpected operation: ${request.operation}`);
      }
      return {};
    }),
  };

  return {
    gh,
    operations,
    attempts,
    writes,
    rawMutationCalls,
    refused,
    shippedBranches,
    runGit: async (args) => {
      const ref = args[args.length - 1]?.split(':')[0];
      if (ref && shippedBranches.has(ref)) return { stdout: '' };
      throw new Error(`no shipped record at ${args.join(' ')}`);
    },
  };
}

describe('halt reconciliation ownership boundary', () => {
  it('heals an authorized halted PR and clears an authorized shipped PR with an in-place comment update', async () => {
    const halted = marked(8, 'owned-halt', { isDraft: false, labels: [] });
    const shipped = marked(9, 'owned-shipped', {
      comments: [{
        body: `${NEEDS_REMEDIATION_MARKER}\nold halt`,
        url: `https://github.com/${REPOSITORY}/pull/9#issuecomment-91`,
      }],
    });
    const fixture = reconciliationFixture([halted, shipped]);
    fixture.shippedBranches.add(shipped.headRefName);
    const cache = new Map();

    await reconcileHaltPrs({
      projectRoot: CWD,
      runGh: fixture.gh,
      operations: fixture.operations,
      runGit: fixture.runGit,
      cache,
    });

    expect(halted).toMatchObject({ isDraft: true, labels: ['needs-remediation'] });
    expect(shipped).toMatchObject({ isDraft: false, labels: [] });
    expect(shipped.body).not.toContain(NEEDS_REMEDIATION_BODY_MARKER);
    expect(shipped.comments).toEqual([expect.objectContaining({
      body: expect.stringContaining('Halt resolved'),
    })]);
    expect(fixture.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull-request.draft', target: { repository: REPOSITORY, kind: 'pull-request', number: 8 } }),
      expect.objectContaining({ operation: 'pull-request.label.add', target: { repository: REPOSITORY, kind: 'pull-request', number: 8 } }),
      expect.objectContaining({ operation: 'pull-request.label.remove', target: { repository: REPOSITORY, kind: 'pull-request', number: 9 } }),
      expect.objectContaining({ operation: 'pull-request.ready', target: { repository: REPOSITORY, kind: 'pull-request', number: 9 } }),
      expect.objectContaining({ operation: 'pull-request.edit', target: { repository: REPOSITORY, kind: 'pull-request', number: 9 } }),
      expect.objectContaining({ operation: 'pull-request.comment.update', payload: expect.objectContaining({ commentId: '91' }) }),
    ]));
    expect(cache).toEqual(new Map([[halted.url, 'healed'], [shipped.url, 'cleared']]));
    expect(fixture.rawMutationCalls).toEqual([]);
  });

  it('refuses foreign and provenance-unknown shipped cleanup despite marker, daemon branch, and shipment hints', async () => {
    const foreign = marked(10, 'foreign', { isDraft: false, labels: [] });
    const unknown = marked(11, 'unknown');
    const fixture = reconciliationFixture([foreign, unknown]);
    fixture.refused.set(foreign.number, 'other-owner');
    fixture.refused.set(unknown.number, 'missing-provenance');
    fixture.shippedBranches.add(foreign.headRefName);
    fixture.shippedBranches.add(unknown.headRefName);
    const cache = new Map();

    await reconcileHaltPrs({
      projectRoot: CWD,
      runGh: fixture.gh,
      operations: fixture.operations,
      runGit: fixture.runGit,
      cache,
    });

    expect(fixture.writes).toEqual([]);
    expect(fixture.rawMutationCalls).toEqual([]);
    expect(foreign).toMatchObject({ isDraft: false, labels: [], body: expect.stringContaining(NEEDS_REMEDIATION_BODY_MARKER) });
    expect(unknown).toMatchObject({ isDraft: true, labels: ['needs-remediation'], body: expect.stringContaining(NEEDS_REMEDIATION_BODY_MARKER) });
    expect(cache).toEqual(new Map([[foreign.url, 'clear-unconfirmed'], [unknown.url, 'clear-unconfirmed']]));
    expect(fixture.attempts.map((request) => request.target)).toEqual(expect.arrayContaining([
      { repository: REPOSITORY, kind: 'pull-request', number: foreign.number },
      { repository: REPOSITORY, kind: 'pull-request', number: unknown.number },
    ]));
  });

  it('continues past a refused PR and never caches refusal as healed or cleared', async () => {
    const refused = marked(12, 'foreign', { isDraft: false, labels: [] });
    const authorized = marked(13, 'owned', { isDraft: false, labels: [] });
    const fixture = reconciliationFixture([refused, authorized]);
    fixture.refused.set(refused.number, 'other-owner');
    const cache = new Map();

    await reconcileHaltPrs({
      projectRoot: CWD,
      runGh: fixture.gh,
      operations: fixture.operations,
      runGit: fixture.runGit,
      cache,
    });

    expect(refused).toMatchObject({ isDraft: false, labels: [] });
    expect(authorized).toMatchObject({ isDraft: true, labels: ['needs-remediation'] });
    expect(cache.get(refused.url)).toBe('unconfirmed');
    expect(cache.get(authorized.url)).toBe('healed');
    expect(cache.get(refused.url)).not.toMatch(/healed|cleared/);

    fixture.refused.delete(refused.number);
    await reconcileHaltPrs({
      projectRoot: CWD,
      runGh: fixture.gh,
      operations: fixture.operations,
      runGit: fixture.runGit,
      cache,
    });

    expect(refused).toMatchObject({ isDraft: true, labels: ['needs-remediation'] });
    expect(cache.get(refused.url)).toBe('healed');
  });
});
