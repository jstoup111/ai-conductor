/**
 * Covers: task:2, task:7
 *
 * Task 2 (gate-step-completion-validates-against-code-state-, #817): unit
 * tests for `gateVerdictStillValid`, the shared re-dispatch decision helper.
 *
 * Proves the task's own verify slice of the full truth table (Task 9 adds
 * the rest): reachable+miss→preserve, reachable+hit→rerun, orphan→rerun,
 * uncomputable→rerun, no-stamp→rerun. Uses a real scratch git repo (not a
 * fake GitRunner) so ancestry/diff computation is exercised for real,
 * mirroring `rebase-autostash.test.ts`'s convention.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  gateVerdictStillValid,
  currentPreservedJudgeIdentity,
  rebaseOperationPublicationBlocker,
  verdictProducedByRun,
} from '../../src/engine/gate-code-validity.js';
import {
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  BUILD_REVIEW_VERDICT,
  FINISH_CHOICE_MARKER,
  MANUAL_TEST_CODE_STAMP,
  PRD_AUDIT_CODE_STAMP,
} from '../../src/engine/artifacts.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  checkGateCompletion,
  computeAndWriteVerdict,
  readVerdict,
  writeVerdict,
  type ReplayPreservationRecord,
} from '../../src/engine/gate-verdicts.js';

interface Scratch {
  repo: string;
  git: ReturnType<typeof makeGitRunner>;
}

async function makeRepo(): Promise<Scratch> {
  const repo = await mkdtemp(join(tmpdir(), 'gate-code-validity-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.com']);
  await git(['config', 'user.name', 'T']);
  await git(['config', 'commit.gpgsign', 'false']);
  return { repo, git };
}

async function commit(
  { repo, git }: Scratch,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(repo, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await git(['add', '.']);
  await git(['commit', '-q', '-m', message]);
  const r = await git(['rev-parse', 'HEAD']);
  return r.stdout.trim();
}

async function writeBuildReviewIdentity(s: Scratch, codeStamp: string, runId = 'run-1') {
  const lapId = `lap-${codeStamp}`;
  const artifact = JSON.stringify({ codeStamp, lapId });
  await mkdir(join(s.repo, '.pipeline'), { recursive: true });
  await writeFile(join(s.repo, BUILD_REVIEW_VERDICT), artifact);
  await writeFile(join(s.repo, '.pipeline', 'conduct-session-id'), runId);
  return {
    artifactDigest: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
    attemptId: lapId,
    runId: lapId,
    codeStamp,
  };
}

/**
 * Wires up a real `origin` remote with `refs/remotes/origin/HEAD` pointed at
 * `main`, so `deriveFeatureSurface` (which computes `F` from
 * `merge-base(origin/<default>, HEAD)`) has something non-empty to compute
 * against. Needed for `feature-runtime`/`all-runtime` surface-hit cases,
 * which distinguish "the feature's own claimed surface" from "foreign"
 * runtime paths — `any-codetest` doesn't consult `F` at all, so the existing
 * `build_review` tests don't need this.
 */
async function addOriginRemote(s: Scratch): Promise<string> {
  const originDir = await mkdtemp(join(tmpdir(), 'gate-code-validity-origin-'));
  scratches.push(originDir);
  const originGit = makeGitRunner(originDir);
  await originGit(['init', '-q', '--bare', '-b', 'main']);

  await s.git(['remote', 'add', 'origin', originDir]);
  await s.git(['push', '-q', 'origin', 'main']);
  await s.git(['fetch', '-q', 'origin']);
  await s.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  return originDir;
}

const scratches: string[] = [];
afterEach(async () => {
  while (scratches.length) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

// Covers: task:5
describe('verdictProducedByRun', () => {
  const verdictGates = [
    ['prd_audit', PRD_AUDIT_CODE_STAMP],
    ['architecture_review_as_built', ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP],
    ['manual_test', MANUAL_TEST_CODE_STAMP],
  ] as const;

  for (const [gate, sidecar] of verdictGates) {
    it(`returns match for ${gate} when its sidecar carries the expected run id`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
      scratches.push(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, sidecar), JSON.stringify({ runId: 'run-current' }));

      const result = await verdictProducedByRun(dir, gate, 'run-current');

      expect(result).toEqual({ state: 'match', runId: 'run-current' });
    });

    it(`returns typed stale-run-identity for ${gate} when its sidecar carries another run id`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
      scratches.push(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, sidecar), JSON.stringify({ runId: 'run-prior' }));

      const result = await verdictProducedByRun(dir, gate, 'run-current');

      expect(result).toEqual({
        state: 'stale-run-identity',
        expectedRunId: 'run-current',
        foundRunId: 'run-prior',
      });
    });

    it(`falls back to mtime for ${gate} when its sidecar is missing, unstamped, or corrupt`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
      scratches.push(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });

      await expect(verdictProducedByRun(dir, gate, 'run-current')).resolves.toEqual({
        state: 'unstamped',
      });

      await writeFile(join(dir, sidecar), JSON.stringify({ codeStamp: 'head' }));
      await expect(verdictProducedByRun(dir, gate, 'run-current')).resolves.toEqual({
        state: 'unstamped',
      });

      await writeFile(join(dir, sidecar), '{not-json');
      await expect(verdictProducedByRun(dir, gate, 'run-current')).resolves.toEqual({
        state: 'unstamped',
      });
    });
  }

  it('falls back to mtime when no expected run id is available for a legacy context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
    scratches.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, PRD_AUDIT_CODE_STAMP), JSON.stringify({ runId: 'run-prior' }));

    await expect(verdictProducedByRun(dir, 'prd_audit', undefined)).resolves.toEqual({
      state: 'unstamped',
    });
  });

  it('returns unstamped when gate-code-validity is disabled, even for a matching sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
    scratches.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, PRD_AUDIT_CODE_STAMP), JSON.stringify({ runId: 'run-current' }));

    await expect(
      verdictProducedByRun(dir, 'prd_audit', 'run-current', {
        gate_code_validity: { enabled: false },
      }),
    ).resolves.toEqual({ state: 'unstamped' });
  });
});

describe('gateVerdictStillValid', () => {
  it('preserves a fully bound applied replay despite an upstream edit in the originally reviewed file', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const original = await commit(s, { 'src/shared.ts': 'original\n' }, 'original reviewed work');
    const completed = await commit(s, { 'src/shared.ts': 'upstream plus replay\n' }, 'completed clean replay');
    const expectedTree = (await s.git(['rev-parse', `${completed}^{tree}`])).stdout.trim();
    const replay = {
      preRebaseHead: original,
      mergeBase: original,
      target: original,
      completedHead: completed,
      expectedTree,
    };
    const identity = await writeBuildReviewIdentity(s, original);
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 1,
      preservation: {
        gate: 'build_review',
        original: identity,
        replay,
        relevantInputIdentities: ['.docs/plans/feature.md@sha256:plan'],
        operationId: 'rebase-1',
      },
    });
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 1,
      rebaseOperation: {
        id: 'rebase-1',
        status: 'applied',
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay,
      },
    });

    await expect(gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'build_review', original)).resolves.toBe('preserve');
  });

  it('allows an applied operation to record completed BUILD without inventing a build verdict', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const original = await commit(s, { 'src/shared.ts': 'original\n' }, 'original reviewed work');
    const completed = await commit(s, { 'src/shared.ts': 'replayed\n' }, 'completed replay');
    const replay = {
      preRebaseHead: original,
      mergeBase: original,
      target: original,
      completedHead: completed,
      expectedTree: (await s.git(['rev-parse', `${completed}^{tree}`])).stdout.trim(),
    };
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 1,
      rebaseOperation: {
        id: 'rebase-verified-build',
        status: 'applied',
        transition: { preserved: [], invalidated: [], reverified: ['build'] },
        replay,
      },
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('accepts a fresh satisfied re-judgement for a preserved gate', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'fresh-prd-audit',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('anchors a fresh re-judgement to appliedAt after a later rebase verdict rewrite', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'rewritten-rebase-verdict',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 300,
      reason: 'branch already current with base',
    });

    expect((await readVerdict(s.repo, 'rebase'))?.rebaseOperation?.appliedAt).toBe(100);
    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('falls back to the rebase verdict timestamp for legacy operations without appliedAt', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 100,
      rebaseOperation: {
        id: 'legacy-rebase-operation',
        status: 'applied',
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it.each([200, 150])('blocks an unstamped satisfied verdict checked at %i or before appliedAt', async (checkedAt) => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 250,
      rebaseOperation: {
        id: `unstamped-${checkedAt}`,
        status: 'applied',
        appliedAt: 200,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition preserved prd_audit without its replay-bound authority',
    );
  });

  it('blocks a newer unstamped satisfied verdict carrying a kickback', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'kicked-back-prd-audit',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', {
      satisfied: true,
      checkedAt: 200,
      kickback: { from: 'rebase', evidence: 'x' },
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition preserved prd_audit without its replay-bound authority',
    );
  });

  it('blocks an unsatisfied preserved build review as outstanding repair work', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'unsatisfied-build-review',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', { satisfied: false, checkedAt: 200 });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition still has an outstanding build_review repair or re-verification',
    );
  });

  it('blocks a missing preserved build review as outstanding repair work', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'missing-build-review',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition still has an outstanding build_review repair or re-verification',
    );
  });

  it('blocks a preserved build review stamped for another operation', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'expected-operation',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 200,
      preservation: { gate: 'build_review', operationId: 'other-operation' } as ReplayPreservationRecord,
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition preserved build_review without its replay-bound authority',
    );
  });

  it('blocks a newer preserved build review stamped for another gate', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const operationId = 'wrong-preservation-gate';
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: operationId,
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 200,
      preservation: { gate: 'prd_audit', operationId } as ReplayPreservationRecord,
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBe(
      'rebase transition preserved build_review without its replay-bound authority',
    );
  });

  it('accepts a correctly bound preserved verdict even when its checkedAt predates appliedAt', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const operationId = 'old-bound-build-review';
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 250,
      rebaseOperation: {
        id: operationId,
        status: 'applied',
        appliedAt: 200,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 100,
      preservation: { gate: 'build_review', operationId } as ReplayPreservationRecord,
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('retains a correctly bound preservation stamp during a satisfied build-review recheck', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const operationId = 'retained-build-review-stamp';
    const preservation = { gate: 'build_review', operationId } as ReplayPreservationRecord;
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 250,
      rebaseOperation: {
        id: operationId,
        status: 'applied',
        appliedAt: 200,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    await writeFile(join(s.repo, BUILD_REVIEW_VERDICT), JSON.stringify({
      verdict: 'PASS',
      rubric: { testQuality: false, security: false },
    }));
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 100,
      preservation,
    });

    const rechecked = await computeAndWriteVerdict(s.repo, 'build_review', {}, { retainReplayPreservation: true });

    expect(rechecked.satisfied).toBe(true);
    expect((await readVerdict(s.repo, 'build_review'))?.preservation).toEqual(preservation);
    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('allows finish completion through the production predicate for a fresh preserved-gate re-judgement', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: 'finish-fresh-prd-audit',
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });
    await writeFile(join(s.repo, FINISH_CHOICE_MARKER), 'keep');

    const result = await checkGateCompletion(s.repo, 'finish', {});

    expect(result.done).toBe(true);
    expect(result.reason ?? '').not.toContain('replay-bound authority');
    expect(result.reason ?? '').not.toContain('outstanding prd_audit');
  });

  it('keeps finish incomplete for an unstamped preserved verdict not newer than appliedAt', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 250,
      rebaseOperation: {
        id: 'finish-stale-prd-audit',
        status: 'applied',
        appliedAt: 200,
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });
    await writeFile(join(s.repo, FINISH_CHOICE_MARKER), 'keep');

    const result = await checkGateCompletion(s.repo, 'finish', {});

    expect(result).toMatchObject({
      done: false,
      reason: 'rebase transition preserved prd_audit without its replay-bound authority',
    });
  });

  it('accepts a fresh re-judgement beside a correctly bound preserved verdict', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const operationId = 'mixed-preserved-gates';
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        id: operationId,
        status: 'applied',
        appliedAt: 100,
        transition: { preserved: ['build_review', 'prd_audit'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 50,
      preservation: { gate: 'build_review', operationId } as ReplayPreservationRecord,
    });
    await writeVerdict(s.repo, 'prd_audit', { satisfied: true, checkedAt: 200 });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('keeps correctly bound replay preservation authority for a preserved gate', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const operationId = 'bound-build-review';
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 250,
      rebaseOperation: {
        id: operationId,
        status: 'applied',
        appliedAt: 200,
        transition: { preserved: ['build_review'], invalidated: [], reverified: [] },
        replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      },
    });
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 100,
      preservation: { gate: 'build_review', operationId } as ReplayPreservationRecord,
    });

    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toBeNull();
  });

  it('keeps an interrupted rebase operation non-publishable when a later rebase verdict is rewritten', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const original = await commit(s, { 'src/shared.ts': 'original\n' }, 'original work');
    const completed = await commit(s, { 'src/shared.ts': 'rebased\n' }, 'replayed work');
    const applying = {
      id: 'interrupted-rebase',
      status: 'applying' as const,
      transition: { preserved: [], invalidated: ['test_suite'] as const, reverified: [] },
      replay: {
        preRebaseHead: original,
        mergeBase: original,
        target: original,
        completedHead: completed,
        expectedTree: (await s.git(['rev-parse', `${completed}^{tree}`])).stdout.trim(),
      },
    };
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 1,
      rebaseOperation: applying,
    });

    // This is the daemon re-kick's already-current/no-op rewrite. It must not
    // discard the descriptor before the transition service can reconcile it.
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 2,
      reason: 'branch already current with base',
    });

    expect((await readVerdict(s.repo, 'rebase'))?.rebaseOperation).toEqual(applying);
    await expect(rebaseOperationPublicationBlocker(s.repo)).resolves.toContain('still applying');
  });

  it('refuses malformed, unapplied, superseded, unavailable, and post-replay preservation authority', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const original = await commit(s, { 'src/shared.ts': 'original\n' }, 'original reviewed work');
    const completed = await commit(s, { 'src/shared.ts': 'upstream plus replay\n' }, 'completed clean replay');
    const expectedTree = (await s.git(['rev-parse', `${completed}^{tree}`])).stdout.trim();
    const replay = { preRebaseHead: original, mergeBase: original, target: original, completedHead: completed, expectedTree };
    const identity = await writeBuildReviewIdentity(s, original);
    const preservation: ReplayPreservationRecord = {
      gate: 'build_review',
      original: identity,
      replay,
      relevantInputIdentities: ['.docs/plans/feature.md@sha256:plan'],
      operationId: 'rebase-1',
    };
    const writeApplied = async (preserved: ReplayPreservationRecord = preservation, status: 'applying' | 'applied' = 'applied') => {
      await writeVerdict(s.repo, 'build_review', { satisfied: true, checkedAt: 1, preservation: preserved });
      await writeVerdict(s.repo, 'rebase', {
        satisfied: true,
        checkedAt: 1,
        rebaseOperation: {
          id: 'rebase-1', status, transition: { preserved: ['build_review'], invalidated: [], reverified: [] }, replay,
        },
      });
    };
    const validity = () => gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'build_review', original);

    await writeVerdict(s.repo, 'build_review', { satisfied: true, checkedAt: 1, preservation: {} as never });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, gate: 'prd_audit' });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, original: { ...preservation.original, attemptId: '' } });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, original: { ...preservation.original, artifactDigest: 'sha256:different' } });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, original: { ...preservation.original, attemptId: 'another-attempt' } });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, original: { ...preservation.original, runId: 'another-run' } });
    await expect(validity()).resolves.toBe('rerun');

    // An empty list was emitted by the earlier writer's active-input slice.
    // It cannot explain that every current review input remains unchanged.
    await writeApplied({ ...preservation, relevantInputIdentities: [] });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied(preservation, 'applying');
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied({ ...preservation, replay: { ...replay, expectedTree: '0'.repeat(40) } });
    await expect(validity()).resolves.toBe('rerun');

    await writeApplied();
    await commit(s, { '.docs/plans/feature.md': 'relevant input changed\n' }, 'post-replay plan change');
    await expect(validity()).resolves.toBe('rerun');

    await writeVerdict(s.repo, 'build_review', {
      satisfied: false,
      checkedAt: 2,
      reason: 'repair required',
      kickback: { from: 'build', evidence: 'ordinary repair' },
    });
    await expect(validity()).resolves.toBe('rerun');
  });

  it('refuses replay preservation when an aggregate-suite repair is outstanding', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const original = await commit(s, { 'src/shared.ts': 'original\n' }, 'original reviewed work');
    const completed = await commit(s, { 'src/shared.ts': 'upstream plus replay\n' }, 'completed clean replay');
    const replay = {
      preRebaseHead: original,
      mergeBase: original,
      target: original,
      completedHead: completed,
      expectedTree: (await s.git(['rev-parse', `${completed}^{tree}`])).stdout.trim(),
    };
    const identity = await writeBuildReviewIdentity(s, original);
    await writeVerdict(s.repo, 'build_review', {
      satisfied: true,
      checkedAt: 1,
      preservation: {
        gate: 'build_review',
        original: identity,
        replay,
        relevantInputIdentities: [],
        operationId: 'rebase-1',
      },
    });
    await writeVerdict(s.repo, 'rebase', {
      satisfied: true,
      checkedAt: 1,
      rebaseOperation: {
        id: 'rebase-1', status: 'applied', transition: { preserved: ['build_review'], invalidated: [], reverified: [] }, replay,
      },
    });
    await writeVerdict(s.repo, 'test_suite', {
      satisfied: false,
      checkedAt: 2,
      kickback: { from: 'rebase', evidence: 'aggregate suite repair required' },
    });

    await expect(gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'build_review', original)).resolves.toBe('rerun');
  });

  it('returns rerun when codeStamp is absent', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      undefined,
    );
    expect(result).toBe('rerun');
  });

  it('returns rerun when codeStamp is null', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      null,
    );
    expect(result).toBe('rerun');
  });

  it('returns preserve when the baseline is reachable and the delta since it is empty (surface miss)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('preserve');
  });

  it('does not let a preserved aggregate bypass its effective verdict resolver', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    const lapId = parseBuildReviewLapId('lap-preserved')!;
    const judged = () => ({
      kind: 'judged' as const,
      rubric: 'testQuality' as const,
      lapId,
      snapshotDigest: 'sha256:snapshot',
      contractVersion: 'v1' as never,
      findings: [],
      verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: 'sha256:snapshot',
      codeStamp: baseline,
      results: {
        testQuality: judged(),
      },
    });
    const artifact = join(s.repo, BUILD_REVIEW_VERDICT);
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    await writeFile(artifact, JSON.stringify(aggregate));
    await utimes(artifact, new Date(0), new Date(0));

    await expect(checkGateCompletion(s.repo, 'build_review', {
      git: s.git,
      sessionStartedAt: Date.now(),
      buildReviewEffectiveResolver: async () => ({
        ok: false as const,
        reason: 'disposition state is unavailable',
      }),
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringMatching(/disposition resolution failed/i),
    });
  });

  it('returns rerun when the baseline is reachable but the delta touches the surface (surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('rerun');
  });

  it('returns rerun when the stamped baseline is orphaned (unreachable in current history)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const orphaned = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await s.git(['commit', '--amend', '-q', '-m', 'init (amended)']);
    const isAncestor = await s.git(['merge-base', '--is-ancestor', orphaned, 'HEAD']);
    expect(isAncestor.exitCode).not.toBe(0); // sanity: fixture really orphaned it

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      orphaned,
    );
    expect(result).toBe('rerun');
  });

  it('preserves an orphaned baseline that rebase-rewrites.json maps to a reachable rewritten commit (surface miss)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    const orphaned = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await s.git(['commit', '--amend', '-q', '-m', 'init (replayed)']);
    const rewritten = (await s.git(['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(s.repo, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({ [orphaned]: rewritten }));

    const result = await gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'build_review', orphaned);
    expect(result).toBe('preserve');
  });

  it('re-runs an orphaned baseline whose rewrite still leaves a code delta to HEAD (surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    const orphaned = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await s.git(['commit', '--amend', '-q', '-m', 'init (replayed)']);
    const rewritten = (await s.git(['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(s.repo, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({ [orphaned]: rewritten }));
    await commit(s, { 'src/a.ts': 'changed\n' }, 'later code change');

    const result = await gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'build_review', orphaned);
    expect(result).toBe('rerun');
  });

  it('returns rerun when the delta from the stamped baseline is uncomputable (bogus sha)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      '0'.repeat(40),
    );
    expect(result).toBe('rerun');
  });

  // Task 9: full truth table across the three GATE_SURFACE kinds. The
  // 'any-codetest' kind (build_review) is already fully proven above (miss +
  // hit); this block covers 'all-runtime' (manual_test) and
  // 'feature-runtime' (prd_audit), each with its own miss + hit case.

  it('all-runtime (manual_test): returns preserve when the delta is docs-only (surface miss)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n' }, 'init');
    await addOriginRemote(s);
    const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');
    await commit(s, { 'docs/notes.md': 'notes\n' }, 'docs only');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'manual_test',
      baseline,
    );
    expect(result).toBe('preserve');
  });

  it('all-runtime (manual_test): returns rerun when the delta touches a foreign runtime path outside the feature surface (surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n', 'src/other.ts': 'o\n' }, 'init');
    await addOriginRemote(s);
    // Feature branch only ever claims src/feature.ts as its own surface (F).
    const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');
    // Post-baseline change to src/other.ts is a foreign runtime path: not in
    // F, but still a runtime source path — must invalidate an all-runtime
    // gate even though it's not the feature's own surface.
    await commit(s, { 'src/other.ts': 'o2\n' }, 'foreign runtime change');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'manual_test',
      baseline,
    );
    expect(result).toBe('rerun');
  });

  it('feature-runtime-or-prd-inputs (prd_audit): returns preserve when the delta is unrelated docs-only (surface miss)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n' }, 'init');
    await addOriginRemote(s);
    const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');
    await commit(s, { 'docs/notes.md': 'notes\n' }, 'docs only');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'prd_audit',
      baseline,
    );
    expect(result).toBe('preserve');
  });

  it.each(['.docs/stories/happy-path.md', '.docs/specs/feature-prd.md'])(
    'feature-runtime-or-prd-inputs (prd_audit): returns rerun when a declared document input changes (%s)',
    async (documentInput) => {
      const s = await makeRepo();
      scratches.push(s.repo);
      await commit(s, { 'src/feature.ts': 'f\n' }, 'init');
      await addOriginRemote(s);
      const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');
      await commit(s, { [documentInput]: 'changed\n' }, 'update prd audit input');

      const result = await gateVerdictStillValid(
        { projectRoot: s.repo, git: s.git },
        'prd_audit',
        baseline,
      );
      expect(result).toBe('rerun');
    },
  );

  it.each([
    ['.docs/stories/referenced-story.md', 'rerun'],
    ['.docs/plans/active.md', 'preserve'],
    ['.docs/coherence/active.md', 'preserve'],
    ['.docs/stories/foreign.md', 'preserve'],
  ])('prd_audit resume scopes review inputs at %s to the active plan', async (path, expected) => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const plan = '**Stories:** .docs/stories/referenced-story.md\n';
    const baseline = await commit(s, {
      '.docs/plans/active.md': plan,
      '.docs/stories/referenced-story.md': '# original criteria\n',
      '.pipeline/conduct-state.json': JSON.stringify({ feature_desc: 'active' }),
    }, 'approved inputs');
    await commit(s, { [path]: path.includes('/plans/') ? `${plan}Updated Done when.\n` : 'updated input\n' }, 'input update');

    expect(await gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'prd_audit', baseline)).toBe(expected);
  });

  it('architecture_review_as_built re-runs when a governing decision input changes', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, {
      '.docs/plans/active.md': '# plan\n',
      '.pipeline/conduct-state.json': JSON.stringify({ feature_desc: 'active' }),
      'src/feature.ts': 'f\n',
    }, 'approved inputs');
    await commit(s, { '.docs/decisions/adr-governing.md': 'updated authority\n' }, 'update governing decision');

    await expect(
      gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, 'architecture_review_as_built', baseline),
    ).resolves.toBe('rerun');
  });

  // Operator-accepted widening (prd_audit NC.1): outside any rebase, a
  // `.docs/decisions/` edit stales the gates that consume governing ADRs, and
  // nothing else.
  it.each([
    ['architecture_review_as_built', '.docs/decisions/adr-governing.md', 'rerun'],
    ['coverage_binding', '.docs/decisions/adr-governing.md', 'rerun'],
    ['architecture_review_as_built', '.docs/notes/unrelated.md', 'preserve'],
    ['prd_audit', '.docs/decisions/adr-governing.md', 'preserve'],
    ['build_review', '.docs/decisions/adr-governing.md', 'preserve'],
  ])('%s with no rebase involved: a change at %s resolves %s', async (gate, path, expected) => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, {
      '.docs/plans/active.md': '# plan\n',
      '.pipeline/conduct-state.json': JSON.stringify({ feature_desc: 'active' }),
      'src/feature.ts': 'f\n',
    }, 'approved inputs');
    await commit(s, { [path]: 'updated\n' }, 'document update');

    await expect(gateVerdictStillValid({ projectRoot: s.repo, git: s.git }, gate, baseline)).resolves.toBe(expected);
  });

  it('reads the preserved coverage identity from its declared artifact', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    // The production pair: a closed five-key envelope plus the runner's stamp.
    await writeFile(join(s.repo, '.pipeline/coverage-binding.json'), JSON.stringify({
      version: 1, slug: 'active', runId: 'coverage-run', status: 'done', entries: [],
    }));
    await writeFile(join(s.repo, '.pipeline/coverage-binding-code-stamp.json'), JSON.stringify({ runId: 'coverage-run', codeStamp: 'coverage-head' }));
    await expect(currentPreservedJudgeIdentity(s.repo, 'coverage_binding')).resolves.toMatchObject({
      attemptId: 'coverage-run', runId: 'coverage-run', codeStamp: 'coverage-head',
    });
  });

  it('rejects coverage preservation when its declared artifact lacks a code stamp', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await mkdir(join(s.repo, '.pipeline'), { recursive: true });
    await writeFile(join(s.repo, '.pipeline/coverage-binding.json'), JSON.stringify({ version: 1, slug: 'active', runId: 'coverage-run', status: 'done', entries: [] }));
    await expect(currentPreservedJudgeIdentity(s.repo, 'coverage_binding')).resolves.toBeNull();
    // A stamp left by an earlier run does not identify this envelope.
    await writeFile(join(s.repo, '.pipeline/coverage-binding-code-stamp.json'), JSON.stringify({ runId: 'older-run', codeStamp: 'coverage-head' }));
    await expect(currentPreservedJudgeIdentity(s.repo, 'coverage_binding')).resolves.toBeNull();
  });

  it('feature-codetest (build_review): returns preserve when the delta touches only a FOREIGN runtime path', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n', 'src/other.ts': 'o\n' }, 'init');
    await addOriginRemote(s);

    // Feature branch claims only src/feature.ts.
    await s.git(['checkout', '-q', '-b', 'feature']);
    const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');

    // Base advances with a foreign runtime change, which the feature then
    // absorbs (as a rebase would). src/other.ts is in the delta since the
    // baseline, but outside F — it cannot change the feature's own diff, so
    // build_review's plan-vs-diff grade still holds.
    await s.git(['checkout', '-q', 'main']);
    await commit(s, { 'src/other.ts': 'o2\n' }, 'foreign runtime change');
    await s.git(['push', '-q', 'origin', 'main']);
    await s.git(['fetch', '-q', 'origin']);
    await s.git(['checkout', '-q', 'feature']);
    await s.git(['merge', '-q', '--no-edit', 'main']);

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('preserve');
  });

  it("feature-codetest (build_review): returns rerun when the delta touches the feature's OWN test file", async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n' }, 'init');
    await addOriginRemote(s);
    const baseline = await commit(
      s,
      { 'src/feature.ts': 'f2\n', 'src/feature.test.ts': 't\n' },
      'feature work',
    );
    // The feature's own test file is in F but partitions into `test`, not
    // `featureSrc` — plain feature-runtime would wrongly preserve here.
    await commit(s, { 'src/feature.test.ts': 't2\n' }, 'feature test change');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('rerun');
  });

  it('feature-codetest (build_review): fails closed to rerun when the feature surface is underivable and the delta touches code', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    // No origin remote → deriveFeatureSurface returns []. Everything is
    // "foreign" by construction, so preserving would be unsound.
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('rerun');
  });

  it('feature-runtime (prd_audit): returns rerun when the delta since baseline touches the feature\'s own surface (surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/feature.ts': 'f\n' }, 'init');
    await addOriginRemote(s);
    const baseline = await commit(s, { 'src/feature.ts': 'f2\n' }, 'feature work');
    // Further edit to src/feature.ts: still within F (diff of origin..HEAD
    // includes src/feature.ts regardless of which commit changed it), so
    // this is a featureSrc hit, not a foreign-only change.
    await commit(s, { 'src/feature.ts': 'f3\n' }, 'more feature work');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'prd_audit',
      baseline,
    );
    expect(result).toBe('rerun');
  });
});
