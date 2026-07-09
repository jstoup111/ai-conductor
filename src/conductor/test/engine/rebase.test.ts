import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  type GitRunner,
  type GitResult,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

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

  it('changed → rebase satisfied + build/manual_test kicked back (from rebase)', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const r = await applyRebaseVerdicts(dir, outcome, true);
    expect(r.satisfied).toBe(true);
    expect(r.kickedBack).toEqual(['build', 'build_review', 'manual_test']);
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.kickback?.from).toBe('rebase');
  });

  it('changed but manual_test did not run → only build kicked back', async () => {
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'] };
    const r = await applyRebaseVerdicts(dir, outcome, false);
    expect(r.kickedBack).toEqual(['build', 'build_review']);
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
    expect(r.kickedBack).toEqual(['build', 'build_review', 'manual_test']);
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
    expect(r.kickedBack).toEqual(['build_review', 'manual_test']);
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
    expect(r.kickedBack).toEqual(['build', 'build_review', 'manual_test']);
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
    expect(r.kickedBack).toEqual(['build', 'build_review', 'manual_test']);
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
    expect(r.kickedBack).toEqual(['build_review']);
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
    expect(r.kickedBack).toEqual(['build', 'build_review']);
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
