// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Conductor test suite determinism under parallel
// forks" (#573).
//
// Stories: .docs/stories/conductor-suite-fork-determinism.md — Story 4
// (real-git tests use a shared hardened repo helper) + Story 5 (object-heavy
// files isolated from fork contention as defense-in-depth), covered together
// because the acceptance criterion is a FLOW: init a repo through the new
// shared helper, write enough objects/trees to be "object-heavy" (the class
// of file Story 5 targets), then read back both the applied durability
// config AND a tree object — a single-operation "does initTestRepo run"
// check cannot distinguish "config applied" from "config applied AND still
// readable after object churn", so per writing-system-tests §3a this
// crosses 2+ operations and belongs here, not in a lower unit layer.
//
// NONE of this feature's production code exists yet: `test/fixtures/git-repo.ts`
// does not exist on this branch (only test/fixtures/halt-issues and
// test/fixtures/session-hook-payloads do). The import below is dynamic,
// inside the test body — per the project's own precedent in
// test/acceptance/daemon-lifecycle-controls.test.ts ("dynamic imports below
// so a missing module RRED's the one test that needs it, not the whole
// file") — so a missing module fails this test with a normal assertion-style
// error (module not found), not a suite-level collection error, which is the
// correct RED for code that hasn't been written yet (§6: a collection error
// is not RED, but a test whose body throws because its subject doesn't exist
// is).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

describe('Shared hardened git-repo test helper (Story 4 + Story 5)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function gitConfigGet(cwd: string, key: string): Promise<string> {
    const result = await execa('git', ['config', '--get', key], { cwd, reject: false });
    return result.stdout.trim();
  }

  it('initTestRepo applies durable, non-repacking object-store config (gc.auto=0, maintenance.auto=false, core.fsync=loose-object, core.fsyncObjectFiles=true)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-repo-durability-'));

    const { initTestRepo } = await import('../fixtures/git-repo.js');
    await initTestRepo(dir);

    expect(await gitConfigGet(dir, 'gc.auto')).toBe('0');
    expect(await gitConfigGet(dir, 'maintenance.auto')).toBe('false');
    expect(await gitConfigGet(dir, 'core.fsync')).toBe('loose-object');
    expect(await gitConfigGet(dir, 'core.fsyncObjectFiles')).toBe('true');
  });

  it('a repo initialized through the helper stays readable after object-heavy commit churn (no "invalid object / Error building trees")', async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-repo-durability-churn-'));

    const gitRepoModule = await import('../fixtures/git-repo.js');
    const { initTestRepo } = gitRepoModule;
    await initTestRepo(dir);

    // Simulate an "object-heavy" file: many commits/trees in a loop, the
    // exact shape the story attributes the Family B flake to.
    for (let i = 0; i < 25; i++) {
      await execa('bash', ['-c', `echo "iteration ${i}" > file-${i}.txt`], { cwd: dir });
      await execa('git', ['add', '-A'], { cwd: dir });
      await execa('git', ['commit', '-m', `commit ${i}`], { cwd: dir });
    }

    // Durable, guarded read of the final tree — must not raise "invalid
    // object" / "Error building trees" even under repeated object writes.
    const catFile = await execa('git', ['cat-file', '-p', 'HEAD^{tree}'], { cwd: dir, reject: false });
    expect(catFile.exitCode).toBe(0);

    const log = await execa('git', ['log', '--oneline'], { cwd: dir, reject: false });
    expect(log.exitCode).toBe(0);
    expect(log.stdout.trim().split('\n')).toHaveLength(25);
  });

  it('applies config on the target repo only — never global/$HOME config (scope guard)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-repo-durability-scope-'));

    const { initTestRepo } = await import('../fixtures/git-repo.js');
    await initTestRepo(dir);

    // The durability config must be local to the repo, not global — a
    // second, untouched tmpdir repo must NOT inherit gc.auto=0 from a
    // leaked global/$HOME write.
    const otherDir = await mkdtemp(join(tmpdir(), 'git-repo-durability-unrelated-'));
    try {
      await execa('git', ['init', '-b', 'main'], { cwd: otherDir });
      const leaked = await gitConfigGet(otherDir, 'gc.auto');
      expect(leaked).not.toBe('0');
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
