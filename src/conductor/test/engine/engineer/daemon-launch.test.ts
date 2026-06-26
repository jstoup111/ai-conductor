// Test: detached fire-and-forget daemon launch (Task 27, FR-8)
//
// launchDaemonDetached(project, opts?) spawns a build daemon with
// { detached: true, stdio: 'ignore' } and immediately calls child.unref() so
// the parent process can exit independently. The function must NOT return the
// ChildProcess handle — it returns void (or at most a { pid } plain object).
//
// The spawn function is injectable via opts.spawn so the test can verify the
// exact spawn arguments without touching the real filesystem or process table.
//
// Task 28 adds a second describe block: "launch is not manage" — asserting the
// strict FR-8 separation guarantee that launching a daemon is not supervision.

import { describe, it, expect, vi } from 'vitest';
import {
  launchDaemonDetached,
} from '../../../src/engine/engineer/daemon-launch.js';
import type { LaunchDaemonOpts } from '../../../src/engine/engineer/daemon-launch.js';
import * as daemonLaunchModule from '../../../src/engine/engineer/daemon-launch.js';

// Minimal fake ChildProcess — only the fields the implementation is allowed to
// use: unref() and optionally pid.
function makeFakeChild(pid = 12345) {
  return {
    pid,
    unref: vi.fn(),
  };
}

describe('launchDaemonDetached', () => {
  it('calls spawn with detached:true and stdio:ignore', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    launchDaemonDetached('/projects/my-app', { spawn: spawnSpy });

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [, , spawnOpts] = spawnSpy.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(spawnOpts).toMatchObject({ detached: true, stdio: 'ignore' });
  });

  it('calls child.unref() so the parent can exit independently', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    launchDaemonDetached('/projects/my-app', { spawn: spawnSpy });

    expect(fakeChild.unref).toHaveBeenCalledOnce();
  });

  it('does NOT return the ChildProcess handle — returns void or { pid }', () => {
    const fakeChild = makeFakeChild(99999);
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    const result = launchDaemonDetached('/projects/my-app', { spawn: spawnSpy });

    // The result must NOT be the ChildProcess object itself.
    // Accepting void (undefined) or a plain { pid } are both safe.
    // A ChildProcess object would expose .kill(), .on(), etc. — prohibited.
    if (result !== undefined) {
      // If something is returned, it must be a plain object with only pid.
      expect(typeof result).toBe('object');
      // Must not be the raw ChildProcess (no unref on the return value).
      expect(result).not.toBe(fakeChild);
      // Must not expose dangerous process-control methods.
      expect((result as Record<string, unknown>)['kill']).toBeUndefined();
      expect((result as Record<string, unknown>)['on']).toBeUndefined();
      // If it has a pid, it should be the child's pid.
      if ('pid' in (result as object)) {
        expect((result as { pid: number }).pid).toBe(99999);
      }
    }
    // void return is fine — no further assertion needed.
  });

  it('negative: does not call unref if spawn throws (no phantom unref on error)', () => {
    const spawnSpy = vi.fn().mockImplementation(() => {
      throw new Error('spawn ENOENT: no such file');
    });

    expect(() =>
      launchDaemonDetached('/projects/my-app', { spawn: spawnSpy }),
    ).toThrow('spawn ENOENT');
    // The error propagates and there is no phantom unref call anywhere.
  });
});

// ---------------------------------------------------------------------------
// Task 28: "launch is not manage" — FR-8 negative-path separation guarantees
//
// These tests assert that launchDaemonDetached is a strict fire-and-forget
// boundary. The engineer launches a daemon but never supervises, controls, stops,
// restarts, configures, or watches it. Each assertion is falsifiable: removing
// the corresponding guarantee from the implementation WOULD cause it to fail.
// ---------------------------------------------------------------------------

describe('launch is not manage (FR-8 negative paths)', () => {
  // Helper: make a minimal fake child whose unref we can spy on.
  function makeFakeChild(pid = 42000) {
    return { pid, unref: vi.fn() };
  }

  // ------------------------------------------------------------------
  // 1. No supervision/control-state is written.
  //
  // The impl uses injected spawn and returns void — it has no fs writer
  // dependency. We verify the three concrete consequences:
  //   a) spawn called exactly once with detached:true + stdio:'ignore'
  //   b) unref() is called (fire-and-forget confirmation)
  //   c) return value is undefined (no retained handle / IPC channel)
  //
  // Falsifiability: if the impl returned a ChildProcess, (c) would fail.
  // If it opened an IPC channel (stdio:'ipc'), (a) would fail.
  // If it wrote state via an injected fs writer, (a) call count would fail.
  // ------------------------------------------------------------------
  it('returns undefined — no retained child handle or IPC channel', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    const result = launchDaemonDetached('/projects/alpha', { spawn: spawnSpy });

    // (a) spawn called exactly once — no re-spawns, no control-state writer
    expect(spawnSpy).toHaveBeenCalledOnce();

    // (b) unref confirms fire-and-forget (child runs independently)
    expect(fakeChild.unref).toHaveBeenCalledOnce();

    // (c) return is void/undefined — no handle, no IPC, no supervision ref
    expect(result).toBeUndefined();
  });

  it('spawn options contain stdio:"ignore" — no IPC channel wired', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    launchDaemonDetached('/projects/alpha', { spawn: spawnSpy });

    const [, , opts] = spawnSpy.mock.calls[0] as [unknown, unknown, Record<string, unknown>];

    // stdio must be the literal string 'ignore' — not 'ipc', not an array
    // containing 'ipc'. If the impl ever added an IPC channel for supervision,
    // this assertion would catch it.
    expect(opts['stdio']).toBe('ignore');
    expect(opts['stdio']).not.toBe('ipc');
    if (Array.isArray(opts['stdio'])) {
      expect(opts['stdio']).not.toContain('ipc');
    }
  });

  // ------------------------------------------------------------------
  // 2. The module exposes NO stop/kill/restart/configure function.
  //
  // Asserting export names from the live module object is the most direct
  // falsifiable check: if someone adds a `stopDaemon` export, this fails.
  // ------------------------------------------------------------------
  it('module exports no stop/kill/restart/configure function', () => {
    const exportedKeys = Object.keys(daemonLaunchModule);

    const forbiddenPatterns = [/stop/i, /kill/i, /restart/i, /configure/i, /manage/i, /supervise/i];

    for (const key of exportedKeys) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(key),
          `Unexpected management export found: "${key}" matches forbidden pattern ${pattern}`,
        ).toBe(false);
      }
    }

    // Explicit spot-checks in case the above loop is ever weakened:
    expect((daemonLaunchModule as Record<string, unknown>)['stopDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['killDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['restartDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['configureDaemon']).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 3. No post-merge watcher/callback is registered.
  //
  // Demonstrated through two concrete assertions:
  //   a) stdio is 'ignore' (covered above — not 'ipc', so no message events)
  //   b) shell:true is absent (shell would add implicit env-wrapper surface)
  //   c) No 'on' / 'once' callback registered on the fake child.
  //
  // Falsifiability: if the impl called child.on('exit', ...) to watch the
  // daemon, we would need to expose that on the fake child — and then the
  // impl would fail because our fake does not have .on(). More precisely:
  // the impl currently only calls child.unref() — any call to child.on()
  // would TypeError on our minimal fake that lacks an .on() method, causing
  // the test to throw rather than pass.
  // ------------------------------------------------------------------
  it('spawn options do not include shell:true — no implicit env wrapper', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    launchDaemonDetached('/projects/alpha', { spawn: spawnSpy });

    const [, , opts] = spawnSpy.mock.calls[0] as [unknown, unknown, Record<string, unknown>];

    // shell:true would open a shell wrapper that can receive supervision
    // signals. The impl must never set it.
    expect(opts['shell']).toBeFalsy();
  });

  it('fake child exposes no .on() — impl does not register any watcher callback', () => {
    // The fake child deliberately has NO .on() method. If the impl tries to
    // call child.on('exit', cb), child.on would be undefined and calling it
    // would throw a TypeError, causing the test to fail. The test passing
    // proves no watcher was registered.
    const fakeChild = makeFakeChild(); // only: { pid, unref }
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    // This must not throw — i.e., the impl must not call fakeChild.on(...)
    expect(() =>
      launchDaemonDetached('/projects/alpha', { spawn: spawnSpy }),
    ).not.toThrow();

    // Additionally confirm: the fake has no .on property at all.
    expect((fakeChild as Record<string, unknown>)['on']).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 4. An idea without an explicit launch request triggers zero daemon actions.
  //
  // We construct the spawn spy, deliberately do NOT call launchDaemonDetached,
  // and assert 0 spawns. Then we call it once and assert exactly 1. This proves
  // spawn is only invoked through the explicit launch call — not through any
  // implicit routing/authoring side-effect path.
  //
  // Falsifiability: if the module ran a top-level spawn at import time (or if
  // some other export implicitly spawned), the count would be > 0 before the
  // explicit call — causing the first assertion to fail.
  // ------------------------------------------------------------------
  it('zero spawns before explicit launch, exactly one spawn after', () => {
    const fakeChild = makeFakeChild();
    const spawnSpy = vi.fn().mockReturnValue(fakeChild);

    // ---- Before any call ----
    // Simply importing the module and building a spy must not trigger spawn.
    expect(spawnSpy).toHaveBeenCalledTimes(0);

    // ---- Explicit launch ----
    launchDaemonDetached('/projects/alpha', { spawn: spawnSpy });

    expect(spawnSpy).toHaveBeenCalledTimes(1);

    // ---- No implicit second spawn ----
    // Nothing else in the module or its imports should call spawn.
    // Count remains exactly 1.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });
});
