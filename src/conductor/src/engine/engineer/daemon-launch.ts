// daemon-launch.ts — Fire-and-forget daemon spawn helper (FR-8, Task 27).
//
// launchDaemonDetached spawns a build daemon process completely detached from
// the parent. The parent retains NO handle, IPC channel, or supervision over
// the child after this call returns.
//
// Design decisions:
//   - detached:true + stdio:'ignore' — child lives in its own session; the
//     parent's file descriptors are not inherited, preventing fd leaks.
//   - child.unref() — allows the parent Node process to exit without waiting
//     for the child, making this a true fire-and-forget.
//   - spawn is injectable via opts.spawn — avoids module-mock fragility;
//     tests pass a spy; production falls back to node's child_process.spawn.
//   - Return type is void — the caller receives no handle. Returning the
//     ChildProcess object would be a contract violation (launch ≠ manage).

import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';

/** Minimal spawn function type — matches child_process.spawn's signature. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => { pid?: number; unref: () => void };

/** Options accepted by launchDaemonDetached. */
export interface LaunchDaemonOpts {
  /**
   * Injectable spawn function. Defaults to node's child_process.spawn.
   * Provide a test spy here to avoid spawning real child processes in tests.
   */
  spawn?: SpawnFn;
  /** Arguments passed to the daemon command. Defaults to []. */
  args?: string[];
  /** Command to run. Defaults to 'npx' with conduct-ts daemon sub-command. */
  command?: string;
}

/**
 * Launch a build daemon as a fully detached child process.
 *
 * The function spawns `command` (default: npx conduct-ts daemon) with
 * `{ detached: true, stdio: 'ignore' }` and immediately calls `child.unref()`
 * so the parent can exit independently. No process handle is retained or
 * returned — this is a strict fire-and-forget boundary.
 *
 * @param project - Absolute path to the project root (passed as env/arg).
 * @param opts    - Optional overrides for command, args, and spawn injection.
 * @returns void  — intentionally returns nothing; no handle is retained.
 */
export function launchDaemonDetached(
  project: string,
  opts: LaunchDaemonOpts = {},
): void {
  const spawnFn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const command = opts.command ?? 'npx';
  const args = opts.args ?? ['conduct', 'daemon'];

  const child = spawnFn(command, args, {
    cwd: project,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  // Return nothing — caller must not receive any process handle.
}
