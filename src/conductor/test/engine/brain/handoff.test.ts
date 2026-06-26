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
