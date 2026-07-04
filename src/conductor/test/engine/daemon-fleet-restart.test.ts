// Tests for Task T32 — fleet restart with per-repo outcomes (FR-3/FR-17/FR-18).
// Exercises `runFleetAction` with restart verb against a REAL temp registry file,
// testing mixed outcomes: idle→restarted, busy→queued, stopped→started, missing→error.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeRegistry, type ProjectRecord } from '../../src/engine/registry.js';
import { runFleetAction } from '../../src/engine/daemon-fleet.js';
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

describe('runFleetAction for restart (Task T32)', () => {
  it('a named subset acts on exactly those repos — the third is untouched', async () => {
    const a = await repo('a');
    const b = await repo('b');
    const c = await repo('c');
    await writeRegistry(registryPath, [record('a', a), record('b', b), record('c', c)]);

    const touched: string[] = [];
    const out: string[] = [];
    const result = await runFleetAction(
      { names: ['a', 'b'] },
      async (rec) => {
        touched.push(rec.name);
        return 'restarted';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(touched.sort()).toEqual(['a', 'b']);
    expect(result.code).toBe(0);
    expect(out.some((l) => l.includes('c:'))).toBe(false);
  });

  it('--all iterates the registry, one outcome line per repo', async () => {
    const a = await repo('a');
    const b = await repo('b');
    await writeRegistry(registryPath, [record('a', a), record('b', b)]);

    const out: string[] = [];
    const result = await runFleetAction({ all: true }, async () => 'restarted', {
      registryPath,
      out: (l) => out.push(l),
    });

    expect(result.code).toBe(0);
    expect(result.outcomes).toHaveLength(2);
    expect(out).toHaveLength(2);
    expect(out.some((l) => l.startsWith('a:'))).toBe(true);
    expect(out.some((l) => l.startsWith('b:'))).toBe(true);
  });

  it('one repo with a broken path errors per-repo; the others still succeed', async () => {
    const a = await repo('a');
    const b = await repo('b');
    // Make `b`'s "path" a file, not a directory, so any fs op that expects a
    // dir under it throws — simulating a broken/missing-path registration.
    const brokenLeaf = join(root, 'b-is-a-file');
    await mkdir(root, { recursive: true });
    await writeFile(brokenLeaf, 'not a dir', 'utf-8');
    const broken = join(brokenLeaf, 'nested');
    await writeRegistry(registryPath, [record('a', a), record('b', broken)]);

    const out: string[] = [];
    const result = await runFleetAction(
      { all: true },
      async (rec) => {
        if (rec.name === 'b') {
          await mkdir(rec.path); // throws ENOTDIR — parent is a file
        }
        return 'ok';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(result.code).toBe(1);
    const aOutcome = result.outcomes.find((o) => o.name === 'a');
    const bOutcome = result.outcomes.find((o) => o.name === 'b');
    expect(aOutcome?.ok).toBe(true);
    expect(bOutcome?.ok).toBe(false);
    expect(out.some((l) => l.startsWith('a: ok'))).toBe(true);
    expect(out.some((l) => l.startsWith('b: error:'))).toBe(true);
  });

  it('an unknown name is reported verbatim; valid names in the same request are still acted on', async () => {
    const a = await repo('a');
    await writeRegistry(registryPath, [record('a', a)]);

    const touched: string[] = [];
    const out: string[] = [];
    const result = await runFleetAction(
      { names: ['a', 'ghost'] },
      async (rec) => {
        touched.push(rec.name);
        return 'restarted';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(touched).toEqual(['a']);
    expect(out).toContain('unknown repo: ghost');
    expect(result.unknownNames).toEqual(['ghost']);
    // A partially-unknown request still surfaces non-zero (an unknown name is
    // itself a failure to fully honor the request), even though `a` succeeded.
    expect(result.code).toBe(1);
  });

  it('all names unknown → non-zero, zero side effects', async () => {
    const a = await repo('a');
    await writeRegistry(registryPath, [record('a', a)]);

    const touched: string[] = [];
    const result = await runFleetAction(
      { names: ['ghost1', 'ghost2'] },
      async (rec) => {
        touched.push(rec.name);
        return 'restarted';
      },
      { registryPath, out: () => {} },
    );

    expect(touched).toEqual([]);
    expect(result.code).not.toBe(0);
    expect(result.outcomes).toEqual([]);
  });

  it('empty registry + --all → "no registered repos", exit 0', async () => {
    await writeRegistry(registryPath, []);

    const out: string[] = [];
    const touched: string[] = [];
    const result = await runFleetAction(
      { all: true },
      async (rec) => {
        touched.push(rec.name);
        return 'restarted';
      },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(result.code).toBe(0);
    expect(touched).toEqual([]);
    expect(out).toEqual(['no registered repos']);
  });
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
