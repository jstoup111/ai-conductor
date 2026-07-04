// Test: runHandoff — the extracted post-authoring handoff step (retro A-2 + A-3).
//
// runHandoff(target, branch, deps) owns the post-authoring chain previously inlined
// in loop.ts processIdea (steps 4e-4g):
//   - remote target  → openSpecPr → print "Spec PR opened" / "PR skipped"
//   - no-remote target → recordAuthoredKey + print "No remote configured…"
//   - ensure-running fire-and-forget (injected launchFn spy, or real ensureRunning)
//   - returns the authored entry { project } for the caller to push onto the summary
//
// A-3 (gh! removal) is expressed here as an explicit gh-present guard:
//   - remote target + undefined gh → throws (the branch is reached only via a guard,
//     never a `gh!` non-null deref).
//   - non-remote target + undefined gh → completes WITHOUT dereferencing gh.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHandoff } from '../../../src/engine/engineer/handoff-step.js';
import { readAuthoredKeys } from '../../../src/engine/engineer/authored-ledger.js';
import { sessionNameForRepo, hasSession } from '../../../src/engine/daemon-tmux.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';

/** Build a TargetRepo pointing at a temp dir; remote optional. */
function makeTarget(canonicalPath: string, name: string, remote?: string): TargetRepo {
  return { name, canonicalPath, ...(remote !== undefined ? { remote } : {}) };
}

/** Capture print output into an array. */
function makePrint(): { print: (s: string) => void; out: string[] } {
  const out: string[] = [];
  return { print: (s: string) => out.push(s), out };
}

describe('runHandoff — remote path (PR opened)', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-step-pr-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('opens a PR, prints the URL, fires ensure-running once, records the key once, returns the entry', async () => {
    const PR_URL = 'https://github.com/acme/proj/pull/7';
    const target = makeTarget(tempDir, 'proj', 'git@github.com:acme/proj.git');
    const { print, out } = makePrint();
    const launchCalls: string[] = [];

    const entry = await runHandoff(target, 'spec/feat', {
      gh: async () => ({ stdout: `Opening pull request…\n${PR_URL}\n` }),
      engineerDir: tempDir,
      launchFn: (p) => {
        launchCalls.push(p);
      },
      print,
    });

    // The entry surfaces the spec PR URL (FR-36 write-back hook); project recorded once.
    expect(entry).toEqual({ project: 'proj', prUrl: PR_URL });
    expect(out.join('\n')).toContain(`Spec PR opened: ${PR_URL}`);
    // ensure-running fired exactly once with the canonical path.
    expect(launchCalls).toEqual([tempDir]);
    // openSpecPr records once; runHandoff must NOT double-record on the remote path.
    const keys = await readAuthoredKeys({ engineerDir: tempDir });
    expect(keys).toEqual([{ project: 'proj', feature: 'spec/feat' }]);
  });

  it('passes target.canonicalPath as gh cwd', async () => {
    const target = makeTarget(tempDir, 'cwd-proj', 'git@github.com:acme/cwd-proj.git');
    const { print } = makePrint();
    let seenCwd = '';
    await runHandoff(target, 'spec/x', {
      gh: async (_args, opts) => {
        seenCwd = opts.cwd;
        return { stdout: 'https://github.com/acme/cwd-proj/pull/1' };
      },
      engineerDir: tempDir,
      launchFn: () => {},
      print,
    });
    expect(seenCwd).toBe(tempDir);
  });

  // A-3: the remote branch is reached only via an explicit gh-present guard,
  // never a `gh!` non-null assertion.
  it('throws when target has a remote but no gh runner is wired (gh-present guard)', async () => {
    const target = makeTarget(tempDir, 'no-gh-proj', 'git@github.com:acme/no-gh.git');
    const { print } = makePrint();
    await expect(
      runHandoff(target, 'spec/feat', { engineerDir: tempDir, launchFn: () => {}, print }),
    ).rejects.toThrow(/gh runner/i);
  });
});

describe('runHandoff — no-remote path (local commit)', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-step-local-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('records the key, prints the no-remote notice, fires ensure-running, returns the entry', async () => {
    const target = makeTarget(tempDir, 'local-proj'); // no remote
    const { print, out } = makePrint();
    const launchCalls: string[] = [];

    const entry = await runHandoff(target, 'spec/local-feat', {
      // gh intentionally undefined — no-remote path must NOT dereference it (A-3).
      engineerDir: tempDir,
      launchFn: (p) => {
        launchCalls.push(p);
      },
      print,
    });

    expect(entry).toEqual({ project: 'local-proj' });
    expect(out.join('\n')).toMatch(/no remote configured/i);
    expect(out.join('\n')).toContain('spec/local-feat');
    expect(launchCalls).toEqual([tempDir]);
    const keys = await readAuthoredKeys({ engineerDir: tempDir });
    expect(keys).toEqual([{ project: 'local-proj', feature: 'spec/local-feat' }]);
  });

  it('completes without throwing when gh is undefined on the no-remote path (no gh deref)', async () => {
    const target = makeTarget(tempDir, 'no-gh-local'); // no remote, no gh
    const { print } = makePrint();
    await expect(
      runHandoff(target, 'spec/feat', { engineerDir: tempDir, launchFn: () => {}, print }),
    ).resolves.toEqual({ project: 'no-gh-local' });
  });
});

describe('runHandoff — ensure-running is fire-and-forget', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-step-fnf-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('does not block on a launchFn failure but surfaces the reason (no silent swallow)', async () => {
    const target = makeTarget(tempDir, 'fnf-proj'); // no remote → no gh needed
    const { print, out } = makePrint();
    const entry = await runHandoff(target, 'spec/fnf', {
      engineerDir: tempDir,
      launchFn: () => {
        throw new Error('boom — daemon spawn failed');
      },
      print,
    });
    // Non-blocking: the authored entry is still returned (the spec branch lands).
    expect(entry).toEqual({ project: 'fnf-proj' });
    // But NOT silent: the launch failure is surfaced with its reason so a tmux-less
    // host doesn't author specs that no daemon ever builds.
    const printed = out.join('\n');
    expect(printed).toMatch(/build daemon was not started/i);
    expect(printed).toContain('fnf-proj');
    expect(printed).toContain('boom — daemon spawn failed');
  });
});

describe('runHandoff — un-injected handoff path leaks zero sessions (deep guard)', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-step-deep-guard-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs without launchFn, hits the deep guard, produces zero sessions (un-injected path)', async () => {
    // Save and delete NO_DAEMON_AUTOLAUNCH to let the flow reach the deep guard.
    // The test setup globally sets this to '1' to prevent real daemons, but we need
    // to temporarily remove it so launchDaemon attempts to spawn (and hits the
    // NO_REAL_EXEC guard below).
    const prevAutolaunch = process.env.AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH;
    delete process.env.AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH;

    try {
      const target = makeTarget(tempDir, 'un-injected-proj');
      const { print, out } = makePrint();

      // Run with NO launchFn (undefined) to trigger real ensureRunning → launchDaemon.
      // With AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH unset and NO supervisor injected,
      // launchDaemon will call makeTmuxSupervisor. The supervisor will attempt
      // newDetachedSession, which hits the deep guard: defaultTmuxRunner checks
      // AI_CONDUCTOR_NO_REAL_EXEC=1 and throws before spawning a real tmux session.
      // runHandoff catches this error and prints it as a warning (no blocking).
      const entry = await runHandoff(target, 'spec/un-injected', {
        engineerDir: tempDir,
        // launchFn intentionally omitted
        print,
      });

      // Assert handoff completed successfully (fire-and-forget; error was swallowed).
      expect(entry).toEqual({ project: 'un-injected-proj' });

      // Assert the output contains the daemon warning.
      const printed = out.join('\n');
      expect(printed).toMatch(/build daemon was not started/i);

      // Assert no real session was created. The deep guard prevented any tmux call,
      // so hasSession should return false (no session exists under this name).
      const sessionName = sessionNameForRepo(tempDir);
      const sessionExists = await hasSession(sessionName);
      expect(sessionExists).toBe(false);
    } finally {
      // Restore the environment to the test setup's default.
      if (prevAutolaunch === undefined) {
        delete process.env.AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH;
      } else {
        process.env.AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH = prevAutolaunch;
      }
    }
  });
});
