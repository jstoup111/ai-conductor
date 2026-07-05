/**
 * Real-binary smoke test for the autoresolve pipeline (Task 19,
 * story: "worktree story + lease story 'Done When' smokes",
 * .docs/stories/auto-resolve-open-pr-conflicts.md).
 *
 * Unlike the unit/integration suite (which injects fake `GitRunner`s), this
 * test drives the REAL `git` binary end-to-end against a scratch bare "origin"
 * repo:
 *
 *   1. Happy path — a real CHANGELOG.md conflict is created between a PR
 *      branch and its base (both add distinct lines to `## [Unreleased]`).
 *      `performRebase` (src/engine/rebase.ts) is run for real inside a git
 *      worktree, auto-resolves the CHANGELOG-only conflict, and
 *      `pushRefreshedBranch` (src/engine/autoresolve.ts) publishes the result
 *      with `--force-with-lease`. Asserts: outcome is `changelog_resolved`,
 *      the origin branch tip is refreshed, and BOTH the original feature
 *      commit content and the base's sibling addition are preserved.
 *
 *   2. Concurrent-push rejection — before the lease push runs, a second
 *      independent actor ("outsider") pushes to the SAME PR branch on origin.
 *      The lease push must be rejected and the origin branch must be left
 *      byte-for-byte as the outsider left it (no retry, no force fallback).
 *
 * Kill-switch: gated behind `AUTORESOLVE_SMOKE_TEST=1` so normal unit/CI runs
 * stay hermetic (no real git subprocess fan-out, no risk of flaking CI on
 * environment quirks). Run explicitly with:
 *
 *   AUTORESOLVE_SMOKE_TEST=1 npx vitest run test/smoke/autoresolve-smoke.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execa } from 'execa';
import { performRebase, makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { pushRefreshedBranch } from '../../src/engine/autoresolve.js';

const execFile = promisify(execFileCb);

const SMOKE = process.env.AUTORESOLVE_SMOKE_TEST === '1';

const CHANGELOG_BASE = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '- initial release',
  '',
].join('\n');

async function initRepo(dir: string): Promise<void> {
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execFile('git', ['config', 'user.email', 't@t.com'], { cwd: dir });
  await execFile('git', ['config', 'user.name', 'T'], { cwd: dir });
  await execFile('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

// Real-binary smoke: skipped by default (kill-switch), run explicitly via
// AUTORESOLVE_SMOKE_TEST=1 so CI/unit runs stay hermetic.
describe.skipIf(!SMOKE)('smoke/autoresolve — real-binary worktree + lease push', () => {
  let origin: string;
  let work: string; // the resolution worktree that runs performRebase + pushes
  let outsider: string; // a second clone simulating a concurrent operator push

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), 'autoresolve-smoke-origin-'));
    await execFile('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });

    // Seed origin: main with a base CHANGELOG.
    const seed = await mkdtemp(join(tmpdir(), 'autoresolve-smoke-seed-'));
    await initRepo(seed);
    await writeFile(join(seed, 'CHANGELOG.md'), CHANGELOG_BASE);
    await execFile('git', ['add', '.'], { cwd: seed });
    await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: seed });
    await execFile('git', ['remote', 'add', 'origin', origin], { cwd: seed });
    await execFile('git', ['push', 'origin', 'main'], { cwd: seed });

    // PR branch: add this feature's [Unreleased] line.
    await execFile('git', ['checkout', '-q', '-b', 'feat/widget'], { cwd: seed });
    const featureChangelog = CHANGELOG_BASE.replace(
      '### Added\n',
      '### Added\n\n- Widget feature (this PR)\n',
    );
    await writeFile(join(seed, 'CHANGELOG.md'), featureChangelog);
    await execFile('git', ['commit', '-q', '-am', 'add widget feature'], { cwd: seed });
    await execFile('git', ['push', 'origin', 'feat/widget'], { cwd: seed });

    // Advance main with a SIBLING addition — creates a real CHANGELOG conflict
    // when feat/widget is rebased onto the refreshed main.
    await execFile('git', ['checkout', '-q', 'main'], { cwd: seed });
    const siblingChangelog = CHANGELOG_BASE.replace(
      '### Added\n',
      '### Added\n\n- Sibling feature (merged first)\n',
    );
    await writeFile(join(seed, 'CHANGELOG.md'), siblingChangelog);
    await execFile('git', ['commit', '-q', '-am', 'add sibling feature'], { cwd: seed });
    await execFile('git', ['push', 'origin', 'main'], { cwd: seed });
    await rm(seed, { recursive: true, force: true });

    // The resolution worktree: a real clone checked out at the PR branch tip.
    work = await mkdtemp(join(tmpdir(), 'autoresolve-smoke-work-'));
    await execFile('git', ['clone', '-q', origin, work]);
    await execFile('git', ['checkout', '-q', 'feat/widget'], { cwd: work });
    await execFile('git', ['config', 'user.email', 't@t.com'], { cwd: work });
    await execFile('git', ['config', 'user.name', 'T'], { cwd: work });
    await execFile('git', ['config', 'commit.gpgsign', 'false'], { cwd: work });
    await execFile('git', ['fetch', 'origin', 'main'], { cwd: work });

    // Independent second clone simulating a concurrent human/operator push.
    outsider = await mkdtemp(join(tmpdir(), 'autoresolve-smoke-outsider-'));
    await execFile('git', ['clone', '-q', origin, outsider]);
    await execFile('git', ['checkout', '-q', 'feat/widget'], { cwd: outsider });
    await execFile('git', ['config', 'user.email', 'o@o.com'], { cwd: outsider });
    await execFile('git', ['config', 'user.name', 'O'], { cwd: outsider });
    await execFile('git', ['config', 'commit.gpgsign', 'false'], { cwd: outsider });
  });

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    await rm(outsider, { recursive: true, force: true });
  });

  it('resolves a real CHANGELOG conflict via performRebase and publishes with a lease push; branch refreshed, commits preserved', async () => {
    const git: GitRunner = makeGitRunner(work);

    const outcome = await performRebase(git, work, 'main');
    expect(outcome.kind).toBe('changelog_resolved');

    // The rebase must be fully finished — no unmerged paths, no rebase-merge dir.
    const status = await execFile('git', ['status', '--porcelain'], { cwd: work });
    expect(status.stdout.trim()).toBe('');

    // Both the sibling's and this feature's [Unreleased] additions survived.
    const resolvedChangelog = await readFile(join(work, 'CHANGELOG.md'), 'utf-8');
    expect(resolvedChangelog).toContain('Widget feature (this PR)');
    expect(resolvedChangelog).toContain('Sibling feature (merged first)');

    // The feature commit itself must still be present in the rebased history.
    const log = await execFile('git', ['log', '--oneline', '--format=%s'], { cwd: work });
    expect(log.stdout).toContain('add widget feature');

    // Publish: lease-protected push.
    const pushResult = await pushRefreshedBranch(git, 'feat/widget');
    expect(pushResult).toEqual({ pushed: true });

    // Origin branch refreshed: now contains main's tip as an ancestor and
    // carries the resolved CHANGELOG content.
    await execFile('git', ['fetch', 'origin', 'feat/widget', 'main'], { cwd: outsider });
    const mergeBaseCheck = await execFile(
      'git',
      ['merge-base', '--is-ancestor', 'origin/main', 'origin/feat/widget'],
      { cwd: outsider },
    ).then(
      () => true,
      () => false,
    );
    expect(mergeBaseCheck).toBe(true);

    const remoteChangelog = (
      await execFile('git', ['show', 'origin/feat/widget:CHANGELOG.md'], { cwd: outsider })
    ).stdout;
    expect(remoteChangelog).toContain('Widget feature (this PR)');
    expect(remoteChangelog).toContain('Sibling feature (merged first)');

    const remoteLog = await execFile(
      'git',
      ['log', 'origin/feat/widget', '--oneline', '--format=%s'],
      { cwd: outsider },
    );
    expect(remoteLog.stdout).toContain('add widget feature');
  });

  it('rejects the lease push when an outsider concurrently pushes to the same PR branch first, leaving origin untouched', async () => {
    const git: GitRunner = makeGitRunner(work);

    const outcome = await performRebase(git, work, 'main');
    expect(outcome.kind).toBe('changelog_resolved');

    // A genuinely concurrent push lands on origin AFTER resolution began in
    // `work` but BEFORE `work` publishes — simulating a human pushing a fix
    // to the PR while the daemon was mid-resolution.
    await writeFile(join(outsider, 'feature.txt'), 'concurrent human edit\n');
    await execFile('git', ['add', '.'], { cwd: outsider });
    await execFile('git', ['commit', '-q', '-m', 'operator pushed a concurrent fix'], {
      cwd: outsider,
    });
    await execFile('git', ['push', 'origin', 'feat/widget'], { cwd: outsider });
    const remoteBeforeSha = (
      await execFile('git', ['rev-parse', 'origin/feat/widget'], { cwd: outsider })
    ).stdout.trim();

    const pushResult = await pushRefreshedBranch(git, 'feat/widget');
    expect(pushResult).toEqual({
      pushed: false,
      reason: expect.stringMatching(/lease|stale|reject/i),
    });

    // Origin is untouched — exactly what the outsider pushed, no retry/force.
    await execFile('git', ['fetch', 'origin', 'feat/widget'], { cwd: outsider });
    const remoteAfterSha = (
      await execFile('git', ['rev-parse', 'origin/feat/widget'], { cwd: outsider })
    ).stdout.trim();
    expect(remoteAfterSha).toBe(remoteBeforeSha);

    const remoteLog = await execFile(
      'git',
      ['log', 'origin/feat/widget', '--oneline', '--format=%s'],
      { cwd: outsider },
    );
    expect(remoteLog.stdout).toContain('operator pushed a concurrent fix');
  });
});
