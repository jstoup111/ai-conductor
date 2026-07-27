// Tests for Task T32 — fleet restart with per-repo outcomes (FR-3/FR-17/FR-18).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeRegistry, type ProjectRecord } from '../../src/engine/registry.js';
import { dispatchDaemonSupervisor } from '../../src/engine/daemon-supervisor-cli.js';
import { writeRestartPending, consumeOnBoot } from '../../src/engine/restart-marker.js';
import { isPaused } from '../../src/engine/pause-marker.js';

let root: string;
let registryPath: string;

async function repo(name: string): Promise<string> {
  const p = join(root, name);
  await mkdir(p, { recursive: true });
  return p;
}

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'daemon-fleet-restart-'));
  registryPath = join(root, 'registry.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('restart verb dispatch through the fleet selector (FR-3/FR-17/FR-18, Task T32)', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'daemon-cli-restart-'));
    tempDirs.push(dir);
    return dir;
  }

  it('`restart` with named repos restarts exactly those, leaving a third repo untouched', async () => {
    const a = await tempRepo();
    const b = await tempRepo();
    const c = await tempRepo();
    await writeRegistry(registryPath, [record('a', a), record('b', b), record('c', c)]);

    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', names: ['a', 'b'] },
      {
        registryPath,
        out: (l) => out.push(l),
        supervisor: {
          restart: async (repo: string) => {
            // Track which repos were restarted
            return { degraded: false, message: `daemon restarted (${repo})` };
          },
          isUp: async () => true,
          hasSession: async () => false,
          start: async () => {},
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    expect(out.some((l) => l.includes('a:'))).toBe(true);
    expect(out.some((l) => l.includes('b:'))).toBe(true);
    expect(out.some((l) => l.includes('c:'))).toBe(false);
  });

  it('`restart --all` restarts every registered repo', async () => {
    const a = await tempRepo();
    const b = await tempRepo();
    await writeRegistry(registryPath, [record('a', a), record('b', b)]);

    const restartCalls: string[] = [];
    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', all: true },
      {
        registryPath,
        out: (l) => out.push(l),
        supervisor: {
          restart: async (repo: string) => {
            restartCalls.push(repo);
            return { degraded: false, message: 'daemon restarted' };
          },
          isUp: async () => true,
          hasSession: async () => false,
          start: async () => {},
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    expect(restartCalls).toHaveLength(2);
    expect(out).toHaveLength(2);
  });

  it('idle repo → immediate respawn with "restarted" outcome', async () => {
    const a = await tempRepo();
    await writeRegistry(registryPath, [record('a', a)]);

    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', names: ['a'] },
      {
        registryPath,
        out: (l) => out.push(l),
        isBusy: async () => ({ busy: false }),
        supervisor: {
          restart: async () => ({ degraded: false, message: 'daemon restarted in place' }),
          isUp: async () => true,
          hasSession: async () => false,
          start: async () => {},
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    expect(out[0]).toMatch(/a:.*restarted/i);
  });

  it('busy repo → queue restart with "restart queued" outcome', async () => {
    const a = await tempRepo();
    await writeRegistry(registryPath, [record('a', a)]);

    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', names: ['a'] },
      {
        registryPath,
        out: (l) => out.push(l),
        isBusy: async () => ({ busy: true, blockingSlug: 'feature-x' }),
        supervisor: {
          restart: async () => ({ degraded: false, message: 'restarted' }),
          isUp: async () => true,
          hasSession: async () => false,
          start: async () => {},
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    expect(out[0]).toMatch(/a:.*restart queued/i);
    // Verify marker was written
    const intent = await consumeOnBoot(a);
    expect(intent).not.toBeNull();
    expect(intent?.blockingSlug).toBe('feature-x');
  });

  it('stopped repo (no session) → start daemon with "started" outcome', async () => {
    const a = await tempRepo();
    await writeRegistry(registryPath, [record('a', a)]);

    const startCalls: string[] = [];
    const restartCalls: string[] = [];
    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', names: ['a'] },
      {
        registryPath,
        out: (l) => out.push(l),
        isBusy: async () => ({ busy: false }),
        supervisor: {
          restart: async (repo: string) => {
            restartCalls.push(repo);
            // Simulate "no session" error
            throw new Error('No daemon session found');
          },
          isUp: async () => false,
          hasSession: async () => false,
          start: async (repo: string) => {
            startCalls.push(repo);
          },
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    expect(startCalls).toEqual([a]);
    expect(out[0]).toMatch(/a:.*started/i);
  });

  it('mixed outcomes: idle→restarted, busy→queued, stopped→started, error→error', async () => {
    const idle = await tempRepo();
    const busy = await tempRepo();
    const stopped = await tempRepo();
    const broken = await tempRepo();
    const brokenPath = join(stopped, 'nested', 'doesnotexist');
    await writeRegistry(registryPath, [
      record('idle', idle),
      record('busy', busy),
      record('stopped', stopped),
      record('broken', brokenPath),
    ]);

    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', all: true },
      {
        registryPath,
        out: (l) => out.push(l),
        isBusy: async (cwd: string) => {
          return { busy: cwd === busy };
        },
        supervisor: {
          restart: async (repo: string) => {
            if (repo === stopped) {
              throw new Error('No daemon session found');
            }
            if (repo === brokenPath) {
              throw new Error('ENOTDIR: not a directory');
            }
            return { degraded: false, message: 'daemon restarted in place' };
          },
          isUp: async () => true,
          hasSession: async () => false,
          start: async (repo: string) => {
            if (repo === brokenPath) {
              throw new Error('ENOTDIR: not a directory');
            }
          },
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(1); // partial failure (broken repo failed)
    expect(out.some((l) => l.match(/idle:.*restarted/i))).toBe(true);
    expect(out.some((l) => l.match(/busy:.*restart queued/i))).toBe(true);
    expect(out.some((l) => l.match(/stopped:.*started/i))).toBe(true);
    expect(out.some((l) => l.match(/broken:.*error/i))).toBe(true);

    // Verify queued restart was written for busy repo
    const intent = await consumeOnBoot(busy);
    expect(intent).not.toBeNull();
  });

  it('paused repo → immediate respawn (paused counts as idle); pause marker untouched', async () => {
    const a = await tempRepo();
    await writeRegistry(registryPath, [record('a', a)]);

    // Write pause marker
    const { writePauseMarker } = await import('../../src/engine/pause-marker.js');
    await writePauseMarker(a, { pausedBy: 'test' });

    const out: string[] = [];
    let isBusyCalled = false;
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', names: ['a'] },
      {
        registryPath,
        out: (l) => out.push(l),
        isBusy: async () => {
          isBusyCalled = true;
          return { busy: true, blockingSlug: 'should-not-be-used' };
        },
        supervisor: {
          restart: async () => ({ degraded: false, message: 'daemon restarted in place' }),
          isUp: async () => true,
          hasSession: async () => false,
          start: async () => {},
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(0);
    // isBusy should NOT have been called (paused counts as idle)
    expect(isBusyCalled).toBe(false);
    // Pause marker should still be present
    expect(await isPaused(a)).toBe(true);
    expect(out[0]).toMatch(/a:.*restarted/i);
  });

  it('all repos processed even when some fail (no early abort)', async () => {
    const a = await tempRepo();
    const b = await tempRepo();
    const c = await tempRepo();
    await writeRegistry(registryPath, [record('a', a), record('b', b), record('c', c)]);

    const attempted: string[] = [];
    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'restart', all: true },
      {
        registryPath,
        out: (l) => out.push(l),
        supervisor: {
          restart: async (repo: string) => {
            attempted.push(repo);
            if (repo === b) {
              throw new Error('permission denied');
            }
            return { degraded: false, message: 'restarted' };
          },
          isUp: async () => true,
          hasSession: async () => false,
          start: async (repo: string) => {
            // start also fails for repo b so it remains a per-repo error
            if (repo === b) {
              throw new Error('permission denied on start');
            }
          },
          stop: async () => {},
          attach: async () => {},
          logs: async () => '',
          exec: async () => {},
        },
      },
    );

    expect(code).toBe(1); // partial failure
    expect(attempted).toHaveLength(3); // all three were attempted
    expect(out).toHaveLength(3); // one line per repo
    expect(out.some((l) => l.match(/b:.*error/i))).toBe(true);
  });
});
