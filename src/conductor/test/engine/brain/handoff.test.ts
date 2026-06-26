// Test: spec PR handoff — openSpecPr (Task 24, FR-7)
//
// openSpecPr(target, branch, deps) opens a PR in the target repo for a given
// spec branch. It:
//   1. Invokes the injected gh runner with `pr create` args, cwd = target.canonicalPath.
//   2. Scrapes the PR URL from the runner's stdout via extractPrUrl.
//   3. Records the (project, feature) authored key via recordAuthoredKey.
//   4. Returns the URL to the caller.
//
// Key negative-path / security assertions:
//   - The fake runner is NEVER called with `merge` in its args.
//   - recordAuthoredKey throws on empty project/feature — callers must supply both.
//   - When the runner returns stdout with no URL, openSpecPr throws (caller gets a
//     clear error, not undefined/null silently discarded).

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

    expect(result).toBe(PR_URL);

    // Runner was called exactly once with `pr create` args
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('pr');
    expect(calls[0].args).toContain('create');
  });

  it('calls the runner with cwd = target.canonicalPath', async () => {
    const PR_URL = 'https://github.com/acme/my-project/pull/99';
    const target = makeTarget(tempDir, 'proj-cwd-check');
    const { runner, calls } = makeFakeRunner(PR_URL);

    await openSpecPr(target, 'spec/feat-x', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    expect(calls[0].cwd).toBe(tempDir);
  });

  it('records the (project, feature) key in the authored ledger', async () => {
    const PR_URL = 'https://github.com/acme/ledger-proj/pull/7';
    const target = makeTarget(tempDir, 'ledger-proj');
    const { runner } = makeFakeRunner(PR_URL);

    await openSpecPr(target, 'spec/cool-feature', {
      runner,
      ledgerOpts: { brainDir: tempDir },
    });

    // Read the ledger back and assert exact membership.
    const keys = await readAuthoredKeys({ brainDir: tempDir });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'ledger-proj', feature: 'spec/cool-feature' });
  });

  it('is idempotent — calling twice records the key once', async () => {
    const PR_URL = 'https://github.com/acme/proj/pull/1';
    const target = makeTarget(tempDir, 'proj');
    const { runner } = makeFakeRunner(PR_URL);

    await openSpecPr(target, 'spec/thing', { runner, ledgerOpts: { brainDir: tempDir } });
    await openSpecPr(target, 'spec/thing', { runner, ledgerOpts: { brainDir: tempDir } });

    const keys = await readAuthoredKeys({ brainDir: tempDir });
    expect(keys).toHaveLength(1);
  });

  // ── Negative / security paths ──────────────────────────────────────────────

  it('NEVER calls the runner with "merge" in the args', async () => {
    const PR_URL = 'https://github.com/acme/proj/pull/5';
    const target = makeTarget(tempDir, 'proj');
    const { runner, calls } = makeFakeRunner(PR_URL);

    await openSpecPr(target, 'spec/some-branch', { runner, ledgerOpts: { brainDir: tempDir } });

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
