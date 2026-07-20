// ─────────────────────────────────────────────────────────────────────────────
// Task 4 (RED): daemon stamps engine self-guard env before ensureFresh.
//
// `selfGuardEnv()` (src/engine/daemon-lock.ts) derives
// `{ CONDUCT_ENGINE_SELF_GUARD: '1', CONDUCT_ENGINE_SELF_VERSION: <id|''> }`
// from OWN_ENGINE_DIR via versionIdFromEngineDir (exported from
// engine-store.ts). runDaemonMode (src/daemon-cli.ts) must set these on
// process.env before calling ensureFresh, so publish-engine.mjs's
// gcVersions call (Task 3) never self-evicts the running daemon's own dist.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Task 4 — selfGuardEnv() helper', () => {
  it('always sets CONDUCT_ENGINE_SELF_GUARD=1, and CONDUCT_ENGINE_SELF_VERSION to the resolved version id (or empty string when unresolved)', async () => {
    const { selfGuardEnv } = await import('../../src/engine/daemon-lock.js');
    const env = selfGuardEnv();
    expect(env.CONDUCT_ENGINE_SELF_GUARD).toBe('1');
    expect(typeof env.CONDUCT_ENGINE_SELF_VERSION).toBe('string');
  });
});

describe('Task 4 — runDaemonMode stamps self-guard env before ensureFresh', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-self-guard-env-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    delete process.env.CONDUCT_ENGINE_SELF_GUARD;
    delete process.env.CONDUCT_ENGINE_SELF_VERSION;
  });

  it('has CONDUCT_ENGINE_SELF_GUARD and CONDUCT_ENGINE_SELF_VERSION set on process.env by the time ensureFresh is invoked', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    // Task 5: ensureFresh now runs AFTER a successful holdLock (the pidfile
    // backstop must be in place first) — mock a held lock so ensureFresh is
    // reached, then throw from ensureFresh to bail out deterministically
    // once we've observed the env state.
    const fakeLock = {
      pid: process.pid,
      uuid: 'fake-uuid',
      owned: true,
      release: async () => {},
      releaseSync: () => {},
    };
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(fakeLock as any);

    let seenGuard: string | undefined;
    let seenVersion: string | undefined;
    const ensureFresh = async () => {
      seenGuard = process.env.CONDUCT_ENGINE_SELF_GUARD;
      seenVersion = process.env.CONDUCT_ENGINE_SELF_VERSION;
      throw new Error('__stop__');
    };

    await expect(
      runDaemonMode({
        projectRoot,
        concurrency: 1,
        ensureFresh,
        exitProcess: () => {},
      } as any),
    ).rejects.toThrow('__stop__');

    expect(seenGuard).toBe('1');
    expect(typeof seenVersion).toBe('string');
  });
});
