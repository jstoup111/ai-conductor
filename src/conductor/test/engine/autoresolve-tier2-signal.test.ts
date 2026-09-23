// Covers: task:4
import { describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveConflictingPr, runTier2 } from '../../src/engine/autoresolve.js';
import { conflictedFiles, makeGitRunner, type ResolutionContext } from '../../src/engine/rebase.js';
import { PASSING_SUITE, buildPrFixture, settleAndContinue } from './autoresolve-pr-fixture.js';

const execFile = promisify(execFileCb);

const mixedFixture = () => buildPrFixture({
  initial: { 'app.ts': 'base\n', 'app.test.ts': 'base\n' },
  feature: [{ subject: 'feat: change app and test', files: { 'app.ts': 'feature\n', 'app.test.ts': 'feature\n' } }],
  main: { 'app.ts': 'upstream\n', 'app.test.ts': 'upstream\n' },
});
const testOnlyFixture = () => buildPrFixture({
  initial: { 'rewrite.test.ts': 'base\n' },
  feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
  main: { 'rewrite.test.ts': 'upstream\n' },
});

/** Pause a real rebase of `feature` onto main and hand the conflicts to runTier2. */
async function tier2Context(
  fixture: Awaited<ReturnType<typeof buildPrFixture>>,
  scope: 'test-only' | 'mixed',
  settle: Record<string, string>,
): Promise<ResolutionContext[]> {
  await execFile('git', ['checkout', '-q', 'feature'], { cwd: fixture.repo });
  await execFile('git', ['rebase', 'main'], { cwd: fixture.repo }).catch(() => undefined);
  const git = makeGitRunner(fixture.repo);
  const conflicts = await conflictedFiles(git);
  const seen: ResolutionContext[] = [];
  await runTier2(git, fixture.repo, 'main', conflicts, 1, async (ctx) => {
    seen.push(ctx);
    await settleAndContinue(ctx.projectRoot, settle);
    return { resolved: true };
  }, scope);
  return seen;
}

describe('runTier2 — sweep judgement signal', () => {
  it('passes the exception only for a test-only scope', async () => {
    const fx = await testOnlyFixture();
    try {
      const seen = await tier2Context(fx, 'test-only', { 'rewrite.test.ts': 'merged\n' });
      expect(seen.map((ctx) => ctx.supersessionJudgement)).toEqual([true]);
    } finally {
      await fx.cleanup();
    }
  });

  it('withholds the exception from a mixed test and non-test conflict', async () => {
    const fx = await mixedFixture();
    try {
      const seen = await tier2Context(fx, 'mixed', { 'app.ts': 'merged\n', 'app.test.ts': 'merged\n' });
      expect(seen).toHaveLength(1);
      expect(seen[0].conflicts.sort()).toEqual(['app.test.ts', 'app.ts']);
      expect(seen[0].supersessionJudgement).toBe(false);
    } finally {
      await fx.cleanup();
    }
  });

  it('withholds the exception even when a test-only scope is claimed for a mixed conflict set', async () => {
    const fx = await mixedFixture();
    try {
      const seen = await tier2Context(fx, 'test-only', { 'app.ts': 'merged\n', 'app.test.ts': 'merged\n' });
      expect(seen.map((ctx) => ctx.supersessionJudgement)).toEqual([false]);
    } finally {
      await fx.cleanup();
    }
  });
});

describe('resolveConflictingPr — mixed conflict intent stop (S2.2)', () => {
  it('escalates an intent conflict in a mixed set at tier2-resolve without the exception or a push', async () => {
    const fx = await mixedFixture();
    try {
      const seen: ResolutionContext[] = [];
      const outcome = await resolveConflictingPr(
        { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo },
        'feature',
        { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 2 },
        {
          ...fx.deps,
          runSuite: PASSING_SUITE,
          resolver: async (ctx) => {
            seen.push(ctx);
            return { resolved: false, reason: 'intent conflict in app.ts: both sides change the return value' };
          },
          log: fx.log,
          events: fx.events,
        },
      );

      expect(outcome).toEqual({ kind: 'escalated' });
      expect(seen.map((ctx) => ctx.supersessionJudgement)).toEqual([false]);
      expect(await fx.pushes()).toBe(0);
      const body = fx.commentBodies().join('\n');
      expect(body).toContain('**Stage:** tier2-resolve');
      expect(body).toContain('intent conflict in app.ts');
    } finally {
      await fx.cleanup();
    }
  });
});
