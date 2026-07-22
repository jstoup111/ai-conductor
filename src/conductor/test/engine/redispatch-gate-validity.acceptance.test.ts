/**
 * RED acceptance specs for jstoup111/ai-conductor#817
 * (gate-step-completion-validates-against-code-state-).
 *
 * Stories: `.docs/stories/gate-step-completion-validates-against-code-state-.md`
 * Plan:    `.docs/plans/gate-step-completion-validates-against-code-state-.md`
 * ADR:     `.docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`
 *
 * Nothing under this feature exists yet: verdict writers do not stamp a
 * `codeStamp`, and the four in-scope completion predicates
 * (`build_review`, `prd_audit`, `architecture_review_as_built`, `manual_test`)
 * only ever consult `verdictFreshnessComparand`/mtime. Per this project's
 * writing-system-tests convention for a headless engine, these specs drive
 * the REAL production entry points — `checkStepCompletion` (dispatches to
 * `CUSTOM_COMPLETION_PREDICATES`) and `sweepStaleReviewArtifacts` — never a
 * new `gateVerdictStillValid`/`gate-code-validity.ts` primitive directly, so
 * an implementation that adds the helper but never wires it in still shows
 * RED here.
 *
 * Real scratch git repos are required (not a fake getHeadSha) because the
 * decision depends on a real `git diff --name-only baseline..HEAD` /
 * ancestry check, mirroring `test/engine/rebase-translate-acceptance.test.ts`.
 * `ctx.getHeadSha` is wired to the real `currentCommitSha`, exactly as the
 * production `Conductor` wires it.
 *
 * ENCODING CONFIRMED (Task 10, cross-checked against the landed
 * `src/engine/artifacts.ts`): `build_review` stamps `codeStamp` inline as a
 * JSON field in `.pipeline/build-review.json`. `prd_audit` and
 * `architecture_review_as_built` each write their `codeStamp` to a SEPARATE
 * JSON sidecar file — `.pipeline/prd-audit-code-stamp.json`
 * (`PRD_AUDIT_CODE_STAMP`) and
 * `.pipeline/architecture-review-as-built-code-stamp.json`
 * (`ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP`) respectively — never inline in
 * the markdown report body; the sidecar's mere presence with a `codeStamp`
 * signals "the last recorded verdict was a PASS/APPROVED" (Task 4 writes it
 * only on that path), but the preserve path still re-checks the CURRENT
 * report content is itself clean before trusting it. `manual_test` reuses
 * its existing `.pipeline/manual-test-fail-evidence.json` whitewash-guard
 * marker (`MANUAL_TEST_FAIL_EVIDENCE`) with an added `codeStamp` field; a
 * "clean PASS" marker is one with `codeStamp` set, `headSha` undefined, and
 * no (or empty) `failRows`. The "feature's own runtime surface" (`F` in
 * `partitionDelta`) is derived from paths the feature branch itself
 * introduced/touched relative to its merge-base with the trunk it diverged
 * from; the `feature-runtime` scenarios below are constructed so the
 * assertion holds under ANY reasonable `F` derivation (the "feature" file is
 * added SOLELY by the feature branch and never touched by the
 * foreign/trunk commit).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, utimes, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  checkStepCompletion,
  sweepStaleReviewArtifacts,
  PRD_AUDIT_CODE_STAMP,
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  MANUAL_TEST_FAIL_EVIDENCE,
} from '../../src/engine/artifacts.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';

const execFile = promisify(execFileCb);

const OLD_MTIME = new Date(2000, 0, 1);

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

interface Scratch {
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
  origin?: string;
}

async function makeRepo(): Promise<Scratch> {
  const repo = await mkdtemp(join(tmpdir(), 'gate-validity-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await g(['config', 'commit.gpgsign', 'false']);
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  // `.pipeline/` holds run evidence (gate verdicts, this feature's own
  // codeStamp sidecar), not code — every real consumer project gitignores
  // it. Without this, `commit()`'s `git add .` sweeps the just-written
  // evidence file itself into the delta being tested, self-invalidating a
  // surface-miss scenario the test is trying to construct.
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await execFile('git', ['add', '.gitignore'], { cwd: repo });
  await execFile('git', ['commit', '-q', '-m', 'chore: gitignore .pipeline'], { cwd: repo });
  return { repo, g };
}

async function commit(
  { repo, g }: Scratch,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(repo, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await g(['add', '.']);
  await g(['commit', '-q', '-m', message]);
  return (await g(['rev-parse', 'HEAD'])).stdout.trim();
}

/**
 * Lands a commit on `origin/main` (a genuinely separate trunk history the
 * feature branch does NOT author) and merges it into the feature branch's
 * HEAD, mirroring a real re-dispatch where trunk moved while the feature was
 * parked. Committing `files` directly on the feature branch (as a plain
 * `commit()` call) would NOT model "foreign" work at all — `deriveFeatureSurface`
 * derives `F` as `origin/main..HEAD`, so anything committed straight onto the
 * feature branch is, by construction, part of `F` too. Routing it through
 * `origin/main` first and merging is the only way a path can land in the
 * delta while staying OUTSIDE `F`.
 */
async function pushForeignCommit(
  s: Scratch & { origin: string },
  files: Record<string, string>,
  message: string,
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'gate-validity-foreign-'));
  scratches.push(tmp);
  await execFile('git', ['clone', '-q', s.origin, tmp]);
  const g2 = (args: string[]) => execFile('git', args, { cwd: tmp });
  await g2(['config', 'user.email', 't@t.com']);
  await g2(['config', 'user.name', 'T']);
  await g2(['config', 'commit.gpgsign', 'false']);
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(tmp, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await g2(['add', '.']);
  await g2(['commit', '-q', '-m', message]);
  await g2(['push', '-q', 'origin', 'HEAD:main']);
  await s.g(['fetch', '-q', 'origin']);
  await s.g(['merge', '-q', '--no-edit', 'origin/main']);
}

const scratches: string[] = [];
afterEach(async () => {
  while (scratches.length) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

function ctxFor(repo: string, extra: Record<string, unknown> = {}) {
  return {
    sessionStartedAt: Date.now(),
    attemptStartedAt: Date.now(),
    getHeadSha: () => currentCommitSha(repo),
    ...extra,
  };
}

/** Writes build-review.json (JSON verdict) with an optional codeStamp, backdated to OLD_MTIME. */
async function writeBuildReviewVerdict(
  repo: string,
  verdict: 'PASS' | 'FAIL',
  codeStamp?: string,
): Promise<void> {
  const path = join(repo, '.pipeline/build-review.json');
  const body: Record<string, unknown> = { verdict, rubric: {} };
  if (codeStamp) body.codeStamp = codeStamp;
  await writeFile(path, JSON.stringify(body, null, 2));
  await utimes(path, OLD_MTIME, OLD_MTIME);
}

/**
 * Writes a clean markdown report (backdated to OLD_MTIME, no inline stamp —
 * `prd_audit`/`architecture_review_as_built` never encode `codeStamp` in the
 * report body) plus, when a `codeStamp` is given, the matching JSON sidecar
 * (`sidecarRelPath`) real production code reads it from
 * (`PRD_AUDIT_CODE_STAMP` / `ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP`).
 */
async function writeMdVerdict(
  repo: string,
  relPath: string,
  body: string,
  codeStamp: string | undefined,
  sidecarRelPath: string,
): Promise<void> {
  const path = join(repo, relPath);
  await writeFile(path, body);
  await utimes(path, OLD_MTIME, OLD_MTIME);
  if (codeStamp) {
    const sidecarPath = join(repo, sidecarRelPath);
    await mkdir(join(sidecarPath, '..'), { recursive: true });
    await writeFile(sidecarPath, JSON.stringify({ codeStamp }, null, 2));
  }
}

/**
 * Writes a clean manual-test results file (backdated to OLD_MTIME) plus,
 * when a `codeStamp` is given, a "clean PASS" `MANUAL_TEST_FAIL_EVIDENCE`
 * marker (`codeStamp` set, `headSha` undefined, no `failRows`) — the exact
 * shape the real `manual_test` predicate's preserve-check requires.
 */
async function writeManualTestVerdict(
  repo: string,
  body: string,
  codeStamp?: string,
): Promise<void> {
  const path = join(repo, '.pipeline/manual-test-results.md');
  await writeFile(path, body);
  await utimes(path, OLD_MTIME, OLD_MTIME);
  if (codeStamp) {
    const markerPath = join(repo, MANUAL_TEST_FAIL_EVIDENCE);
    await writeFile(markerPath, JSON.stringify({ codeStamp }, null, 2));
  }
}

const PRD_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n';
const PRD_ALIGNED = PRD_HEADER + '| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';
const ARCH_APPROVED = '# As-Built Review\n\nVerdict: APPROVED\n';
const MANUAL_TEST_PASS =
  '# Manual Test Results\n\n## Attempt 1 — 2026-07-22T10:00:00Z\n\n' +
  '| Story | Result |\n|---|---|\n| Foo | PASS |\n';

describe('build_review: code-validity preserves a passed verdict across re-dispatch (Story 2)', () => {
  it('preserves PASS despite an older mtime when the delta since the stamped baseline is empty', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });

  it('re-runs when the delta since the stamped baseline touches a code path (any-codetest surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});

describe('feature-runtime gates preserve on a foreign-only delta, re-run on a feature-surface delta (Story 2)', () => {
  /**
   * `deriveFeatureSurface` (gate-code-validity.ts) resolves the feature's own
   * runtime surface `F` from `origin/<default-branch>..HEAD` via
   * `originDefaultBranch`, which reads `refs/remotes/origin/HEAD` — it needs
   * a REAL `origin` remote with its HEAD symref set, not just a bare local
   * repo, or it silently fails-open to `F = []` (every `feature-runtime` case
   * would then read as a surface MISS regardless of what actually changed).
   * Wires a bare "origin" pointed at the trunk commit the feature branch
   * diverged from, mirroring how a real clone's `origin/main` would sit at
   * that same commit.
   */
  async function setupOrigin(s: Scratch): Promise<void> {
    const bare = await mkdtemp(join(tmpdir(), 'gate-validity-origin-'));
    scratches.push(bare);
    await execFile('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    await s.g(['remote', 'add', 'origin', bare]);
    await s.g(['push', '-q', 'origin', 'HEAD:main']);
    await s.g(['fetch', '-q', 'origin']);
    await s.g(['remote', 'set-head', 'origin', '-a']);
    s.origin = bare;
  }

  async function setup() {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'base.ts': 'base\n' }, 'main: init');
    // origin/main sits at the trunk commit the feature branch diverges from —
    // set up BEFORE the feature's own commit so `origin/main` never moves as
    // the feature branch (and any foreign/kickback commits) advance locally.
    await setupOrigin(s);
    // The feature branch's OWN file — introduced solely by this branch.
    const baseline = await commit(s, { 'featureA.ts': 'f1\n' }, 'feat: add featureA');
    return { s, baseline };
  }

  it('prd_audit: preserved when the delta only touches a foreign runtime path', async () => {
    const { s, baseline } = await setup();
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, baseline, PRD_AUDIT_CODE_STAMP);
    await pushForeignCommit(s as Scratch & { origin: string }, { 'foreign.ts': 'foreign1\n' }, 'unrelated foreign work');

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });

  it('prd_audit: re-runs when the delta touches the feature\'s own runtime source', async () => {
    const { s, baseline } = await setup();
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, baseline, PRD_AUDIT_CODE_STAMP);
    await commit(s, { 'featureA.ts': 'f2\n' }, 'feat: change featureA');

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });

  it('architecture_review_as_built: preserved when the delta only touches a foreign runtime path', async () => {
    const { s, baseline } = await setup();
    await writeMdVerdict(s.repo, '.pipeline/architecture-review-as-built.md', ARCH_APPROVED, baseline, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP);
    await pushForeignCommit(s as Scratch & { origin: string }, { 'foreign.ts': 'foreign1\n' }, 'unrelated foreign work');

    const result = await checkStepCompletion(s.repo, 'architecture_review_as_built', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });

  it('architecture_review_as_built: re-runs when the delta touches the feature\'s own runtime source', async () => {
    const { s, baseline } = await setup();
    await writeMdVerdict(s.repo, '.pipeline/architecture-review-as-built.md', ARCH_APPROVED, baseline, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP);
    await commit(s, { 'featureA.ts': 'f2\n' }, 'feat: change featureA');

    const result = await checkStepCompletion(s.repo, 'architecture_review_as_built', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});

describe('fail-closed on a missing stamp — legacy/opt-out verdicts still govern by mtime (Story 3)', () => {
  it('a PASS verdict with no codeStamp re-runs on an older mtime exactly as today', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', undefined);

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});

describe('fail-closed on an unreachable baseline — #766 orphan guard (Story 4)', () => {
  it('re-runs (never wedges) when the stamped baseline is orphaned by an amend/rebase', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const orphaned = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', orphaned);
    // Amend replaces HEAD with a sibling commit; `orphaned` is no longer an
    // ancestor of the new HEAD (real orphaning, not just an old sha string).
    await s.g(['commit', '--amend', '-q', '-m', 'init (amended)']);
    const isAncestor = await s
      .g(['merge-base', '--is-ancestor', orphaned, 'HEAD'])
      .then(() => true, () => false);
    expect(isAncestor).toBe(false); // sanity: fixture really orphaned the baseline

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
    expect(result.reason ?? '').not.toMatch(/uncreditable|undemotable/i);
  });

  it('re-runs (fails closed) when the delta from the stamped baseline is uncomputable', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    // A syntactically sha-shaped baseline that names no real object at all.
    await writeBuildReviewVerdict(s.repo, 'PASS', '0'.repeat(40));

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});

describe('a kickback that changes code invalidates the verdict; a no-op kickback preserves it (Story 5)', () => {
  it('kickback fix commits touching build_review surface invalidate the stamped PASS', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);
    await commit(s, { 'src/a.ts': 'a-fixed\n' }, 'kickback: fix bug');

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });

  it('a docs/CHANGELOG-only kickback does not force a needless re-run', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);
    await commit(s, { 'CHANGELOG.md': '## Unreleased\n- noted\n' }, 'kickback: changelog only');

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });
});

describe('the within-dispatch attempt-floor trace is unchanged when a gate DOES re-run (Story 6)', () => {
  it('a re-run forced by a surface hit still reports the pre-existing verdictFreshness/routeClass shape', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));
    expect(result.done).toBe(false);
    // Same trace shape the pre-existing mtime-stale path reports today
    // (artifacts.ts build_review predicate, verdictFreshness.fresh:false /
    // routeClass:'absent') — the code-validity re-run must not bypass it.
    expect(result.routeClass).toBe('absent');
  });
});

describe('manual_test: all-runtime surface — any runtime path (feature or foreign) invalidates', () => {
  it('preserves a stamped PASS when the delta since baseline is docs/test-only', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeManualTestVerdict(s.repo, MANUAL_TEST_PASS, baseline);
    await commit(s, { '.docs/notes.md': 'note\n' }, 'docs only');

    const result = await checkStepCompletion(s.repo, 'manual_test', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });

  it('re-runs when the delta touches ANY runtime path, even one foreign to the feature', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'base.ts': 'base\n' }, 'main: init');
    const baseline = await commit(s, { 'featureA.ts': 'f1\n' }, 'feat: add featureA');
    await writeManualTestVerdict(s.repo, MANUAL_TEST_PASS, baseline);
    await commit(s, { 'foreign.ts': 'foreign1\n' }, 'unrelated foreign work');

    const result = await checkStepCompletion(s.repo, 'manual_test', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});

describe('sweepStaleReviewArtifacts spares a still-valid verdict, still deletes an invalid one (Story 7)', () => {
  it('does not delete a prior-session prd_audit verdict whose surface is unchanged', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'base.ts': 'base\n' }, 'main: init');
    const baseline = await commit(s, { 'featureA.ts': 'f1\n' }, 'feat: add featureA');
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, baseline, PRD_AUDIT_CODE_STAMP);
    // No further commits: delta since baseline is empty, code-valid.

    const removed = await sweepStaleReviewArtifacts(s.repo, 'prd_audit', Date.now());
    expect(removed).toEqual([]);
    expect(await fileExists(join(s.repo, '.pipeline/prd-audit.md'))).toBe(true);

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));
    expect(result.done).toBe(true);
  });

  it('deletes a prior-session prd_audit verdict whose baseline is unreachable', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const orphaned = await commit(s, { 'base.ts': 'base\n' }, 'init');
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, orphaned, PRD_AUDIT_CODE_STAMP);
    await s.g(['commit', '--amend', '-q', '-m', 'init (amended)']);

    const removed = await sweepStaleReviewArtifacts(s.repo, 'prd_audit', Date.now());
    expect(removed).toEqual([join(s.repo, '.pipeline/prd-audit.md')]);

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));
    expect(result.done).toBe(false);
  });
});
