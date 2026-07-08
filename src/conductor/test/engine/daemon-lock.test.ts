import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile, access, unlink } from 'fs/promises';
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

// ═════════════════════════════════════════════════════════════════════════════
// FR-19 (correctness): corrupt pidfile must NEVER permanently block reclaim.
//
// A pidfile whose pid field is non-numeric (e.g. written by a buggy tool) or
// whose JSON is truncated/invalid must be treated as absent — i.e. reclaim()
// must succeed (reclaimed===true) rather than returning a false "alive" signal
// that permanently bars every future daemon for that repo.
// ═════════════════════════════════════════════════════════════════════════════
describe('daemon-lock: corrupt pidfile is reclaimable, never permanently refused (FR-19)', () => {
  it('pidfile with non-numeric pid string → reclaim() recovers (reclaimed===true)', async () => {
    const mod = await load(LOCK_MOD);
    const reclaim = requireFn(mod, 'reclaim');

    // Seed a pidfile whose pid is a string, not a number.
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: 'notanumber', uuid: 'bad-uuid', startedAt: '2020-01-01T00:00:00.000Z' }),
    );

    const result = await reclaim(repoPath);

    // Must recover — the corrupt pidfile is treated as absent (stale).
    expect((result as any).reclaimed).toBe(true);
    // The fresh pidfile must contain a valid numeric pid.
    const record = await readPidfile();
    expect(typeof record.pid).toBe('number');
    expect((record.pid as number)).toBeGreaterThan(0);
  });

  it('pidfile with truncated / invalid JSON → reclaim() recovers (reclaimed===true)', async () => {
    const mod = await load(LOCK_MOD);
    const reclaim = requireFn(mod, 'reclaim');

    // Seed a truncated JSON pidfile.
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      '{"pid":12345,"uuid":"x","star', // truncated — invalid JSON
    );

    const result = await reclaim(repoPath);

    // Must recover — parse failure is treated as absent (stale).
    expect((result as any).reclaimed).toBe(true);
    const record = await readPidfile();
    expect(typeof record.pid).toBe('number');
    expect((record.pid as number)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// holdLock — the running daemon's own lifetime lock (ADR-010 liveness wiring).
// This is what `runDaemonMode` calls on boot; without it the pidfile was never
// written, so liveness was unobservable and the 1-per-repo mutex never engaged.
// ─────────────────────────────────────────────────────────────────────────────
describe('daemon-lock: holdLock — daemon lifetime lock (ADR-010)', () => {
  const pidfile = (): string => join(repoPath, '.daemon', 'daemon.pid');

  it('fresh repo → owns the lock, writes OUR pid; release() unlinks the pidfile', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    const handle = await holdLock(repoPath);
    expect(handle).not.toBeNull();
    expect(handle.owned).toBe(true);
    expect(handle.pid).toBe(process.pid);

    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec.pid).toBe(process.pid);

    await handle.release();
    await expect(access(pidfile())).rejects.toThrow(); // pidfile gone
  });

  it('a LIVE owner already holds the lock → returns null (1-per-repo), pidfile untouched', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    // Seed a pidfile owned by THIS process — guaranteed alive.
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    const seeded = { pid: process.pid, uuid: 'live-owner', startedAt: new Date().toISOString() };
    await writeFile(pidfile(), JSON.stringify(seeded));

    const handle = await holdLock(repoPath);
    expect(handle).toBeNull();

    // The live owner's pidfile must be left byte-for-byte intact.
    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec).toEqual(seeded);
  });

  it('a STALE (dead-pid) pidfile → reclaims and owns the lock with our pid', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    // A pid that is (almost certainly) not running → isLive → ESRCH → reclaimable.
    await writeFile(
      pidfile(),
      JSON.stringify({ pid: 2147483646, uuid: 'dead', startedAt: new Date(0).toISOString() }),
    );

    const handle = await holdLock(repoPath);
    expect(handle).not.toBeNull();
    expect(handle.owned).toBe(true);

    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec.pid).toBe(process.pid); // reclaimed with our pid

    handle.releaseSync();
    await expect(access(pidfile())).rejects.toThrow();
  });

  it('a LIVE owner releases the lock during bounded-wait → acquires (holdLock bounded-wait happy path)', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    // Seed a pidfile owned by THIS process (guaranteed live).
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    const seeded = { pid: process.pid, uuid: 'live-owner', startedAt: new Date().toISOString() };
    await writeFile(pidfile(), JSON.stringify(seeded));

    // On a timer shorter than the wait window, release the pidfile.
    const releaseTimer = setTimeout(async () => {
      try {
        await unlink(pidfile());
      } catch {
        // Already gone — fine.
      }
    }, 200);

    // holdLock with bounded-wait options: poll every 25ms, wait up to 500ms.
    const handle = await holdLock(repoPath, { takeoverWaitMs: 500, pollMs: 25 });

    clearTimeout(releaseTimer);

    // Should have acquired the lock after waiting for it to be released.
    expect(handle).not.toBeNull();
    expect(handle?.owned).toBe(true);
    expect(handle?.pid).toBe(process.pid);

    // Pidfile should now contain our pid.
    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec.pid).toBe(process.pid);

    await handle?.release();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Task 12: holdLock negative paths — persistent holder + race (RED/GREEN)
  // ═════════════════════════════════════════════════════════════════════════════

  it('live holder NEVER releases → holdLock resolves null after injected window (no throw, no infinite wait)', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    // Seed a pidfile owned by THIS process (guaranteed live, never unlinked).
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    const seeded = { pid: process.pid, uuid: 'persistent-holder', startedAt: new Date().toISOString() };
    await writeFile(pidfile(), JSON.stringify(seeded));

    // holdLock with bounded-wait: poll every 25ms, wait up to 300ms.
    // The pidfile is never released, so the loop expires and returns null.
    const startTime = Date.now();
    const handle = await holdLock(repoPath, { takeoverWaitMs: 300, pollMs: 25 });
    const elapsedMs = Date.now() - startTime;

    // Assert: returns null (1-per-repo, not acquired) and elapsed >= window.
    expect(handle).toBeNull();
    expect(elapsedMs).toBeGreaterThanOrEqual(300);
    // Allow some margin for timing variation, but ensure we didn't exit early.
    expect(elapsedMs).toBeLessThan(400); // sanity check: not wildly over
  });

  it('two concurrent holdLock calls racing a just-released pidfile → exactly one handle, one null (O_EXCL single-winner)', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    // Seed a pidfile owned by THIS process (guaranteed live).
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    const seeded = { pid: process.pid, uuid: 'racer-holder', startedAt: new Date().toISOString() };
    await writeFile(pidfile(), JSON.stringify(seeded));

    // On a timer, release the pidfile.
    const releaseTimer = setTimeout(async () => {
      try {
        await unlink(pidfile());
      } catch {
        // Already gone — fine.
      }
    }, 150);

    // Launch two concurrent holdLock calls that race for the released lock.
    const [h1, h2] = await Promise.all([
      holdLock(repoPath, { takeoverWaitMs: 500, pollMs: 25 }),
      holdLock(repoPath, { takeoverWaitMs: 500, pollMs: 25 }),
    ]);

    clearTimeout(releaseTimer);

    // Exactly one should acquire (O_EXCL single-winner), one should get null.
    const acquiredCount = [h1, h2].filter((h) => h !== null).length;
    expect(acquiredCount).toBe(1);

    // The winner must own the lock.
    const winner = h1 ?? h2;
    expect(winner?.owned).toBe(true);
    expect(winner?.pid).toBe(process.pid);

    // Verify pidfile contains the winner's pid.
    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec.pid).toBe(process.pid);

    await winner?.release();
  });

  it('dead-pid pidfile → immediate reclaim with NO wait', async () => {
    const mod = await load(LOCK_MOD);
    const holdLock = requireFn(mod, 'holdLock');

    // Seed a pidfile with a dead pid (will fail isLive check).
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      pidfile(),
      JSON.stringify({ pid: deadPid(), uuid: 'dead-holder', startedAt: new Date(0).toISOString() }),
    );

    // Call holdLock with a bounded-wait window (should exit immediately, not poll).
    const startTime = Date.now();
    const handle = await holdLock(repoPath, { takeoverWaitMs: 5000, pollMs: 250 });
    const elapsedMs = Date.now() - startTime;

    // Assert: returns a valid handle (we reclaimed the dead lock).
    expect(handle).not.toBeNull();
    expect(handle?.owned).toBe(true);
    expect(handle?.pid).toBe(process.pid);

    // Assert: reclaim happened immediately (no significant wait for dead pid).
    // Reclaim should complete in well under 100ms (no polling loop).
    expect(elapsedMs).toBeLessThan(100);

    // Verify pidfile contains our pid (reclaimed).
    const rec = JSON.parse(await readFile(pidfile(), 'utf8'));
    expect(rec.pid).toBe(process.pid);

    await handle?.release();
  });
});
