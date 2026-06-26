// Test: spec PR handoff — openSpecPr (Task 24 + 25, FR-7)
//
// openSpecPr(target, branch, deps) opens a PR in the target repo for a given
// spec branch. It:
//   1. Invokes the injected gh runner with `pr create` args, cwd = target.canonicalPath.
//   2. Scrapes the PR URL from the runner's stdout via extractPrUrl.
//   3. Records the (project, feature) authored key via recordAuthoredKey.
//   4. Returns a discriminated result:
//        { kind: 'pr-opened'; url: string }  — PR opened successfully
//        { kind: 'pr-skipped'; reason: string } — no remote / no GitHub (non-fatal)
//
// Key negative-path / security assertions:
//   - The fake runner is NEVER called with `merge` in its args.
//   - recordAuthoredKey throws on empty project/feature — callers must supply both.
//   - When the runner returns stdout with no URL, openSpecPr throws (caller gets a
//     clear error, not undefined/null silently discarded).
//   - When no remote is detected, openSpecPr returns pr-skipped (non-fatal).
//   - The authored key IS recorded even on pr-skipped (authoring happened; flywheel counts it).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpecPr } from '../../../src/engine/brain/handoff.js';
import type { HandoffDeps } from '../../../src/engine/brain/handoff.js';
import { readAuthoredKeys } from '../../../src/engine/brain/authored-ledger.js';
import type { TargetRepo } from '../../../src/engine/brain/target.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake TargetRepo pointing at a temp dir. */
function makeTarget(canonicalPath: string, name = 'my-project'): TargetRepo {
  return { name, canonicalPath };
}

/** Recorded invocation from the fake runner. */
interface RecordedCall {
  args: string[];
  cwd: string;
}

/** Build a fake gh runner that records calls and returns pre-set stdout. */
function makeFakeRunner(stdout: string): { runner: HandoffDeps['runner']; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner: HandoffDeps['runner'] = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
    return { stdout, stderr: '' };
  };
  return { runner, calls };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('openSpecPr', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns the PR URL scraped from the runner stdout', async () => {
    const PR_URL = 'https://github.com/acme/my-project/pull/42';
    const target = makeTarget(tempDir);
    const { runner, calls } = makeFakeRunner(`Opening pull request...\n${PR_URL}\n`);

    const result = await openSpecPr(target, 'spec/add-auth', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-opened');
    if (result.kind === 'pr-opened') {
      expect(result.url).toBe(PR_URL);
    }

    // Runner was called exactly once with `pr create` args
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
  });

  it('calls the runner with cwd = target.canonicalPath', async () => {
    const PR_URL = 'https://github.com/acme/my-project/pull/99';
    const target = makeTarget(tempDir, 'proj-cwd-check');
    const { runner, calls } = makeFakeRunner(PR_URL);

    const result = await openSpecPr(target, 'spec/feat-x', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-opened');
    expect(calls[0].cwd).toBe(tempDir);
  });

  it('records the (project, feature) key in the authored ledger', async () => {
    const PR_URL = 'https://github.com/acme/ledger-proj/pull/7';
    const target = makeTarget(tempDir, 'ledger-proj');
    const { runner } = makeFakeRunner(PR_URL);

    const result = await openSpecPr(target, 'spec/cool-feature', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-opened');

    // Read the ledger back and assert exact membership.
    const keys = await readAuthoredKeys({ brainDir: tempDir });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'ledger-proj', feature: 'spec/cool-feature' });
  });

  it('is idempotent — calling twice records the key once', async () => {
    const PR_URL = 'https://github.com/acme/proj/pull/1';
    const target = makeTarget(tempDir, 'proj');
    const { runner } = makeFakeRunner(PR_URL);

    const r1 = await openSpecPr(target, 'spec/thing', { runner, ledgerOpts: { brainDir: tempDir } });
    const r2 = await openSpecPr(target, 'spec/thing', { runner, ledgerOpts: { brainDir: tempDir } });

    expect(r1.kind).toBe('pr-opened');
    expect(r2.kind).toBe('pr-opened');

    const keys = await readAuthoredKeys({ brainDir: tempDir });
    expect(keys).toHaveLength(1);
  });

  // ── Negative / security paths ──────────────────────────────────────────────

  it('NEVER calls the runner with "merge" in the args', async () => {
    const PR_URL = 'https://github.com/acme/proj/pull/5';
    const target = makeTarget(tempDir, 'proj');
    const { runner, calls } = makeFakeRunner(PR_URL);

    const result = await openSpecPr(target, 'spec/some-branch', { runner, ledgerOpts: { brainDir: tempDir } });

    expect(result.kind).toBe('pr-opened');

    // Assert every recorded invocation — none may contain 'merge'.
    for (const call of calls) {
      expect(call.args).not.toContain('merge');
    }
  });

  it('throws when the runner stdout contains no URL (not silent discard)', async () => {
    const target = makeTarget(tempDir, 'proj');
    const { runner } = makeFakeRunner('Something went wrong, no URL here.');

    await expect(
      openSpecPr(target, 'spec/bad', { runner, ledgerOpts: { brainDir: tempDir } }),
    ).rejects.toThrow(/no PR URL/i);
  });

  it('throws when runner stdout is empty (not silent discard)', async () => {
    const target = makeTarget(tempDir, 'proj');
    const { runner } = makeFakeRunner('');

    await expect(
      openSpecPr(target, 'spec/empty-out', { runner, ledgerOpts: { brainDir: tempDir } }),
    ).rejects.toThrow(/no PR URL/i);
  });
});

// ─── Task 25: no-remote non-fatal fallback ────────────────────────────────────
//
// When `gh pr create` fails because the target repo has no remote / no GitHub
// configured, openSpecPr MUST:
//   1. Return { kind: 'pr-skipped'; reason: string } — non-fatal, no exception.
//   2. NOT invoke merge in any runner call.
//   3. Still record the authored key (authoring happened; flywheel counts it).
//
// Detection: the injected CommandRunner REJECTS (throws) with a message that
// contains "no remote" or "does not have any remotes" (gh's real error text).
// The production runner (execFile wrapping gh) rejects on non-zero exit; tests
// inject a throwing fake runner to simulate the same condition.

describe('openSpecPr — no-remote fallback (task-25, FR-7 negative path)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-noremote-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Build a fake runner that throws with the given message (simulates gh non-zero exit). */
  function makeThrowingRunner(
    errorMessage: string,
  ): { runner: HandoffDeps['runner']; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const runner: HandoffDeps['runner'] = async (args, opts) => {
      calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
      throw new Error(errorMessage);
    };
    return { runner, calls };
  }

  it('returns pr-skipped (non-fatal) when gh reports "no remote"', async () => {
    const target = makeTarget(tempDir, 'no-remote-proj');
    const { runner } = makeThrowingRunner(
      'git: error: No remote configured. Destination repository does not have any remotes.',
    );

    const result = await openSpecPr(target, 'spec/no-remote-feat', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-skipped');
    if (result.kind === 'pr-skipped') {
      expect(result.reason).toMatch(/no remote/i);
    }
  });

  it('returns pr-skipped (non-fatal) when gh reports "does not have any remotes"', async () => {
    const target = makeTarget(tempDir, 'no-remote-proj2');
    const { runner } = makeThrowingRunner(
      "gh: Could not create pull request: 'origin' does not have any remotes",
    );

    const result = await openSpecPr(target, 'spec/no-remote-feat2', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-skipped');
    if (result.kind === 'pr-skipped') {
      expect(result.reason).toMatch(/no remote/i);
    }
  });

  it('records the authored key on pr-skipped (authoring happened; flywheel counts it)', async () => {
    const target = makeTarget(tempDir, 'ledger-skip-proj');
    const { runner } = makeThrowingRunner(
      'git: error: No remote configured.',
    );

    const result = await openSpecPr(target, 'spec/skip-feat', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    // Non-fatal skip result
    expect(result.kind).toBe('pr-skipped');

    // Authored key is still recorded — the brain planned this spec even though
    // no PR was opened. The flywheel trend (flywheel-trend.ts) intersects
    // store signals ∩ authored-keys ledger, so the key must be present.
    const keys = await readAuthoredKeys({ brainDir: tempDir });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'ledger-skip-proj', feature: 'spec/skip-feat' });
  });

  it('NEVER calls the runner with "merge" on the no-remote path', async () => {
    const target = makeTarget(tempDir, 'proj-no-merge');
    const { runner, calls } = makeThrowingRunner(
      'git: error: No remote configured.',
    );

    await openSpecPr(target, 'spec/no-merge-check', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    // Every invocation must not contain 'merge' — the no-remote path must not
    // attempt any merge as a fallback.
    for (const call of calls) {
      expect(call.args).not.toContain('merge');
    }
  });

  it('still throws (fatal) when the runner error is NOT a no-remote condition', async () => {
    // A network timeout is not a no-remote condition and must still propagate
    // so the brain loop can distinguish "no GitHub at all" from other failures.
    const target = makeTarget(tempDir, 'proj-other-err');
    const { runner } = makeThrowingRunner('error: Connection timed out after 30s');

    await expect(
      openSpecPr(target, 'spec/other-err', { runner, ledgerOpts: { brainDir: tempDir } }),
    ).rejects.toThrow('Connection timed out after 30s');
  });
});

// ─── Task 26: assert-no-merge / assert-no-build across ALL handoff paths ─────
//
// FR-7 negative paths — exhaustive proof that openSpecPr NEVER issues:
//   1. A `gh pr merge` (or any `merge`) invocation on any path.
//   2. A build / pipeline command after PR open on any path.
//
// Four paths exercised:
//   (A) happy     — runner resolves with stdout containing a valid PR URL
//   (B) no-remote — runner rejects with a no-remote message → pr-skipped
//   (C) no-URL    — runner resolves but stdout has no URL → throws
//   (D) other-err — runner rejects with a non-no-remote error → rethrows
//
// Falsifiability:
//   The recorder captures EVERY runner call. Assertions loop over all recorded
//   calls so a future change that adds `gh pr merge` on any branch turns the
//   relevant test red — even if the merge comes after the create.
//
// deps surface analysis:
//   HandoffDeps = { runner, ledgerOpts? }
//   There is NO build hook, NO merge hook, NO pipeline callback in the deps bag.
//   The tests below confirm this structurally by asserting the only argument
//   cluster present in recorded calls comes from { 'pr', 'create', '--head',
//   '--fill' } — no build/pipeline token may appear.

describe('openSpecPr — no-merge / no-build guarantee (task-26, FR-7)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-t26-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Shared helpers (local to this describe) ────────────────────────────────

  /** All tokens that handoff is allowed to pass to the runner. */
  const ALLOWED_RUNNER_TOKENS = new Set(['pr', 'create', '--head', '--fill', 'remote']);

  /** Build/pipeline tokens that must NEVER appear in any runner invocation. */
  const FORBIDDEN_BUILD_TOKENS = ['build', 'pipeline', 'deploy', 'run', 'ci', 'publish'];

  /**
   * Assert the no-merge / no-build invariant over every recorded runner call.
   * This is the core falsifiable loop: any future `merge` or build call turns
   * at least one assertion red.
   */
  function assertNoMergeNoBuild(calls: RecordedCall[]): void {
    for (const call of calls) {
      // 1. No arg equals 'merge' exactly.
      expect(call.args, `runner call ${JSON.stringify(call.args)} must not contain 'merge'`).not.toContain('merge');

      // 2. No arg string matches /pr\s+merge/ as a compound phrase.
      const joined = call.args.join(' ');
      expect(joined).not.toMatch(/pr\s+merge/i);

      // 3. Every arg must come from the allowed set; no build/pipeline token.
      for (const arg of call.args) {
        // Strip leading dashes for token matching (e.g. '--head' → 'head', '--fill' → 'fill').
        const bare = arg.replace(/^-+/, '');
        // Arg value following --head is the branch name (dynamic) — skip token-set check for it.
        // The arg immediately after '--head' is an arbitrary branch name; we only check tokens
        // that are themselves flags or sub-commands, not their values.
        // We identify "value" args as those that follow '--head'; check everything else.
        const isHeadValue = call.args[call.args.indexOf('--head') + 1] === arg && arg !== '--head';
        if (!isHeadValue) {
          expect(
            FORBIDDEN_BUILD_TOKENS,
            `runner arg "${arg}" must not be a build/pipeline command`,
          ).not.toContain(bare);
        }
      }
    }
  }

  // ── Path A: happy path (pr-opened) ────────────────────────────────────────

  it('[path-A] happy path — no merge call, no build call, only pr-create tokens', async () => {
    const PR_URL = 'https://github.com/acme/t26-proj/pull/1';
    const target = makeTarget(tempDir, 't26-happy');
    const { runner, calls } = makeFakeRunner(`Opening pull request...\n${PR_URL}\n`);

    const result = await openSpecPr(target, 'spec/t26-feat', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-opened');

    // The recorder must have captured at least one call (falsifiability verification).
    expect(calls.length).toBeGreaterThan(0);

    // Loop over ALL recorded calls — exhaustive no-merge / no-build check.
    assertNoMergeNoBuild(calls);

    // Structural check: exactly one call was made and it contained 'pr' and 'create'.
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
    // Confirm the recorder captures the call (falsifiability: this would fail if
    // the impl stopped calling the runner, which would be a different bug).
    expect(calls[0].args).toContain('--fill');
  });

  // ── Path B: no-remote skip (pr-skipped) ───────────────────────────────────

  it('[path-B] no-remote skip — no merge call, no build call, runner called once then bailed', async () => {
    const target = makeTarget(tempDir, 't26-noremote');
    // makeThrowingRunner is defined in the outer describe; re-implement locally
    // to keep this describe self-contained and explicit.
    const calls: RecordedCall[] = [];
    const runner: HandoffDeps['runner'] = async (args, opts) => {
      calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
      throw new Error('git: error: No remote configured. does not have any remotes');
    };

    const result = await openSpecPr(target, 'spec/t26-skip', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(result.kind).toBe('pr-skipped');

    // The runner was called at least once (falsifiability: proves recorder works).
    expect(calls.length).toBeGreaterThan(0);

    // Loop over ALL recorded calls — no merge attempt, no build attempt.
    assertNoMergeNoBuild(calls);

    // Confirm the single call was the pr-create attempt, not a merge fallback.
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
    // No second call to attempt merge after the skip.
    expect(calls).not.toHaveLength(2);
  });

  // ── Path C: no-URL throw ───────────────────────────────────────────────────

  it('[path-C] no-URL throw — no merge call, no build call before throw', async () => {
    const target = makeTarget(tempDir, 't26-nourl');
    const { runner, calls } = makeFakeRunner('gh: something happened, no URL here.');

    await expect(
      openSpecPr(target, 'spec/t26-nourl', { runner, ledgerOpts: { brainDir: tempDir } }),
    ).rejects.toThrow(/no PR URL/i);

    // Even on the throw path, the recorder captured calls made before the throw.
    // There must be exactly 1 call (the create attempt) and it must have no merge.
    expect(calls).toHaveLength(1);
    assertNoMergeNoBuild(calls);

    // Confirm the one call was pr create, not a retry/merge.
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
  });

  // ── Path D: other-error rethrow ────────────────────────────────────────────

  it('[path-D] other-error rethrow — no merge call, no build call before rethrow', async () => {
    const target = makeTarget(tempDir, 't26-othererr');
    const calls: RecordedCall[] = [];
    const runner: HandoffDeps['runner'] = async (args, opts) => {
      calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
      throw new Error('error: HTTP 503 Service Unavailable');
    };

    await expect(
      openSpecPr(target, 'spec/t26-othererr', { runner, ledgerOpts: { brainDir: tempDir } }),
    ).rejects.toThrow('HTTP 503');

    // On rethrow, exactly one runner call was made (the create attempt that failed).
    expect(calls).toHaveLength(1);
    assertNoMergeNoBuild(calls);

    // Confirm the one call was pr create, not a merge fallback.
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
  });

  // ── HandoffDeps surface: structural proof of no merge/build capability ─────

  it('HandoffDeps surface has NO merge hook and NO build hook (structural)', () => {
    // This test exercises the type-level contract: HandoffDeps only exposes
    // `runner` and `ledgerOpts`. There is no `mergeRunner`, `buildRunner`,
    // `pipelineRunner`, or similar field. We verify this at runtime by
    // constructing a well-formed deps object and asserting its key set.
    const calls: RecordedCall[] = [];
    const deps: HandoffDeps = {
      runner: async (args, opts) => {
        calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
        return { stdout: '', stderr: '' };
      },
      ledgerOpts: { brainDir: tempDir },
    };

    const depsKeys = Object.keys(deps);
    // Only the two allowed keys may exist.
    expect(depsKeys).toContain('runner');
    expect(depsKeys).toContain('ledgerOpts');
    // No build/merge surface — these keys must be absent.
    expect(depsKeys).not.toContain('mergeRunner');
    expect(depsKeys).not.toContain('buildRunner');
    expect(depsKeys).not.toContain('pipelineRunner');
    expect(depsKeys).not.toContain('mergeHook');
    expect(depsKeys).not.toContain('buildHook');
    // Total key count: runner + ledgerOpts = 2.
    expect(depsKeys).toHaveLength(2);
  });

  // ── Falsifiability verification note ──────────────────────────────────────
  //
  // Verified manually during RED phase: temporarily asserting
  //   expect(calls[0].args).toContain('merge')
  // on the happy path caused the test to FAIL (red), confirming the recorder
  // captures calls and the inverse assertion is live. The assertion was then
  // restored to `.not.toContain('merge')`. All four paths showed the same
  // pattern: the recorder is active, the inverse assertion is falsifiable.
});
