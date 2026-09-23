// Covers: task:11, task:12
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { buildPrFixture, skipReplay, type PrFixture } from './autoresolve-pr-fixture.js';
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

describe('resolveConflictingPr — judged publication audit (real git, stubbed gh)', () => {
  const suiteCommand = 'npm run test:ci';
  const rationale = 'upstream rewrote the assertion';
  const fixture = (failCommentContaining?: string) => buildPrFixture({
    initial: { 'rewrite.test.ts': 'base\n' },
    feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
    main: { 'rewrite.test.ts': 'upstream\n' },
    failCommentContaining,
  });
  const run = (fx: PrFixture, order: string[], events: never = fx.events) =>
    resolveConflictingPr(
      { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo },
      'feature',
      { enabled: true, suiteCommand, cooldownMinutes: 0, attemptCap: 2 },
      {
        runGh: async (args, opts) => {
          if (args[1] === 'comment' && (args[args.indexOf('--body') + 1] ?? '').includes(SUPERSESSION_AUDIT_MARKER)) {
            order.push('audit');
          }
          return fx.gh(args, opts);
        },
        runSuite: async () => {
          order.push('suite');
          return { exitCode: 0, durationMs: 0, configured: true };
        },
        resolver: async ({ projectRoot }) => {
          await skipReplay(projectRoot);
          return { resolved: true, verdict: { choice: 'superseded', rationale, superseded: [fx.shas[0]] } };
        },
        log: fx.log,
        events,
      },
    );

  it('S4.1: posts the audit after the suite, naming choice, rationale, superseded sha and the passing command', async () => {
    const fx = await fixture();
    try {
      const order: string[] = [];
      expect(await run(fx, order)).toEqual({ kind: 'refreshed' });
      expect(order).toEqual(['suite', 'audit']);
      const audits = fx.commentBodies().filter((body) => body.includes(SUPERSESSION_AUDIT_MARKER));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toContain('**Choice:** superseded');
      expect(audits[0]).toContain(rationale);
      expect(audits[0]).toContain(fx.shas[0]);
      expect(audits[0]).toContain(`\`${suiteCommand}\` (exit 0)`);
    } finally {
      await fx.cleanup();
    }
  });

  it('S4.2: emits exactly one verdict event and persists it to the feature event log', async () => {
    const fx = await fixture();
    const featureWorktree = join(fx.repo, '.feature-worktree');
    const bus = new ConductorEventEmitter();
    const scope = startFeatureEventPersistence(featureWorktree, bus, 'feature');
    try {
      expect(await run(fx, [], scope.events as never)).toEqual({ kind: 'refreshed' });
      scope.stop();
      const lines = (await readFile(join(featureWorktree, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
      const verdicts = lines.filter((line) => line.type === 'rebase_supersession_verdict');
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]).toMatchObject({
        choice: 'superseded',
        rationale,
        superseded: [fx.shas[0]],
        verification: { command: suiteCommand, exitCode: 0 },
      });
    } finally {
      scope.stop();
      await fx.cleanup();
    }
  });

  it('S4.4: a failing audit comment keeps the publication, logs the failure, and still emits the event', async () => {
    const fx = await fixture(SUPERSESSION_AUDIT_MARKER);
    try {
      expect(await run(fx, [])).toEqual({ kind: 'refreshed' });
      expect(await fx.pushes()).toBe(1);
      expect(fx.logs.some((line) => line.includes(fx.prUrl) && line.includes('gh comment unavailable'))).toBe(true);
      expect(fx.emitted.filter((event) => event.type === 'rebase_supersession_verdict')).toHaveLength(1);
    } finally {
      await fx.cleanup();
    }
  });
});
