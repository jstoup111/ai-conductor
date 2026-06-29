// Test: fire-and-forget daemon launch (FR-8; ADR-005 intent, ADR-014 mechanism).
//
// ADR-014 supersedes ADR-005's spawn-MECHANISM detail: launchDaemon no
// longer does a detached `stdio:'ignore'` node spawn — it delegates to the tmux
// Supervisor's idempotent `start(project)` so the daemon is hosted in an
// operator-attachable session. The NON-MANAGEMENT guarantee (ADR-005 FR-8) is
// preserved and still asserted here: the engineer retains no handle/IPC/control,
// the module exposes no stop/kill/restart, and nothing launches implicitly.
//
// The supervisor is injectable via opts.supervisor so the test verifies the exact
// delegation without spawning real tmux.

import { describe, it, expect, vi } from 'vitest';
import { launchDaemon, NO_AUTOLAUNCH_ENV } from '../../../src/engine/engineer/daemon-launch.js';
import type { DaemonStarter } from '../../../src/engine/engineer/daemon-launch.js';
import * as daemonLaunchModule from '../../../src/engine/engineer/daemon-launch.js';

/** A start-only supervisor spy — records the repo paths it was asked to start. */
function makeStarterSpy() {
  const starts: string[] = [];
  const supervisor: DaemonStarter = {
    start: vi.fn((repo: string) => {
      starts.push(repo);
    }),
  };
  return { supervisor, starts };
}

// The global test setup (test/setup.ts) sets AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH=1 so the
// suite never spawns a real daemon. These tests assert that kill-switch contract.
describe('launchDaemon — auto-launch kill-switch (NO_AUTOLAUNCH_ENV)', () => {
  it('suppresses the REAL default launch when the kill-switch is on (no injected supervisor)', () => {
    expect(process.env[NO_AUTOLAUNCH_ENV]).toBe('1'); // set globally by test/setup.ts
    // No supervisor injected → with the switch on this must be a no-op (never reaches
    // makeTmuxSupervisor, so no real `tmux new-session`); returns undefined.
    expect(launchDaemon('/projects/kill-switch-test')).toBeUndefined();
  });

  it('an INJECTED supervisor is NEVER suppressed by the kill-switch (delegation contract holds)', () => {
    const { supervisor, starts } = makeStarterSpy();
    launchDaemon('/projects/kill-switch-test', { supervisor });
    expect(supervisor.start).toHaveBeenCalledOnce();
    expect(starts).toEqual(['/projects/kill-switch-test']);
  });
});

describe('launchDaemon (ADR-014 mechanism: tmux Supervisor.start)', () => {
  it('delegates to supervisor.start(project) exactly once', () => {
    const { supervisor, starts } = makeStarterSpy();

    launchDaemon('/projects/my-app', { supervisor });

    expect(supervisor.start).toHaveBeenCalledOnce();
    expect(starts).toEqual(['/projects/my-app']);
  });

  it('passes the repo path through unchanged (daemon binds to repoPath — FR-22 intent)', () => {
    const { supervisor, starts } = makeStarterSpy();

    launchDaemon('/projects/alpha', { supervisor });

    // The repo path is the start() argument (the session is created with cwd=repo);
    // it is NOT smuggled as a positional CLI arg or dropped.
    expect(starts).toEqual(['/projects/alpha']);
  });

  it('does NOT return a manageable handle (launch ≠ manage)', () => {
    const { supervisor } = makeStarterSpy();

    const result = launchDaemon('/projects/my-app', { supervisor });

    // start() here returns void → result is undefined. Even if a Promise<void>
    // is returned by a real async supervisor, it must NEVER expose process-control
    // surface (.kill/.on) — there is no retained ChildProcess.
    if (result !== undefined) {
      expect((result as Record<string, unknown>)['kill']).toBeUndefined();
      expect((result as Record<string, unknown>)['on']).toBeUndefined();
    }
  });

  it('propagates a start() failure rather than retaining a half-launched handle', () => {
    const supervisor: DaemonStarter = {
      start: vi.fn(() => {
        throw new Error('tmux is not installed');
      }),
    };

    // The error surfaces to the caller (engineer handoff swallows it); the helper
    // never holds a handle to a daemon it failed to start.
    expect(() => launchDaemon('/projects/my-app', { supervisor })).toThrow(/tmux/i);
  });
});

// ---------------------------------------------------------------------------
// "launch is not manage" — ADR-005 FR-8 non-management guarantees (PRESERVED).
//
// These assert that launchDaemon is a strict fire-and-forget boundary:
// the engineer launches a daemon but never supervises, stops, restarts, or
// retains a handle to it. ADR-014 changes the mechanism (tmux session, not a
// detached node spawn) but NOT these guarantees. The lifecycle verbs
// (stop/restart/connect/debug) live in the operator-only supervisor CLI, never
// in this engineer-facing module.
// ---------------------------------------------------------------------------
describe('launch is not manage (FR-8 — ADR-005 intent preserved under ADR-014)', () => {
  it('the injected seam is start-ONLY — no stop/kill/restart/attach reachable', () => {
    const { supervisor } = makeStarterSpy();

    // The DaemonStarter seam exposes only `start`. A test (or caller) cannot reach
    // a management method through it — the type and the runtime object agree.
    expect(typeof supervisor.start).toBe('function');
    expect((supervisor as Record<string, unknown>)['stop']).toBeUndefined();
    expect((supervisor as Record<string, unknown>)['restart']).toBeUndefined();
    expect((supervisor as Record<string, unknown>)['attach']).toBeUndefined();

    launchDaemon('/projects/alpha', { supervisor });
    expect(supervisor.start).toHaveBeenCalledOnce();
  });

  it('module exports no stop/kill/restart/configure/manage/supervise function', () => {
    const exportedKeys = Object.keys(daemonLaunchModule);
    const forbidden = [/stop/i, /kill/i, /restart/i, /configure/i, /manage/i, /supervise/i, /attach/i, /connect/i, /debug/i];

    for (const key of exportedKeys) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(key),
          `Unexpected management export "${key}" matches ${pattern}`,
        ).toBe(false);
      }
    }
    expect((daemonLaunchModule as Record<string, unknown>)['stopDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['restartDaemon']).toBeUndefined();
  });

  it('zero launches before the explicit call, exactly one after (no implicit launch)', () => {
    const { supervisor } = makeStarterSpy();

    // Importing the module + building the spy must not trigger any start.
    expect(supervisor.start).toHaveBeenCalledTimes(0);

    launchDaemon('/projects/alpha', { supervisor });
    expect(supervisor.start).toHaveBeenCalledTimes(1);

    // Nothing else launches implicitly — count stays exactly 1.
    expect(supervisor.start).toHaveBeenCalledTimes(1);
  });
});
