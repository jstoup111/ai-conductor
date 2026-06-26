// Test: detached fire-and-forget daemon launch (Task 27, FR-8)
//
// launchDaemonDetached(project, opts?) spawns a build daemon with
// { detached: true, stdio: 'ignore' } and immediately calls child.unref() so
// the parent process can exit independently. The function must NOT return the
// ChildProcess handle — it returns void (or at most a { pid } plain object).
//
// The spawn function is injectable via opts.spawn so the test can verify the
// exact spawn arguments without touching the real filesystem or process table.

import { describe, it, expect, vi } from 'vitest';
import {
  launchDaemonDetached,
} from '../../../src/engine/brain/daemon-launch.js';
import type { LaunchDaemonOpts } from '../../../src/engine/brain/daemon-launch.js';

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
