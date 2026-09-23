// Covers: task:3
import { describe, expect, it } from 'vitest';
import { resolveConflictingPr, validateResolutionVerdict } from '../../src/engine/autoresolve.js';
import { SUPERSESSION_AUDIT_MARKER } from '../../src/engine/pr-labels.js';
import type { ResolutionAttempt } from '../../src/engine/rebase.js';
import {
  PASSING_SUITE,
  buildPrFixture,
  settleAndContinue,
  skipReplay,
  type PrFixture,
} from './autoresolve-pr-fixture.js';

describe('validateResolutionVerdict', () => {
  const valid = { choice: 'superseded', rationale: 'upstream contains it', superseded: ['abc'] };
  it('accepts only replayed test-only declarations from the closed schema', () => {
    expect(validateResolutionVerdict(valid, { scope: 'test-only', replayedShas: ['abc'] }).ok).toBe(true);
    expect(validateResolutionVerdict({ ...valid, choice: 'other' }, { scope: 'test-only', replayedShas: ['abc'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^malformed verdict:/) });
    expect(validateResolutionVerdict({ ...valid, rationale: '' }, { scope: 'test-only', replayedShas: ['abc'] })).toMatchObject({ ok: false });
    expect(validateResolutionVerdict(valid, { scope: 'mixed', replayedShas: ['abc'] })).toMatchObject({ ok: false });
    expect(validateResolutionVerdict(valid, { scope: 'test-only', replayedShas: [] })).toMatchObject({ ok: false });
  });
});

describe('resolveConflictingPr — rejected verdicts publish nothing (real git, stubbed gh)', () => {
  const run = (fx: PrFixture, resolver: (projectRoot: string) => Promise<ResolutionAttempt>) =>
    resolveConflictingPr(
      { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo },
      'feature',
      { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 2 },
      {
        runGh: fx.gh,
        runSuite: PASSING_SUITE,
        resolver: ({ projectRoot }) => resolver(projectRoot),
        log: fx.log,
        events: fx.events,
      },
    );
  const expectRejected = async (fx: PrFixture) => {
    expect(await fx.pushes()).toBe(0);
    const bodies = fx.commentBodies();
    expect(bodies.some((body) => body.includes(SUPERSESSION_AUDIT_MARKER))).toBe(false);
    expect(fx.emitted.filter((event) => event.type === 'rebase_supersession_verdict')).toEqual([]);
    const escalation = bodies.join('\n');
    expect(escalation).toContain('**Stage:** tier2-verdict');
    expect(escalation).toMatch(/\*\*Reason:\*\* malformed verdict:/);
  };
  const testOnly = () => buildPrFixture({
    initial: { 'rewrite.test.ts': 'base\n' },
    feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
    main: { 'rewrite.test.ts': 'upstream\n' },
  });

  it.each([
    { name: 'an unknown choice', verdict: { choice: 'guessed', rationale: 'r', superseded: [] } },
    { name: 'a missing rationale', verdict: { choice: 'merged', superseded: [] } },
  ])('S1.5: escalates $name at tier2-verdict without pushing', async ({ verdict }) => {
    const fx = await testOnly();
    try {
      const outcome = await run(fx, async (projectRoot) => {
        await settleAndContinue(projectRoot, { 'rewrite.test.ts': 'upstream\nfeature\n' });
        return { resolved: true, verdict: verdict as never };
      });
      expect(outcome).toEqual({ kind: 'escalated' });
      await expectRejected(fx);
    } finally {
      await fx.cleanup();
    }
  });

  it('S2.3: rejects a superseded declaration over a mixed test and non-test conflict', async () => {
    const fx = await buildPrFixture({
      initial: { 'app.ts': 'base\n', 'app.test.ts': 'base\n' },
      feature: [{ subject: 'feat: change app and test', files: { 'app.ts': 'feature\n', 'app.test.ts': 'feature\n' } }],
      main: { 'app.ts': 'upstream\n', 'app.test.ts': 'upstream\n' },
    });
    try {
      const outcome = await run(fx, async (projectRoot) => {
        await skipReplay(projectRoot);
        return { resolved: true, verdict: { choice: 'superseded', rationale: 'upstream covers it', superseded: [fx.shas[0]] } };
      });
      expect(outcome).toEqual({ kind: 'escalated' });
      await expectRejected(fx);
    } finally {
      await fx.cleanup();
    }
  });

  it('S3.5: rejects a declaration naming a commit this rebase never replayed', async () => {
    const fx = await testOnly();
    try {
      const outcome = await run(fx, async (projectRoot) => {
        await skipReplay(projectRoot);
        return { resolved: true, verdict: { choice: 'superseded', rationale: 'upstream covers it', superseded: ['f'.repeat(40)] } };
      });
      expect(outcome).toEqual({ kind: 'escalated' });
      await expectRejected(fx);
    } finally {
      await fx.cleanup();
    }
  });
});
