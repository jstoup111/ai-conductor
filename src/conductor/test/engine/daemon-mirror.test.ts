import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NON-AUTHORITATIVE registry daemonState mirror
// (Phase 9.3 redesign, FR-23, ADR-010, condition C4).
//
// The pidfile (`.daemon/daemon.pid`) is the SINGLE source of truth for liveness.
// The registry `daemonState` field is a DERIVED mirror for governor reporting
// only — the control path must NEVER read it for a liveness decision.
//
// Contract (defined by these specs, on the not-yet-built daemon-lock module):
//   ensureRunning(repoPath, opts) — when the registry says "running" but the
//     pidfile shows a dead pid, the decision trusts the PIDFILE (spawns/reclaims)
//     and ignores `daemonState`.
//   A registry-write failure while mirroring is NON-FATAL to the loop.
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_MOD = '../../src/engine/daemon-lock.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'daemon-mirror-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

function deadPid(): number {
  return 2_147_480_000;
}

async function writePidfile(record: Record<string, unknown>): Promise<void> {
  await mkdir(join(repoPath, '.daemon'), { recursive: true });
  await writeFile(join(repoPath, '.daemon', 'daemon.pid'), JSON.stringify(record));
}

function makeProbe() {
  const launches: string[] = [];
  return {
    launches,
    launch: (target: string) => launches.push(target),
  };
}

describe('daemon mirror: pidfile is authoritative; daemonState is derived-only (FR-23, C4)', () => {
  it('registry says "running" but pidfile pid is DEAD → ensureRunning trusts the pidfile (spawns/reclaims)', async () => {
    const ensureRunning = requireFn(await load(LOCK_MOD), 'ensureRunning');
    const probe = makeProbe();

    // The registry mirror claims the daemon is up …
    const registryDaemonState: Record<string, string> = { [repoPath]: 'running' };
    // … but the authoritative pidfile points at a dead pid.
    await writePidfile({ pid: deadPid(), uuid: 'stale', startedAt: '2020-01-01T00:00:00.000Z' });

    let reclaims = 0;
    await ensureRunning(repoPath, {
      launch: probe.launch,
      onReclaim: () => {
        reclaims++;
      },
      // An injected registry view — the implementation MUST NOT consult it for
      // the liveness decision. If it does (trusting "running"), it would NOT
      // spawn, and this assertion fails.
      registryDaemonState,
    });

    // Pidfile (dead) wins → the daemon is treated as down → spawn/reclaim happens.
    expect(probe.launches.length + reclaims).toBeGreaterThan(0);
  });

  it('a registry mirror-write failure is NON-FATAL to ensureRunning', async () => {
    const ensureRunning = requireFn(await load(LOCK_MOD), 'ensureRunning');
    const probe = makeProbe();

    // No pidfile → a fresh spawn; the mirror write is attempted and fails hard.
    const failingMirror = async () => {
      throw new Error('EROFS: read-only registry');
    };

    // The loop must complete despite the mirror write throwing.
    await expect(
      ensureRunning(repoPath, { launch: probe.launch, writeDaemonState: failingMirror }),
    ).resolves.not.toThrow();

    expect(probe.launches).toHaveLength(1); // the launch decision was unaffected
  });
});
