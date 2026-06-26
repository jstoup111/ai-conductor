import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for ensureRunning (Phase 9.3 redesign, FR-21, ADR-010,
// condition C3). `ensureRunning` lives on the not-yet-built daemon-lock module
// (`src/engine/daemon-lock.ts`).
//
// Contract (defined by these specs):
//   ensureRunning(repoPath, opts?): Promise<void>
//     - no live daemon for repoPath → calls launchDaemonDetached EXACTLY ONCE
//       (fire-and-forget) and returns. (FR-21 happy)
//     - a LIVE daemon already owns repoPath → NO spawn, NO control signal of any
//       kind (never kill/restart/throttle/manage). (FR-21 negative)
//     - a STALE lock (dead pid) → ONE reclaim + ONE spawn (follows the FR-19
//       reclaim path). (FR-21 negative)
//
// The spawn/launch path is injectable (opts.launch or opts.spawn) so the test
// counts launches without touching the real process table.
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_MOD = '../../../src/engine/daemon-lock.js';

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
  repoPath = await mkdtemp(join(tmpdir(), 'ensure-running-'));
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

/** Records every launch + control-signal so we can assert spawn/signal counts. */
function makeProbe() {
  const launches: string[] = [];
  const signals: { pid: number; sig: number | string }[] = [];
  return {
    launches,
    signals,
    // launchDaemonDetached injection point
    launch: (target: string) => {
      launches.push(target);
    },
    // process.kill spy — a control SIGNAL (non-zero) is "management".
    kill: (pid: number, sig: number | string = 0) => {
      if (sig !== 0 && sig !== 'SIGCONT') signals.push({ pid, sig });
      return true;
    },
  };
}

describe('ensureRunning: spawn-iff-not-alive, never manage (FR-21)', () => {
  it('no live daemon → calls launchDaemonDetached exactly once', async () => {
    const ensureRunning = requireFn(await load(LOCK_MOD), 'ensureRunning');
    const probe = makeProbe();

    await ensureRunning(repoPath, { launch: probe.launch, kill: probe.kill });

    expect(probe.launches).toHaveLength(1);
    expect(probe.launches[0]).toBe(repoPath);
    expect(probe.signals).toHaveLength(0); // never signals
  });

  it('a LIVE daemon already owns the repo → zero spawns AND zero control signals', async () => {
    const ensureRunning = requireFn(await load(LOCK_MOD), 'ensureRunning');
    const probe = makeProbe();

    // The current process is genuinely alive → isLive(process.pid) === true.
    await writePidfile({ pid: process.pid, uuid: 'live-owner', startedAt: '2026-06-26T00:00:00.000Z' });

    await ensureRunning(repoPath, { launch: probe.launch, kill: probe.kill });

    // NOTE on opts.kill: ensureRunning uses the real process.kill (defaultKill) for
    // liveness probing — opts.kill is a management-signal spy only and is intentionally
    // bypassed for liveness. Therefore probe.signals===0 asserts the no-manage contract
    // (ensureRunning never sends a non-zero control signal), not liveness behavior.
    // The non-vacuous correctness assertion is probe.launches===0: if ensureRunning
    // incorrectly treated the live owner as absent it would call probe.launch, which
    // would be caught here. Zero spawns is the real signal that the live-owner path
    // was taken.
    expect(probe.launches).toHaveLength(0); // non-vacuous: live owner → no spawn attempted
    expect(probe.signals).toHaveLength(0); // management-signal spy: zero control signals sent
  });

  it('a STALE lock (dead pid) → exactly one reclaim + one spawn', async () => {
    const mod = await load(LOCK_MOD);
    const ensureRunning = requireFn(mod, 'ensureRunning');
    const probe = makeProbe();
    let reclaims = 0;

    await writePidfile({ pid: deadPid(), uuid: 'stale', startedAt: '2020-01-01T00:00:00.000Z' });

    await ensureRunning(repoPath, {
      launch: probe.launch,
      kill: probe.kill,
      onReclaim: () => {
        reclaims++;
      },
    });

    expect(reclaims).toBe(1); // stale lock followed the reclaim path once
    expect(probe.launches).toHaveLength(1); // and exactly one fresh spawn
  });
});
