import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

import {
  resolveBase,
  isBranchCurrent,
  isCodeOrTestPath,
  filterCodeOrTestPaths,
  unreleasedAdditions,
  buildResolvedChangelog,
  writeHalt,
  applyRebaseVerdicts,
  emitRebaseEvent,
  emitGateInvalidationEvents,
  type GitRunner,
  type GitResult,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';
import { classifyGateInvalidation } from '../../src/engine/gate-invalidation.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';

// A scripted GitRunner: matches argv prefixes to canned results.
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('engine/rebase — resolveBase (FR-2/FR-3)', () => {
  it('discovers origin default, fetches it, returns origin/<default>', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/trunk\n' },
      },
      { match: ['fetch', 'origin', 'trunk'], result: { exitCode: 0 } },
    ]);
    const base = await resolveBase(git, 'main');
    expect(base).toEqual({ ref: 'origin/trunk', kind: 'remote', branch: 'trunk' });
    expect(calls).toContainEqual(['fetch', 'origin', 'trunk']);
  });

  it('no origin → returns the local base, no fetch', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: '' } },
    ]);
    const base = await resolveBase(git, 'main');
    expect(base).toEqual({ ref: 'main', kind: 'local', branch: 'main' });
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
  });

  it('fetch failure degrades to local base (no error/HALT)', async () => {
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 1, stderr: 'unreachable' } },
    ]);
    const base = await resolveBase(git, 'main');
    expect(base.kind).toBe('local');
    expect(base.branch).toBe('main');
  });

  it('on fetch failure falls back to the caller localBase, not the bare origin default', async () => {
    // origin's default ('trunk') differs from the local base ('develop'). A
    // fetch failure must degrade to the known-existing localBase, not 'trunk'
    // (which may not exist locally → a spurious rebase failure).
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/trunk\n' },
      },
      { match: ['fetch', 'origin', 'trunk'], result: { exitCode: 1, stderr: 'unreachable' } },
    ]);
    const base = await resolveBase(git, 'develop');
    expect(base.kind).toBe('local');
    expect(base.ref).toBe('develop');
    expect(base.branch).toBe('develop');
  });
});

describe('engine/rebase — isBranchCurrent (FR-4)', () => {
  it('true when no commits in HEAD..base', async () => {
    const { git } = fakeGit([
      { match: ['rev-list', '--count', 'HEAD..origin/main'], result: { stdout: '0\n' } },
    ]);
    expect(await isBranchCurrent(git, 'origin/main')).toBe(true);
  });

  it('false when the base has commits the branch lacks (stale never satisfied)', async () => {
    const { git } = fakeGit([
      { match: ['rev-list', '--count', 'HEAD..origin/main'], result: { stdout: '3\n' } },
    ]);
    expect(await isBranchCurrent(git, 'origin/main')).toBe(false);
  });
});

describe('engine/rebase — path classifier (FR-5)', () => {
  it('code/test paths invalidate', () => {
    expect(isCodeOrTestPath('src/feature.ts')).toBe(true);
    expect(isCodeOrTestPath('test/foo.test.ts')).toBe(true);
    expect(isCodeOrTestPath('lib/x.js')).toBe(true);
  });

  it('CHANGELOG-only / docs-only do NOT invalidate', () => {
    expect(isCodeOrTestPath('CHANGELOG.md')).toBe(false);
    expect(isCodeOrTestPath('.docs/plans/x.md')).toBe(false);
    expect(isCodeOrTestPath('README.md')).toBe(false);
    expect(isCodeOrTestPath('docs/guide.md')).toBe(false);
  });

  it('filterCodeOrTestPaths keeps only invalidating paths', () => {
    expect(
      filterCodeOrTestPaths(['CHANGELOG.md', 'src/a.ts', 'README.md', 'test/b.ts']),
    ).toEqual(['src/a.ts', 'test/b.ts']);
  });
});

describe('engine/rebase — CHANGELOG resolution (FR-7)', () => {
  const base =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Sibling bar entry\n';
  const head =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature foo entry\n';

  it('captures this feature additions (head minus base)', () => {
    expect(unreleasedAdditions(base, head)).toEqual(['- Feature foo entry']);
  });

  it('resolves to base + feature additions, each exactly once', () => {
    const additions = unreleasedAdditions(base, head);
    const resolved = buildResolvedChangelog(base, additions);
    expect(resolved).not.toBeNull();
    expect(resolved).toContain('- Sibling bar entry');
    expect(resolved).toContain('- Feature foo entry');
    expect(resolved!.match(/- Feature foo entry/g)).toHaveLength(1);
    expect(resolved!.match(/- Sibling bar entry/g)).toHaveLength(1);
  });

  it('does not duplicate an addition the base already has (dedup)', () => {
    const resolved = buildResolvedChangelog(base, ['- Sibling bar entry']);
    expect(resolved!.match(/- Sibling bar entry/g)).toHaveLength(1);
  });

  it('declines (null) when base has no [Unreleased] block', () => {
    expect(buildResolvedChangelog('# Changelog\n\n## [1.0.0]\n', ['- x'])).toBeNull();
  });
});

describe('engine/rebase — HALT (FR-8)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebase-halt-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes .pipeline/HALT listing conflicted files + resume steps', async () => {
    await writeHalt(dir, ['src/feature.ts']);
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    const note = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(note).toContain('src/feature.ts');
    expect(note).toContain('git rebase --continue');
    expect(note).toContain('.pipeline/HALT');
  });
});

describe('engine/rebase — applyRebaseVerdicts (FR-4/FR-5)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebase-verdict-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('noop → rebase satisfied, no kickback', async () => {
    const r = await applyRebaseVerdicts(dir, { kind: 'noop' }, true);
    expect(r).toEqual({ satisfied: true, kickedBack: [], reverified: [] });
    expect((await readVerdict(dir, 'rebase'))?.satisfied).toBe(true);
  });

  it('changed → rebase satisfied + build/build_review/wiring_check/manual_test kicked back (from rebase)', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const r = await applyRebaseVerdicts(dir, outcome, true);
    expect(r.satisfied).toBe(true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.kickback?.from).toBe('rebase');
    // wiring_check (Task 6) sits between build_review and manual_test and
    // must be invalidated the same way — a file-changing rebase can falsify
    // reachability evidence just as easily as build_review's grading
    // (Task 11).
    const wiringCheck = await readVerdict(dir, 'wiring_check');
    expect(wiringCheck?.satisfied).toBe(false);
    expect(wiringCheck?.kickback?.from).toBe('rebase');
  });

  it('changed but manual_test did not run → only build kicked back', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const r = await applyRebaseVerdicts(dir, outcome, false);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check']);
  });

  it('changelog_resolved (docs-only) → satisfied, NO kickback (FR-5×FR-7)', async () => {
    const r = await applyRebaseVerdicts(dir, { kind: 'changelog_resolved' }, true);
    expect(r).toEqual({ satisfied: true, kickedBack: [], reverified: [] });
  });

  it('conflict_halt → rebase NOT satisfied', async () => {
    const outcome: RebaseOutcome = {
      kind: 'conflict_halt',
      conflicts: ['src/x.ts'],
      reason: 'needs human',
    };
    const r = await applyRebaseVerdicts(dir, outcome, true);
    expect(r.satisfied).toBe(false);
    expect((await readVerdict(dir, 'rebase'))?.satisfied).toBe(false);
  });

  it('preVerify capability absent (undefined) → byte-identical behavior, reverified: []', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const r = await applyRebaseVerdicts(dir, outcome, true, undefined);
    // Verify existing behavior is unchanged (byte-identical)
    expect(r.satisfied).toBe(true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    // Verify new field is present and empty when preVerify is absent
    expect(r.reverified).toEqual([]);
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.kickback?.from).toBe('rebase');
  });

  it('changed + preVerify(build) returns done:true → build re-verified, build_review/manual_test kicked back', async () => {
    // Pre-seed a stale build verdict so we can verify checkedAt is newer
    const staleTime = Date.now() - 10000;
    await writeVerdict(dir, 'build', {
      satisfied: false,
      reason: 'stale old verdict',
      checkedAt: staleTime,
    });

    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const preVerify = async (step: string) => {
      if (step === 'build') {
        return { done: true };
      }
      return { done: false };
    };

    const r = await applyRebaseVerdicts(dir, outcome, true, preVerify);

    // Rebase gate satisfied
    expect(r.satisfied).toBe(true);

    // build is reverified, NOT in kickedBack
    expect(r.kickedBack).toEqual(['build_review', 'wiring_check', 'manual_test']);
    expect(r.reverified).toEqual(['build']);

    // build verdict is fresh satisfied
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(true);
    expect(build?.reason).toContain('re-verified mechanically');
    expect(build?.checkedAt).toBeGreaterThan(staleTime);

    // build_review and manual_test are kicked back unconditionally
    const buildReview = await readVerdict(dir, 'build_review');
    expect(buildReview?.satisfied).toBe(false);
    expect(buildReview?.kickback?.from).toBe('rebase');

    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest?.satisfied).toBe(false);
    expect(manualTest?.kickback?.from).toBe('rebase');
  });

  it('changed + preVerify(build) returns done:false → build kicked back (byte-identical to today)', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts', 'src/b.ts'] };
    const preVerify = async (step: string) => {
      if (step === 'build') {
        return { done: false, reason: 'task 3 has no evidence' };
      }
      return { done: false };
    };

    const r = await applyRebaseVerdicts(dir, outcome, true, preVerify);

    // Rebase gate satisfied
    expect(r.satisfied).toBe(true);

    // build is kicked back, NOT in reverified
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    expect(r.reverified).toEqual([]);

    // build verdict is unsatisfied with kickback (byte-identical to today)
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.reason).toBe('invalidated by file-changing rebase');
    expect(build?.kickback?.from).toBe('rebase');
    expect(build?.kickback?.evidence).toContain('src/a.ts');
    expect(build?.kickback?.evidence).toContain('src/b.ts');

    // Verify the verdict shape is byte-identical to the capability-absent case
    const withoutPreVerify: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts', 'src/b.ts'] };
    await applyRebaseVerdicts(dir, withoutPreVerify, true, undefined);
    const buildWithout = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(buildWithout?.satisfied);
    expect(build?.reason).toBe(buildWithout?.reason);
    expect(build?.kickback?.from).toBe(buildWithout?.kickback?.from);
  });

  it('changed + preVerify(build) THROWS → fail-closed invalidation with no error escape', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const preVerify = async (step: string) => {
      if (step === 'build') {
        throw new Error('git failed');
      }
      return { done: false };
    };

    // Should NOT throw; error is caught internally
    const r = await applyRebaseVerdicts(dir, outcome, true, preVerify);

    // Rebase gate satisfied
    expect(r.satisfied).toBe(true);

    // build is kicked back (fail-closed), NOT in reverified
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    expect(r.reverified).toEqual([]);

    // build verdict is unsatisfied with fail-closed kickback
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.reason).toBe('invalidated by file-changing rebase');
    expect(build?.kickback?.from).toBe('rebase');
    expect(build?.kickback?.evidence).toContain('src/a.ts');

    // build_review and manual_test also kicked back
    const buildReview = await readVerdict(dir, 'build_review');
    expect(buildReview?.satisfied).toBe(false);
    expect(buildReview?.kickback?.from).toBe('rebase');

    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest?.satisfied).toBe(false);
    expect(manualTest?.kickback?.from).toBe('rebase');
  });

  it('Task 6.1: changed + ranManualTest: false + preVerify(build) done:true → build_review only kicked back (no manual_test)', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const preVerify = async (step: string) => {
      if (step === 'build') {
        return { done: true };
      }
      return { done: false };
    };

    const r = await applyRebaseVerdicts(dir, outcome, false, preVerify);

    // Rebase gate satisfied
    expect(r.satisfied).toBe(true);

    // build is reverified (not in kickedBack), build_review kicked back, manual_test NOT present
    expect(r.kickedBack).toEqual(['build_review', 'wiring_check']);
    expect(r.reverified).toEqual(['build']);

    // build verdict is fresh satisfied
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(true);
    expect(build?.reason).toContain('re-verified mechanically');

    // build_review is kicked back
    const buildReview = await readVerdict(dir, 'build_review');
    expect(buildReview?.satisfied).toBe(false);
    expect(buildReview?.kickback?.from).toBe('rebase');

    // manual_test verdict should NOT be written (ranManualTest: false)
    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest).toBeNull();
  });

  it('Task 6.2: changed + ranManualTest: false + preVerify(build) done:false → build and build_review kicked back (no manual_test)', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const preVerify = async (step: string) => {
      if (step === 'build') {
        return { done: false, reason: 'no evidence' };
      }
      return { done: false };
    };

    const r = await applyRebaseVerdicts(dir, outcome, false, preVerify);

    // Rebase gate satisfied
    expect(r.satisfied).toBe(true);

    // build and build_review kicked back, manual_test NOT present
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check']);
    expect(r.reverified).toEqual([]);

    // build verdict is unsatisfied with kickback
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.reason).toBe('invalidated by file-changing rebase');
    expect(build?.kickback?.from).toBe('rebase');

    // build_review is kicked back
    const buildReview = await readVerdict(dir, 'build_review');
    expect(buildReview?.satisfied).toBe(false);
    expect(buildReview?.kickback?.from).toBe('rebase');

    // manual_test verdict should NOT be written (ranManualTest: false)
    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest).toBeNull();
  });

  it('Task 6: delta-aware — foreign runtime + feature test file → audits preserved, wiring_check/manual_test invalidated', async () => {
    // Feature's claimed surface is src/feature.ts only. The rebase delta
    // touches a foreign runtime file (src/foreign.ts) and one of the
    // feature's own test files (src/feature.test.ts) — no feature runtime
    // source changed.
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/foreign.ts', 'src/feature.test.ts'],
      featureSurface: ['src/feature.ts', 'src/feature.test.ts'],
    };

    // Pre-seed prd_audit / architecture_review_as_built as done so we can
    // assert they are left untouched (preserved), not overwritten.
    await writeVerdict(dir, 'prd_audit', { satisfied: true, reason: 'prior audit', checkedAt: 1 });
    await writeVerdict(dir, 'architecture_review_as_built', {
      satisfied: true,
      reason: 'prior review',
      checkedAt: 1,
    });

    const r = await applyRebaseVerdicts(dir, outcome, true);

    expect(r.satisfied).toBe(true);
    // build_review ('any-codetest') and wiring_check/manual_test
    // ('all-runtime', foreignSrc non-empty) are invalidated; the two
    // feature-runtime audits are preserved (featureSrc is empty).
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    expect(r.kickedBack).not.toContain('prd_audit');
    expect(r.kickedBack).not.toContain('architecture_review_as_built');

    const wiringCheck = await readVerdict(dir, 'wiring_check');
    expect(wiringCheck?.satisfied).toBe(false);
    expect(wiringCheck?.kickback?.from).toBe('rebase');

    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest?.satisfied).toBe(false);

    // Preserved audits are untouched — verdict stays exactly what it was.
    const prdAudit = await readVerdict(dir, 'prd_audit');
    expect(prdAudit?.satisfied).toBe(true);
    expect(prdAudit?.reason).toBe('prior audit');
    expect(prdAudit?.checkedAt).toBe(1);

    const archReview = await readVerdict(dir, 'architecture_review_as_built');
    expect(archReview?.satisfied).toBe(true);
    expect(archReview?.reason).toBe('prior review');
    expect(archReview?.checkedAt).toBe(1);
  });

  it('Task 8: emits rebase_gate_invalidated for each invalidated gate with matched delta paths', async () => {
    // Same delta as the Task 6 fixture above: feature surface is
    // src/feature.ts only; the rebase delta touches a foreign runtime file
    // (src/foreign.ts) and a feature test file (src/feature.test.ts). That
    // invalidates build_review ('any-codetest') and wiring_check/manual_test
    // ('all-runtime', foreignSrc non-empty), while preserving the
    // feature-runtime-scoped audits (featureSrc is empty).
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/foreign.ts', 'src/feature.test.ts'],
      featureSurface: ['src/feature.ts', 'src/feature.test.ts'],
    };

    const events = new ConductorEventEmitter();
    const invalidated: Array<{ gate: string; matchedPaths: string[] }> = [];
    events.on('rebase_gate_invalidated', (e) => {
      if (e.type === 'rebase_gate_invalidated') {
        invalidated.push({ gate: e.gate, matchedPaths: e.matchedPaths });
      }
    });

    await emitGateInvalidationEvents(events, outcome, true);

    const byGate = Object.fromEntries(invalidated.map((e) => [e.gate, e.matchedPaths]));
    expect(Object.keys(byGate).sort()).toEqual(
      ['build_review', 'manual_test', 'wiring_check'].sort(),
    );
    // wiring_check/manual_test are 'all-runtime' — matchedPaths is
    // featureSrc ∪ foreignSrc (foreignSrc: src/foreign.ts; featureSrc empty).
    expect(byGate.wiring_check).toEqual(['src/foreign.ts']);
    expect(byGate.manual_test).toEqual(['src/foreign.ts']);
    // build_review is 'any-codetest' — matchedPaths is the full delta.
    expect(byGate.build_review).toEqual(['src/feature.test.ts', 'src/foreign.ts']);
    // Preserved audits must not appear at all.
    expect(byGate.prd_audit).toBeUndefined();
    expect(byGate.architecture_review_as_built).toBeUndefined();
  });

  it('Task 9: emits rebase_gate_preserved for each preserved gate with empty surface and full delta considered', async () => {
    // Same fixture as the Task 8 test above: feature surface is
    // src/feature.ts only; the delta touches a foreign runtime file and a
    // feature test file. prd_audit/architecture_review_as_built are
    // feature-runtime scoped and featureSrc is empty, so both are preserved.
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/foreign.ts', 'src/feature.test.ts'],
      featureSurface: ['src/feature.ts', 'src/feature.test.ts'],
    };

    const events = new ConductorEventEmitter();
    const preserved: Array<{ gate: string; surface: string[]; deltaConsidered: string[] }> = [];
    events.on('rebase_gate_preserved', (e) => {
      if (e.type === 'rebase_gate_preserved') {
        preserved.push({ gate: e.gate, surface: e.surface, deltaConsidered: e.deltaConsidered });
      }
    });

    await emitGateInvalidationEvents(events, outcome, true);

    const byGate = Object.fromEntries(preserved.map((e) => [e.gate, e]));
    expect(Object.keys(byGate).sort()).toEqual(
      ['prd_audit', 'architecture_review_as_built'].sort(),
    );
    // The preserved gate's own judged surface was found empty (that's why it
    // was preserved) — surface reflects that emptiness.
    expect(byGate.prd_audit.surface).toEqual([]);
    expect(byGate.architecture_review_as_built.surface).toEqual([]);
    // deltaConsidered is always the full rebase delta, for audit purposes.
    expect(byGate.prd_audit.deltaConsidered).toEqual(['src/foreign.ts', 'src/feature.test.ts']);
    expect(byGate.architecture_review_as_built.deltaConsidered).toEqual([
      'src/foreign.ts',
      'src/feature.test.ts',
    ]);
    // Invalidated gates must not appear in the preserved set.
    expect(byGate.build_review).toBeUndefined();
    expect(byGate.wiring_check).toBeUndefined();
    expect(byGate.manual_test).toBeUndefined();
  });

  it('Task 6: delta-aware — feature runtime source changed → all judged gates invalidated including audits', async () => {
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/feature.ts'],
      featureSurface: ['src/feature.ts'],
    };

    await writeVerdict(dir, 'prd_audit', { satisfied: true, reason: 'prior audit', checkedAt: 1 });
    await writeVerdict(dir, 'architecture_review_as_built', {
      satisfied: true,
      reason: 'prior review',
      checkedAt: 1,
    });

    const r = await applyRebaseVerdicts(dir, outcome, true);

    expect(r.satisfied).toBe(true);
    expect(r.kickedBack).toEqual([
      'build',
      'build_review',
      'wiring_check',
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ]);

    const prdAudit = await readVerdict(dir, 'prd_audit');
    expect(prdAudit?.satisfied).toBe(false);
    expect(prdAudit?.kickback?.from).toBe('rebase');

    const archReview = await readVerdict(dir, 'architecture_review_as_built');
    expect(archReview?.satisfied).toBe(false);
    expect(archReview?.kickback?.from).toBe('rebase');
  });

  it('Task 6: featureSurface missing → falls back to the fixed invalidation set (safe default)', async () => {
    // No featureSurface on the outcome — classifyGateInvalidation cannot be
    // applied, so applyRebaseVerdicts must fall back to the old blanket
    // invalidation rather than guess. Audits are NOT touched by the
    // fallback (byte-identical to pre-Task-6 behavior).
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    await writeVerdict(dir, 'prd_audit', { satisfied: true, reason: 'prior audit', checkedAt: 1 });

    const r = await applyRebaseVerdicts(dir, outcome, true);

    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    const prdAudit = await readVerdict(dir, 'prd_audit');
    expect(prdAudit?.satisfied).toBe(true);
    expect(prdAudit?.reason).toBe('prior audit');
  });

  it('Task 13 (Property A): preservation never invents a passed gate — a never-run prd_audit stays pending, not flipped to done', async () => {
    // prd_audit was never run before the rebase (still 'pending' in
    // .pipeline task-status — no verdict file at all, the same state a
    // gate has before its first evaluation). The delta classifies prd_audit
    // as preserved (featureSrc is empty — only a foreign runtime file and a
    // feature test file changed, same fixture shape as the Task 6/8/9 tests
    // above).
    const outcome: RebaseOutcome = {
      kind: 'changed',
      changedCodePaths: ['src/foreign.ts', 'src/feature.test.ts'],
      featureSurface: ['src/feature.ts', 'src/feature.test.ts'],
    };

    // No verdict written for prd_audit beforehand — it has never run.
    const before = await readVerdict(dir, 'prd_audit');
    expect(before).toBeNull();

    const r = await applyRebaseVerdicts(dir, outcome, true);

    expect(r.satisfied).toBe(true);
    // prd_audit is preserved (not invalidated) — it must not appear in
    // kickedBack.
    expect(r.kickedBack).not.toContain('prd_audit');

    // Preservation is a pure no-op: it never writes a verdict for a gate
    // that never ran. A never-run gate stays exactly as it was —
    // no-verdict/pending — never manufactured into `done`/satisfied.
    const after = await readVerdict(dir, 'prd_audit');
    expect(after).toBeNull();
    expect(after?.satisfied).not.toBe(true);
  });

  it("Task 13 (Property B): build's pre-verify path is unaffected by delta classification — identical treatment across feature-runtime, foreign-runtime, and test-only deltas", async () => {
    // build is excluded from GATE_SURFACE/classifyGateInvalidation (confirmed
    // by grep — it is not a key in GATE_SURFACE). Its invalidation/re-verify
    // decision is driven solely by the ADR-2026-07-08 preVerify('build') pass,
    // never by the delta's feature/foreign/test-only classification. Assert
    // build's outcome (kicked back vs re-verified) is byte-identical across
    // three deltas that classify very differently for the judged gates.
    const preVerifyDone = async () => ({ done: true });
    const preVerifyNotDone = async () => ({ done: false, reason: 'no evidence' });

    const deltas: Array<{ label: string; outcome: RebaseOutcome }> = [
      {
        label: 'feature-runtime delta',
        outcome: {
          kind: 'changed',
          changedCodePaths: ['src/feature.ts'],
          featureSurface: ['src/feature.ts'],
        },
      },
      {
        label: 'foreign-runtime delta',
        outcome: {
          kind: 'changed',
          changedCodePaths: ['src/foreign.ts'],
          featureSurface: ['src/feature.ts'],
        },
      },
      {
        label: 'test-only delta',
        outcome: {
          kind: 'changed',
          changedCodePaths: ['src/feature.test.ts'],
          featureSurface: ['src/feature.ts', 'src/feature.test.ts'],
        },
      },
    ];

    for (const { outcome } of deltas) {
      // Case 1: preVerify('build') confirms evidence-intact → re-verified,
      // regardless of how the delta classifies for the judged gates.
      const dirA = await mkdtemp(join(tmpdir(), 'rebase-build-preverify-'));
      await mkdir(join(dirA, '.pipeline'), { recursive: true });
      try {
        const rA = await applyRebaseVerdicts(dirA, outcome, true, preVerifyDone);
        expect(rA.reverified).toEqual(['build']);
        expect(rA.kickedBack).not.toContain('build');
        const buildA = await readVerdict(dirA, 'build');
        expect(buildA?.satisfied).toBe(true);
        expect(buildA?.reason).toBe(
          're-verified mechanically after file-changing rebase — evidence remains intact',
        );
      } finally {
        await rm(dirA, { recursive: true, force: true });
      }

      // Case 2: preVerify('build') finds evidence stale → kicked back,
      // again regardless of the delta's judged-gate classification.
      const dirB = await mkdtemp(join(tmpdir(), 'rebase-build-preverify-'));
      await mkdir(join(dirB, '.pipeline'), { recursive: true });
      try {
        const rB = await applyRebaseVerdicts(dirB, outcome, true, preVerifyNotDone);
        expect(rB.kickedBack).toContain('build');
        expect(rB.reverified).toEqual([]);
        const buildB = await readVerdict(dirB, 'build');
        expect(buildB?.satisfied).toBe(false);
        expect(buildB?.reason).toBe('invalidated by file-changing rebase');
      } finally {
        await rm(dirB, { recursive: true, force: true });
      }
    }

    // Confirm classifyGateInvalidation itself never reads or emits `build` —
    // it is not a key in GATE_SURFACE (grep-confirmed statically), so
    // invalidated/preserved never contain it regardless of delta shape.
    for (const { outcome } of deltas) {
      if (outcome.kind !== 'changed' || !outcome.featureSurface) continue;
      const { invalidated, preserved } = classifyGateInvalidation(
        outcome.changedCodePaths,
        outcome.featureSurface,
        true,
      );
      expect(invalidated).not.toContain('build');
      expect(preserved).not.toContain('build');
    }
  });
});

describe('engine/rebase — emitRebaseEvent (FR-10)', () => {
  it('emits the matching event per outcome', async () => {
    const events = new ConductorEventEmitter();
    const seen: string[] = [];
    for (const t of ['rebase_noop', 'rebase_changed', 'rebase_changelog_resolved', 'rebase_conflict_halt'] as const) {
      events.on(t, (e) => seen.push(e.type));
    }
    await emitRebaseEvent(events, { kind: 'noop' });
    await emitRebaseEvent(events, { kind: 'changed', changedCodePaths: ['src/a.ts'] });
    await emitRebaseEvent(events, { kind: 'changelog_resolved' });
    await emitRebaseEvent(events, { kind: 'conflict_halt', conflicts: ['x'], reason: 'r' });
    expect(seen).toEqual([
      'rebase_noop',
      'rebase_changed',
      'rebase_changelog_resolved',
      'rebase_conflict_halt',
    ]);
  });

  it('best-effort: emission failure does not throw', async () => {
    const events = new ConductorEventEmitter();
    const orig = events.emit.bind(events);
    events.emit = vi.fn(async () => {
      void orig;
      throw new Error('bus down');
    });
    await expect(emitRebaseEvent(events, { kind: 'noop' })).resolves.toBeUndefined();
  });
});

describe('engine/rebase — rebase_gate_reverified event', () => {
  it('accepts rebase_gate_reverified event with step, skippedDispatch, and optional reason', async () => {
    const events = new ConductorEventEmitter();
    const seen: Array<{
      type: string;
      step?: string;
      skippedDispatch?: boolean;
      reason?: string;
    }> = [];

    events.on('rebase_gate_reverified', (e) => {
      seen.push({
        type: e.type,
        step: e.step,
        skippedDispatch: e.skippedDispatch,
        reason: e.reason,
      });
    });

    await events.emit({
      type: 'rebase_gate_reverified',
      step: 'build',
      skippedDispatch: false,
    });

    await events.emit({
      type: 'rebase_gate_reverified',
      step: 'manual_test',
      skippedDispatch: true,
      reason: 'gate already satisfied',
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      type: 'rebase_gate_reverified',
      step: 'build',
      skippedDispatch: false,
      reason: undefined,
    });
    expect(seen[1]).toEqual({
      type: 'rebase_gate_reverified',
      step: 'manual_test',
      skippedDispatch: true,
      reason: 'gate already satisfied',
    });
  });
});

describe('Task 13: Evidence bar not lowered — corroboration + forged negatives', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task13-'));
    // Initialize a minimal git repo for evidence extraction
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('(a) Evidence trailer exists but commit touches NONE of the task plan paths → pre-verify fails', async () => {
    // Create a plan with Task 1 that has specific file paths
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planPath = join(dir, '.docs/plans/plan.md');
    await writeFile(
      planPath,
      `
# Implementation Plan

### Task 1: Add feature
**Story:** Feature 1
**Files:**
- src/feature.ts
- src/feature.test.ts

Task 1 implementation required.
`,
    );

    // Create a commit with Task: 1 trailer but touch an unrelated file (does NOT touch plan paths)
    await writeFile(join(dir, 'unrelated.txt'), 'unrelated content');
    await execa('git', ['add', 'unrelated.txt'], { cwd: dir });
    await execa('git',
      ['commit', '-q', '-m', 'Commit with Task trailer\n\nTask: 1'],
      { cwd: dir });

    // Create pipeline directory and task-status.json with Task 1 marked completed
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', name: 'Task 1', status: 'completed' }] }),
    );

    // Create empty task-evidence.json (no evidence stamps)
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
    );

    // Call pre-verify (checkStepCompletion) with seed + derive context
    const ctx = { projectRoot: dir, planPath };
    const result = await checkStepCompletion(dir, 'build', ctx);

    // Pre-verify must fail: Task 1 has an evidence trailer but the commit touches
    // NONE of the plan's declared paths (src/feature.ts, src/feature.test.ts).
    // Path corroboration failed, so deriveCompletion must NOT resolve the task.
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/pending|not completed|no.*evidence/i);
  });

  it('(b) task-status.json forged with all completed but empty evidence sidecar → pre-verify fails', async () => {
    // Create a plan with Task 1
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planPath = join(dir, '.docs/plans/plan.md');
    await writeFile(
      planPath,
      `
# Implementation Plan

### Task 1: Add feature
**Story:** Feature 1
**Files:**
- src/feature.ts

Task 1 needs to be done.
`,
    );

    // Create initial commit (establishes the anchor)
    await writeFile(join(dir, 'README.md'), 'initial');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-q', '-m', 'Initial commit'], { cwd: dir });

    // Create pipeline directory
    await mkdir(join(dir, '.pipeline'), { recursive: true });

    // Forge task-status.json with Task 1 marked completed (without evidence)
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', name: 'Task 1', status: 'completed' }] }),
    );

    // Create empty task-evidence.json (no evidenceStamps, no migrationGrandfather)
    // This violates H6/H7: a "completed" row without sidecar evidence is demoted
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
    );

    // Call pre-verify with seed + derive context
    const ctx = { projectRoot: dir, planPath };
    const result = await checkStepCompletion(dir, 'build', ctx);

    // Pre-verify must fail: Task 1 is marked completed on disk but has no evidence
    // sidecar entry (evidenceStamps or migrationGrandfather). The gate never trusts
    // forged rows; H6/H7 enforcement requires real git-derived evidence.
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/pending|not completed|no.*evidence/i);
  });
});

// ── Task 14 (RED): performRebase invokes translateAfterRebase on `changed` ──
//
// Story 6/9 (#535, ADR adr-2026-07-12-rebase-evidence-stamp-translation): once
// Task 15 wires it, a clean rebase that changes code paths must invoke a
// deterministic `translateAfterRebase(git, projectRoot, onto, origHead, head)`
// step so sha-anchored evidence citations survive the engine's own rebase.
// `performRebase` accepts the capability via an optional 4th `opts` argument
// (mirroring the existing `resolveRebaseConflict`-style optional-capability DI
// used elsewhere in this module) — today `performRebase(git, projectRoot,
// localBase)` takes no such argument, so it is silently ignored and these
// "invoked on changed" assertions are genuinely RED. The "not invoked"
// assertions are forward-looking regression guards for the no-op/absent case
// and may already trivially pass.
describe('engine/rebase — performRebase translateAfterRebase capability (Task 14, real git)', () => {
  let repo: string;
  const g = (args: string[]) => execa('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-xlate-di-'));
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'base.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('invokes an injected translateAfterRebase(git, projectRoot, onto, origHead, head) after a `changed` clean rebase', async () => {
    const { performRebase, makeGitRunner } = await import('../../src/engine/rebase.js');

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    // The real pre-rebase tip (what git's own ORIG_HEAD resolves to once the
    // rebase below runs) — captured AFTER the feature commit, not before it,
    // so buildRewriteMap's `rev-list onto..origHead` sees the actual feature
    // commit range.
    const origHead = (await g(['rev-parse', 'HEAD'])).stdout.trim();

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    const onto = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    await g(['checkout', '-q', 'feat']);

    const translateAfterRebase = vi.fn().mockResolvedValue(undefined);
    const git = makeGitRunner(repo);
    const outcome = await (performRebase as unknown as (
      git: GitRunner,
      projectRoot: string,
      localBase: string,
      opts?: { translateAfterRebase?: typeof translateAfterRebase },
    ) => Promise<RebaseOutcome>)(git, repo, 'main', { translateAfterRebase });

    expect(outcome.kind).toBe('changed');
    const newHead = (await g(['rev-parse', 'HEAD'])).stdout.trim();

    expect(translateAfterRebase).toHaveBeenCalledTimes(1);
    expect(translateAfterRebase).toHaveBeenCalledWith(git, repo, onto, origHead, newHead);
  }, 20000);

  it('does NOT invoke translateAfterRebase on a `noop` outcome (branch already current)', async () => {
    const { performRebase, makeGitRunner } = await import('../../src/engine/rebase.js');

    await g(['checkout', '-q', '-b', 'feat']);
    const translateAfterRebase = vi.fn().mockResolvedValue(undefined);
    const git = makeGitRunner(repo);
    const outcome = await (performRebase as unknown as (
      git: GitRunner,
      projectRoot: string,
      localBase: string,
      opts?: { translateAfterRebase?: typeof translateAfterRebase },
    ) => Promise<RebaseOutcome>)(git, repo, 'main', { translateAfterRebase });

    expect(outcome.kind).toBe('noop');
    expect(translateAfterRebase).not.toHaveBeenCalled();
  }, 20000);

  it('does NOT invoke translateAfterRebase, and behaves byte-identically to today, when the capability is absent from a `changed` rebase', async () => {
    const { performRebase, makeGitRunner } = await import('../../src/engine/rebase.js');

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    await g(['checkout', '-q', 'feat']);

    const git = makeGitRunner(repo);
    // No 4th argument — today's exact call shape.
    const outcome = await performRebase(git, repo, 'main');

    expect(outcome.kind).toBe('changed');
    // Backward-compat guard: nothing about the outcome changes when the
    // capability is never supplied.
    if (outcome.kind === 'changed') {
      expect(outcome.changedCodePaths.length).toBeGreaterThan(0);
    }
  }, 20000);

  it('Task 5: carries the feature claimed surface F (changedPathsBetween(mergeBase, preTree)) on the `changed` outcome', async () => {
    const { performRebase, makeGitRunner, changedPathsBetween } = await import(
      '../../src/engine/rebase.js'
    );

    await g(['checkout', '-q', '-b', 'feat']);
    const mergeBase = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    const preTree = (await g(['rev-parse', 'HEAD'])).stdout.trim();

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    await g(['checkout', '-q', 'feat']);

    const git = makeGitRunner(repo);
    const expectedFeatureSurface = await changedPathsBetween(git, mergeBase, preTree);
    const outcome = await performRebase(git, repo, 'main');

    expect(outcome.kind).toBe('changed');
    if (outcome.kind === 'changed') {
      expect(outcome.featureSurface).toEqual(expectedFeatureSurface);
      expect(outcome.featureSurface).toContain('a.ts');
    }
  }, 20000);

  // Story 9 (amended, FR-9 remediation): classifyClean's `noop` is a code-path
  // heuristic for downstream re-verification, NOT the translation gate. A clean
  // rebase over a docs-only base advance reports `noop` yet still rewrites every
  // replayed commit's sha — skipping translation there is the exact #535
  // dangling-citation defect (rebase.ts:436-440).
  it('STILL invokes translateAfterRebase when a clean rebase moved HEAD but classifyClean reports `noop` (docs-only base advance), with no residue on a pure replay', async () => {
    const { performRebase, makeGitRunner } = await import('../../src/engine/rebase.js');
    const { translateAfterRebase: realTranslate } = await import(
      '../../src/engine/rebase-translate.js'
    );

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    const origHead = (await g(['rev-parse', 'HEAD'])).stdout.trim();

    // The base advances with a DOCS-ONLY commit: post-rebase, diff(preTree,
    // HEAD) contains only this .md path (the feature commit is in both trees),
    // so classifyClean reports `noop` — yet the replay gives feat's commit a
    // new parent and therefore a new sha.
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'docs-note.md'), 'docs only\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'docs: base advance']);
    const onto = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    await g(['checkout', '-q', 'feat']);

    // Seed the sha-anchored .pipeline stores with the PRE-rebase sha (kept
    // untracked, and seeded only now — after the base advance — so `git add .`
    // on main can't sweep them into the docs commit), so the "stores
    // translated" half of the amended Story 9 is asserted for real — not just
    // the rewrite map's existence.
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(
      join(repo, '.pipeline/task-status.json'),
      JSON.stringify({
        tasks: [{ id: 'T1', name: 'seeded', status: 'completed', commit: origHead }],
      }),
    );
    await writeFile(
      join(repo, '.pipeline/task-evidence.json'),
      JSON.stringify({
        evidenceStamps: {
          T1: { sha: origHead, form: 'commit', citedShas: [origHead] },
        },
      }),
    );

    // Delegate to the REAL translation (with an emitter, so residue — if any —
    // would actually be written) to prove the pure-replay case leaves none.
    const events = new ConductorEventEmitter();
    const translateAfterRebase = vi.fn(
      (gr: GitRunner, root: string, o: string, oh: string, h: string) =>
        realTranslate(gr, root, o, oh, h, events),
    );
    const git = makeGitRunner(repo);
    const outcome = await performRebase(git, repo, 'main', { translateAfterRebase });

    // The heuristic outcome is `noop`…
    expect(outcome.kind).toBe('noop');
    // …but the rebase genuinely moved HEAD (shas rewritten)…
    const newHead = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    expect(newHead).not.toBe(origHead);
    // …so translation MUST still run, with the real pre/post HEADs.
    expect(translateAfterRebase).toHaveBeenCalledTimes(1);
    expect(translateAfterRebase).toHaveBeenCalledWith(git, repo, onto, origHead, newHead);

    // Pure replay: patch-ids match, the map covers the replayed commit…
    const rewrites = JSON.parse(
      await readFile(join(repo, '.pipeline/rebase-rewrites.json'), 'utf-8'),
    ) as Record<string, string>;
    expect(rewrites[origHead]).toBe(newHead);

    // The sha-anchored stores are TRANSLATED, not just mapped: every seeded
    // pre-rebase citation now points at the post-rebase sha.
    const status = JSON.parse(
      await readFile(join(repo, '.pipeline/task-status.json'), 'utf-8'),
    ) as { tasks: Array<{ id: string; commit?: string }> };
    expect(status.tasks[0].commit).toBe(newHead);
    const evidence = JSON.parse(
      await readFile(join(repo, '.pipeline/task-evidence.json'), 'utf-8'),
    ) as { evidenceStamps: Record<string, { sha?: string; citedShas?: string[] }> };
    expect(evidence.evidenceStamps.T1.sha).toBe(newHead);
    expect(evidence.evidenceStamps.T1.citedShas).toEqual([newHead]);

    // …and NO residue is written.
    await expect(access(join(repo, '.pipeline/rebase-residue.json'))).rejects.toThrow();
  }, 20000);
});

describe('engine/rebase — Task 10: fail-closed on uncomputable F (real git)', () => {
  let repo: string;
  const g = (args: string[]) => execa('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-f10-'));
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'base.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('mergeBase unavailable (merge-base fails but leaks a bogus ref) → featureSurface undefined, fixed-set fallback applied', async () => {
    const { performRebase, makeGitRunner, applyRebaseVerdicts } = await import(
      '../../src/engine/rebase.js'
    );

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    await g(['checkout', '-q', 'feat']);

    const real = makeGitRunner(repo);
    // Simulate a genuinely uncomputable mergeBase: the underlying `git
    // merge-base` call fails (no common ancestor / shallow clone) but still
    // leaks a non-empty, bogus ref on stdout — the case NOT already covered
    // by the existing `mergeBase || undefined` empty-string check.
    const git: GitRunner = async (args, opts) => {
      if (args[0] === 'merge-base') {
        return {
          exitCode: 1,
          stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
          stderr: 'fatal: no merge base',
        };
      }
      return real(args, opts);
    };

    const outcome = await performRebase(git, repo, 'main');

    expect(outcome.kind).toBe('changed');
    if (outcome.kind === 'changed') {
      // Never [] — that would falsely mean "feature touched nothing" and
      // trigger unsound preservation.
      expect(outcome.featureSurface).toBeUndefined();
    }

    const pdir = await mkdtemp(join(tmpdir(), 'rebase-verdict-f10a-'));
    await mkdir(join(pdir, '.pipeline'), { recursive: true });
    const r = await applyRebaseVerdicts(pdir, outcome, true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    await rm(pdir, { recursive: true, force: true });
  }, 20000);

  it('F diff (mergeBase..preTree) throws → featureSurface undefined, performRebase does not throw/reject', async () => {
    const { performRebase, makeGitRunner, applyRebaseVerdicts } = await import(
      '../../src/engine/rebase.js'
    );

    await g(['checkout', '-q', '-b', 'feat']);
    const mergeBase = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    await g(['checkout', '-q', 'feat']);

    const real = makeGitRunner(repo);
    // Only the F diff call (the one addressed by mergeBase) throws — the D
    // diff call (preTree..HEAD) and everything else runs for real.
    const git: GitRunner = async (args, opts) => {
      if (args[0] === 'diff' && args.includes(mergeBase)) {
        throw new Error('simulated git crash computing F');
      }
      return real(args, opts);
    };

    let outcome: RebaseOutcome | undefined;
    await expect(
      (async () => {
        outcome = await performRebase(git, repo, 'main');
      })(),
    ).resolves.not.toThrow();

    expect(outcome?.kind).toBe('changed');
    if (outcome?.kind === 'changed') {
      expect(outcome.featureSurface).toBeUndefined();
    }

    const pdir = await mkdtemp(join(tmpdir(), 'rebase-verdict-f10b-'));
    await mkdir(join(pdir, '.pipeline'), { recursive: true });
    const r = await applyRebaseVerdicts(pdir, outcome as RebaseOutcome, true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    await rm(pdir, { recursive: true, force: true });
  }, 20000);
});

describe('engine/rebase — Task 11: fail-closed on uncomputable D (real git)', () => {
  let repo: string;
  const g = (args: string[]) => execa('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-d11-'));
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'base.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('D diff (preTree..HEAD) throws → performRebase does not throw/reject, fixed-set fallback applied', async () => {
    const { performRebase, makeGitRunner, applyRebaseVerdicts } = await import(
      '../../src/engine/rebase.js'
    );

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'a1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: a1']);
    const preTree = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: unrelated advance']);
    await g(['checkout', '-q', 'feat']);

    const real = makeGitRunner(repo);
    // Only the D diff call (the one addressed by preTree..HEAD) throws —
    // everything else (mergeBase, F diff, rebase itself) runs for real.
    const git: GitRunner = async (args, opts) => {
      if (args[0] === 'diff' && args.includes(preTree) && args.includes('HEAD')) {
        throw new Error('simulated git crash computing D');
      }
      return real(args, opts);
    };

    let outcome: RebaseOutcome | undefined;
    await expect(
      (async () => {
        outcome = await performRebase(git, repo, 'main');
      })(),
    ).resolves.not.toThrow();

    // Uncomputable D must not be silently treated as "no code/test paths
    // changed" (would falsely noop) or as a delta-aware-eligible outcome —
    // it must force fallback to the fixed invalidation set, exactly like
    // an uncomputable F.
    expect(outcome?.kind).toBe('changed');
    if (outcome?.kind === 'changed') {
      expect(outcome.featureSurface).toBeUndefined();
    }

    const pdir = await mkdtemp(join(tmpdir(), 'rebase-verdict-d11-'));
    await mkdir(join(pdir, '.pipeline'), { recursive: true });
    const r = await applyRebaseVerdicts(pdir, outcome as RebaseOutcome, true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'wiring_check', 'manual_test']);
    await rm(pdir, { recursive: true, force: true });
  }, 20000);
});
