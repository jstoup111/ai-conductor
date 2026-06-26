import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the NOT-YET-BUILT daemon-lock module (Phase 9.3
// redesign, FR-17/18/19/20, ADR-010, condition C3).
//
// `src/engine/daemon-lock.ts` does not exist yet. Following the 9.1/9.2/9.3
// convention, every test dynamically imports the symbol it needs INSIDE the
// test body, so a missing module/export surfaces as THAT test's own RED failure
// rather than a whole-file collection crash that masks which behavior is
// unimplemented.
//
// Contract the implementation must satisfy (defined by these specs, not code):
//
//   acquire(repoPath): Promise<AcquireResult>
//     - fresh `.daemon/` (creating the dir if absent) → writes
//       `.daemon/daemon.pid` with `{ pid, uuid, startedAt }` via O_EXCL and
//       reports success (the caller is the owner).
//     - a live-owner pidfile already present → no-op; reports the existing
//       owner, NEVER overwrites the winner's pidfile. (FR-17, FR-20)
//   isLive(pid): boolean
//     - process.kill(pid, 0) succeeds → alive; ESRCH → dead; EPERM → alive
//       (conservative — never reclaim a lock we can't prove is dead). (FR-18)
//   reclaim(repoPath): Promise<AcquireResult>
//     - stale pidfile (dead pid) → atomically replaces it; a fresh owner is
//       established. Repeated crash→reclaim always recovers (never permanently
//       refused). (FR-19)
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_MOD = '../../src/engine/daemon-lock.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  // Throws (RED) if the module does not exist yet — the intended pre-impl failure.
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
  repoPath = await mkdtemp(join(tmpdir(), 'daemon-lock-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

async function readPidfile(): Promise<Record<string, unknown>> {
  const raw = await readFile(join(repoPath, '.daemon', 'daemon.pid'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Pick a pid that is overwhelmingly unlikely to exist (for the dead-pid path). */
function deadPid(): number {
  return 2_147_480_000;
}

// ═════════════════════════════════════════════════════════════════════════════
// FR-17 / FR-20: O_EXCL acquire is the 1-per-repo mutex.
// ═════════════════════════════════════════════════════════════════════════════
describe('daemon-lock: acquire is the O_EXCL 1-per-repo mutex (FR-17/FR-20)', () => {
  it('fresh .daemon/ → creates daemon.pid with {pid,uuid,startedAt} and owns the repo', async () => {
    const acquire = requireFn(await load(LOCK_MOD), 'acquire');

    const result = await acquire(repoPath);

    // The pidfile is created under repoPath/.daemon/ (dir created if absent).
    await access(join(repoPath, '.daemon', 'daemon.pid'));
    const record = await readPidfile();
    expect(typeof record.pid).toBe('number');
    expect(typeof record.uuid).toBe('string');
    expect(String(record.uuid).length).toBeGreaterThan(0);
    expect(typeof record.startedAt).toBe('string');
    // The caller is reported as the owner/acquirer.
    expect(result.acquired ?? result.owner === 'self' ?? true).toBeTruthy();
  });

  it('two concurrent acquire() → exactly one succeeds; loser no-ops (acquisition count === 1)', async () => {
    const acquire = requireFn(await load(LOCK_MOD), 'acquire');

    const [a, b] = await Promise.all([acquire(repoPath), acquire(repoPath)]);

    const acquiredFlag = (r: any): boolean =>
      r.acquired === true || r.owner === 'self' || r.won === true;
    const successes = [a, b].filter(acquiredFlag).length;
    expect(successes).toBe(1); // exactly one winner under the race
  });

  it("loser does NOT mutate the winner's daemon.pid (pidfile bytes unchanged)", async () => {
    const acquire = requireFn(await load(LOCK_MOD), 'acquire');

    await acquire(repoPath); // winner writes the pidfile
    const winnerBytes = await readFile(join(repoPath, '.daemon', 'daemon.pid'), 'utf8');

    // A second acquire while the winner's pid is still live must be a no-op.
    await acquire(repoPath);
    const afterBytes = await readFile(join(repoPath, '.daemon', 'daemon.pid'), 'utf8');

    expect(afterBytes).toBe(winnerBytes); // loser never overwrites the winner
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-18: liveness via process.kill(pid, 0). ESRCH → dead; EPERM → alive.
// ═════════════════════════════════════════════════════════════════════════════
describe('daemon-lock: isLive via process.kill(pid,0) (FR-18)', () => {
  it('the current process pid is alive', async () => {
    const isLive = requireFn(await load(LOCK_MOD), 'isLive');
    expect(isLive(process.pid)).toBe(true);
  });

  it('a non-existent pid (ESRCH) is dead', async () => {
    const isLive = requireFn(await load(LOCK_MOD), 'isLive');
    expect(isLive(deadPid())).toBe(false);
  });

  it('EPERM is treated as alive (no false reclaim) — injected kill probe', async () => {
    const mod = await load(LOCK_MOD);
    const isLive = requireFn(mod, 'isLive');
    // The implementation must accept an injectable kill probe so EPERM is
    // exercisable deterministically (real EPERM pids are environment-specific).
    const esrch = () => {
      const e: NodeJS.ErrnoException = new Error('no such process');
      e.code = 'ESRCH';
      throw e;
    };
    const eperm = () => {
      const e: NodeJS.ErrnoException = new Error('operation not permitted');
      e.code = 'EPERM';
      throw e;
    };
    expect(isLive(deadPid(), esrch)).toBe(false); // ESRCH → dead
    expect(isLive(deadPid(), eperm)).toBe(true); // EPERM → conservatively alive
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-19: stale pidfile (dead pid) → reclaim replaces it; recovery is unbounded.
// ═════════════════════════════════════════════════════════════════════════════
describe('daemon-lock: stale-pidfile reclaim + recovery (FR-19)', () => {
  it('a stale (dead-pid) pidfile is reclaimed and a fresh owner is established', async () => {
    const mod = await load(LOCK_MOD);
    const reclaim = requireFn(mod, 'reclaim');

    // Seed a stale pidfile pointing at a dead pid.
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: deadPid(), uuid: 'stale-uuid', startedAt: '2020-01-01T00:00:00.000Z' }),
    );

    const result = await reclaim(repoPath);
    const record = await readPidfile();

    // The dead pid was replaced by a fresh owner (different pid + uuid).
    expect(record.pid).not.toBe(deadPid());
    expect(record.uuid).not.toBe('stale-uuid');
    expect((result as any).reclaimed ?? (result as any).acquired ?? true).toBeTruthy();
  });

  it('repeated crash→reclaim always recovers (never permanently refused)', async () => {
    const mod = await load(LOCK_MOD);
    const reclaim = requireFn(mod, 'reclaim');

    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    for (let i = 0; i < 3; i++) {
      // Simulate a crash leaving a stale pidfile each time.
      await writeFile(
        join(repoPath, '.daemon', 'daemon.pid'),
        JSON.stringify({ pid: deadPid(), uuid: `stale-${i}`, startedAt: '2020-01-01T00:00:00.000Z' }),
      );
      const result = await reclaim(repoPath);
      expect((result as any).reclaimed ?? (result as any).acquired ?? true).toBeTruthy();
      const record = await readPidfile();
      expect(record.pid).not.toBe(deadPid()); // recovered, not stuck
    }
  });
});
