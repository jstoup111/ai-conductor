import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { KillProbe } from '../../src/engine/daemon-lock.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for the NOT-YET-BUILT status augmentation in daemon-observe-cli.ts
// (ADR-014, Batch 2, daemon-supervised-hosting — FR-10).
//
// New contract: computeStatusRow(record, kill?, hasSessionProbe?) accepts an
// injectable hasSessionProbe: (repoPath: string) => boolean and the returned
// DaemonStatusRow gains a sessionPresent: boolean field.
//
// The module already exists (daemon-observe-cli.ts), so the dynamic import
// succeeds and requireFn finds the function. RED failure is an assertion error:
//   row.sessionPresent is currently undefined (field does not exist yet).
//
// hasSessionProbe is injected (never calls real tmux), making tests deterministic.
// ─────────────────────────────────────────────────────────────────────────────

const OBSERVE_MOD = '../../src/engine/daemon-observe-cli.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(OBSERVE_MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill probes — injectable; never send signals to real processes.
// ─────────────────────────────────────────────────────────────────────────────
const ALIVE: KillProbe = () => { /* no throw → process alive */ };
const DEAD: KillProbe = () => {
  const e = new Error('no such process') as NodeJS.ErrnoException;
  e.code = 'ESRCH';
  throw e;
};

// ─────────────────────────────────────────────────────────────────────────────
// hasSession probes — injectable; never call tmux.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_PRESENT = (_repoPath: string): boolean => true;
const SESSION_ABSENT = (_repoPath: string): boolean => false;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function record(name: string, path: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered' as const,
    registeredAt: '2026-06-27T00:00:00.000Z',
  };
}

async function writePidfile(
  repo: string,
  rec: { pid: number; uuid?: string; startedAt?: string },
): Promise<void> {
  await mkdir(join(repo, '.daemon'), { recursive: true });
  await writeFile(
    join(repo, '.daemon', 'daemon.pid'),
    JSON.stringify({
      pid: rec.pid,
      uuid: rec.uuid ?? 'u-test',
      startedAt: rec.startedAt ?? '2026-06-27T00:00:00.000Z',
    }),
    'utf8',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────
describe('computeStatusRow: sessionPresent augmentation (FR-10)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-session-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('pidfile with live pid + session present → liveness "running", sessionPresent true', async () => {
    const computeStatusRow = requireFn(await load(), 'computeStatusRow');

    const repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });
    await writePidfile(repo, { pid: 4242 });

    const row = await computeStatusRow(record('repo', repo), ALIVE, SESSION_PRESENT) as any;

    expect(row.liveness).toBe('running');
    // RED: sessionPresent is not yet on DaemonStatusRow — currently undefined
    expect(row.sessionPresent).toBe(true);
  });

  it('pidfile with dead pid + session present → liveness "stale", sessionPresent true (FR-10: distinguishable)', async () => {
    const computeStatusRow = requireFn(await load(), 'computeStatusRow');

    const repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });
    await writePidfile(repo, { pid: 4242 });

    const row = await computeStatusRow(record('repo', repo), DEAD, SESSION_PRESENT) as any;

    // A stale pidfile with a live tmux session is a distinct state from
    // "stale + no session": the operator can inspect/adopt the orphaned session.
    expect(row.liveness).toBe('stale');
    // RED: sessionPresent not yet implemented
    expect(row.sessionPresent).toBe(true);
  });

  it('dead pid + session ABSENT → liveness "stale", sessionPresent false (probe must be threaded, not derived from liveness)', async () => {
    const computeStatusRow = requireFn(await load(), 'computeStatusRow');

    const repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });
    await writePidfile(repo, { pid: 4242 });

    // Same liveness as the "stale + session present" case, but the session is
    // GONE. A naive `sessionPresent = liveness !== 'stopped'` would wrongly
    // report true here — sessionPresent MUST come from the injected probe.
    const row = await computeStatusRow(record('repo', repo), DEAD, SESSION_ABSENT) as any;

    expect(row.liveness).toBe('stale');
    expect(row.sessionPresent).toBe(false);
  });

  it('no pidfile + no session → liveness "stopped", sessionPresent false', async () => {
    const computeStatusRow = requireFn(await load(), 'computeStatusRow');

    const repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });
    // No pidfile written — repo dir exists but daemon has never started.

    const row = await computeStatusRow(record('repo', repo), ALIVE, SESSION_ABSENT) as any;

    expect(row.liveness).toBe('stopped');
    // RED: sessionPresent not yet implemented
    expect(row.sessionPresent).toBe(false);
  });
});
