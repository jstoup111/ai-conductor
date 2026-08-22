/**
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
import { mkdtemp, rm, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { gateVerdictStillValid } from '../../src/engine/gate-code-validity.js';
import { BUILD_REVIEW_VERDICT } from '../../src/engine/artifacts.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';

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

describe('gateVerdictStillValid', () => {
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
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness') => ({
      kind: 'judged' as const,
      rubric,
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
        tautology: judged('tautology'),
        scope: judged('scope'),
        rootCause: judged('rootCause'),
        completeness: judged('completeness'),
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
