import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ownerPublication = vi.hoisted(() => ({
  onRename: undefined as undefined | ((temporaryPath: string, ownerPath: string) => Promise<void>),
  renameCalls: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (temporaryPath: string, ownerPath: string): Promise<void> => {
      ownerPublication.renameCalls += 1;
      if (ownerPublication.onRename !== undefined) {
        await ownerPublication.onRename(temporaryPath, ownerPath);
        return;
      }
      await actual.rename(temporaryPath, ownerPath);
    },
  };
});
import {
  createConductStateLease,
  type ConductStateLeaseFilesystem,
} from '../../src/engine/conduct-state-lease.js';
import {
  createFilesystemConductStateStore,
  type ConductStatePersistence,
} from '../../src/engine/filesystem-conduct-state-store.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/state.js';

// Covers: S1.1, S1.2, S1.3, S2.1, S2.2, S2.3, S2.4, S2.5, S3.2, S3.3, S3.5, S3.6, task:1, task:2, task:3, task:4, task:5, task:6

const temporaryDirectories: string[] = [];

async function createStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'conduct-state-lease-'));
  temporaryDirectories.push(directory);
  return join(directory, 'conduct-state.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
  ownerPublication.onRename = undefined;
  ownerPublication.renameCalls = 0;
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve: () => resolve?.() };
}

function alreadyExists(): NodeJS.ErrnoException {
  return Object.assign(new Error('lease exists'), { code: 'EEXIST' });
}

function sharedLeaseFilesystem(): ConductStateLeaseFilesystem & {
  owner: string | undefined;
  hasDirectory(path: string): boolean;
} {
  const directories = new Set<string>();
  const files = new Map<string, string>();

  function missing(path: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
  }

  // A real filesystem refuses to create a file inside a directory that does not
  // exist. Modelling that is what makes a lease released mid-recovery observable.
  function requireParentDirectory(path: string): void {
    if (!directories.has(path.slice(0, path.lastIndexOf('/')))) throw missing(path);
  }

  return {
    get owner(): string | undefined {
      return [...files.entries()].find(([path]) => path.endsWith('/owner.json'))?.[1];
    },
    hasDirectory(path: string): boolean {
      return directories.has(path);
    },
    async acquireDirectory(path): Promise<void> {
      if (directories.has(path)) throw alreadyExists();
      directories.add(path);
    },
    async writeOwner(path, contents): Promise<void> {
      requireParentDirectory(path);
      if (files.has(path)) throw alreadyExists();
      files.set(path, contents);
    },
    async readOwner(path): Promise<string> {
      const owner = files.get(path);
      if (owner === undefined) throw missing(path);
      return owner;
    },
    async writeRecoveryClaim(path, contents): Promise<void> {
      requireParentDirectory(path);
      if (files.has(path)) throw alreadyExists();
      files.set(path, contents);
    },
    async readRecoveryClaim(path): Promise<string | null> {
      return files.get(path) ?? null;
    },
    async moveDirectory(path, destination): Promise<void> {
      if (!directories.delete(path)) throw missing(path);
      directories.add(destination);
      for (const [filePath, contents] of [...files]) {
        if (filePath.startsWith(`${path}/`)) {
          files.delete(filePath);
          files.set(`${destination}${filePath.slice(path.length)}`, contents);
        }
      }
    },
    async releaseDirectory(path): Promise<void> {
      directories.delete(path);
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(`${path}/`)) files.delete(filePath);
      }
    },
  };
}

function successorClaimPath(statePath: string, ownerToken: string, predecessorToken: string): string {
  const slot = createHash('sha256').update(JSON.stringify([ownerToken, predecessorToken])).digest('hex');
  return `${statePath}.lease/recovery.${slot}.json`;
}

describe('conduct-state lease', () => {
  it('creates a missing state parent before acquiring its lease', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conduct-state-lease-parent-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, '.pipeline', 'conduct-state.json');

    await writeState(statePath, { complexity_tier: 'M' });

    await expect(readFile(statePath, 'utf8')).resolves.toContain('"complexity_tier": "M"');
  });

  it('publishes owner metadata atomically and excludes a contender through the publication window', async () => {
    const statePath = await createStatePath();
    const ownerPath = `${statePath}.lease/owner.json`;
    const allowPublication = deferred();
    const publicationIntercepted = deferred();
    ownerPublication.onRename = async (temporaryPath, destination) => {
      expect(destination).toBe(ownerPath);
      expect(temporaryPath).toMatch(/^.+\/owner\.json\.[0-9a-f-]+\.tmp$/);
      publicationIntercepted.resolve();
      await allowPublication.promise;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      await actual.rename(temporaryPath, destination);
    };

    const first = createConductStateLease(statePath, {
      pid: 101,
      newToken: () => 'first-owner',
    }).acquire();
    await publicationIntercepted.promise;
    expect(ownerPublication.renameCalls).toBe(1);
    await expect(readFile(ownerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const contenderMayRetry = deferred();
    const contenderWaited = deferred();
    let contenderEntered = false;
    const second = createConductStateLease(statePath, {
      pid: 202,
      newToken: () => 'second-owner',
      processIsLive: (pid) => pid === 101,
      wait: async () => {
        contenderWaited.resolve();
        await contenderMayRetry.promise;
      },
    }).acquire().then((result) => {
      contenderEntered = result.ok;
      return result;
    });
    await contenderWaited.promise;
    expect(contenderEntered).toBe(false);

    allowPublication.resolve();
    const firstResult = await first;
    expect(firstResult).toMatchObject({ ok: true });
    await expect(readFile(ownerPath, 'utf8')).resolves.toSatisfy((contents) => {
      expect(JSON.parse(contents)).toMatchObject({
        version: 1,
        pid: 101,
        token: 'first-owner',
      });
      return true;
    });
    expect(contenderEntered).toBe(false);

    if (!firstResult.ok) throw new Error(firstResult.message);
    await expect(firstResult.handle.release()).resolves.toEqual({ ok: true });
    contenderMayRetry.resolve();
    const secondResult = await second;
    expect(secondResult).toMatchObject({ ok: true });
    expect(contenderEntered).toBe(true);
    if (secondResult.ok) await expect(secondResult.handle.release()).resolves.toEqual({ ok: true });
  });

  it('cleans a failed publication temporary file without replacing a live owner', async () => {
    const statePath = await createStatePath();
    const ownerPath = `${statePath}.lease/owner.json`;
    const liveOwner = `${JSON.stringify({
      version: 1,
      pid: 404,
      token: 'already-live',
      acquiredAt: '2026-09-11T00:00:00.000Z',
    })}\n`;
    let intercepted = false;
    ownerPublication.onRename = async (temporaryPath, destination) => {
      intercepted = true;
      expect(destination).toBe(ownerPath);
      await writeFile(destination, liveOwner, { encoding: 'utf8', flag: 'wx' });
      throw Object.assign(new Error('owner destination already exists'), { code: 'EEXIST' });
    };

    await expect(createConductStateLease(statePath, {
      pid: 101,
      newToken: () => 'failed-owner',
    }).acquire()).resolves.toEqual({
      ok: false,
      kind: 'filesystem',
      message: 'Unable to record conduct-state lease owner: owner destination already exists',
    });

    expect(intercepted).toBe(true);
    expect(ownerPublication.renameCalls).toBe(1);
    await expect(readFile(ownerPath, 'utf8')).resolves.toBe(liveOwner);
    await expect(readdir(`${statePath}.lease`)).resolves.toEqual(['owner.json']);
  });

  it('returns a typed timeout without stealing from a live owner', async () => {
    const statePath = '/worktree/live/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'live-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);

    let now = 0;
    const attempted = createConductStateLease(statePath, {
      filesystem,
      now: () => now,
      wait: async () => { now += 10; },
      processIsLive: (pid) => pid === 101,
      pid: 202,
      newToken: () => 'waiting-writer',
      waitTimeoutMs: 10,
      retryDelayMs: 10,
    });

    await expect(attempted.acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'timeout',
      message: 'Unable to acquire conduct-state lease within 10ms; owner pid 101 is live',
    });
    expect(filesystem.owner).toContain('live-owner');
    await held.handle.release();
  });

  it('recovers a lease only after injected liveness proves its owner dead', async () => {
    const statePath = '/worktree/dead/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    const diagnostics: unknown[] = [];

    const recovered = await createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'recovered-owner',
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire();

    expect(recovered).toMatchObject({ ok: true });
    expect(filesystem.owner).toContain('recovered-owner');
    expect(diagnostics).toEqual([{
      kind: 'recovered',
      statePath,
      ownerPid: 101,
    }]);
    if (recovered.ok) await expect(recovered.handle.release()).resolves.toEqual({ ok: true });
  });

  it('recovers a dead owner despite a valid legacy recovery claim left by a dead process', async () => {
    const statePath = '/worktree/stale-legacy-recovery-claim/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    await filesystem.writeRecoveryClaim(`${statePath}.lease/recovery.json`, JSON.stringify({
      version: 1,
      pid: 202,
      token: 'dead-recovery-claimant',
      claimedAt: '1970-01-01T00:00:00.000Z',
    }));

    const acquired = await createConductStateLease(statePath, {
      filesystem,
      pid: 303,
      newToken: () => 'new-owner',
      processIsLive: () => false,
    }).acquire();

    expect(acquired).toMatchObject({ ok: true });
    if (acquired.ok) await expect(acquired.handle.release()).resolves.toEqual({ ok: true });
  });

  it('keeps one live recovery claimant authoritative until it releases the recovered lease', async () => {
    const statePath = '/worktree/recovery-contenders/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, { filesystem: shared, pid: 101, newToken: () => 'dead-owner' }).acquire();
    if (!held.ok) throw new Error(held.message);
    let allowMove: (() => void) | undefined;
    const moveAllowed = new Promise<void>((resolve) => { allowMove = resolve; });
    let claimWritten: (() => void) | undefined;
    const claimHasWritten = new Promise<void>((resolve) => { claimWritten = resolve; });
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeRecoveryClaim(path, contents) { await shared.writeRecoveryClaim(path, contents); claimWritten?.(); },
      async moveDirectory(path, destination) { await moveAllowed; await shared.moveDirectory(path, destination); },
    };
    const first = createConductStateLease(statePath, { filesystem, pid: 202, newToken: () => 'first', processIsLive: () => false }).acquire();
    await claimHasWritten;
    const second = createConductStateLease(statePath, {
      filesystem,
      pid: 303,
      newToken: () => 'second',
      processIsLive: (candidatePid) => candidatePid === 202,
      wait: async () => { allowMove?.(); const acquired = await first; if (acquired.ok) await acquired.handle.release(); },
    }).acquire();
    await expect(second).resolves.toMatchObject({ ok: true });
    const acquired = await second;
    if (acquired.ok) await expect(acquired.handle.release()).resolves.toEqual({ ok: true });
  });

  it('retains a delayed foreign claim and recovers a replacement through its bound authority path', async () => {
    const statePath = '/worktree/replaced-owner/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const oldOwner = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'old-owner',
    }).acquire();
    if (!oldOwner.ok) throw new Error(oldOwner.message);

    let resumeOldClaim: (() => void) | undefined;
    const oldClaimMayResume = new Promise<void>((resolve) => { resumeOldClaim = resolve; });
    let oldClaimStarted: (() => void) | undefined;
    const oldClaimHasStarted = new Promise<void>((resolve) => { oldClaimStarted = resolve; });
    const claimPaths: string[] = [];
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeRecoveryClaim(path, contents): Promise<void> {
        if (path.endsWith('/recovery.json') && claimPaths.length === 0) {
          oldClaimStarted?.();
          await oldClaimMayResume;
        }
        await shared.writeRecoveryClaim(path, contents);
        claimPaths.push(path);
      },
    };
    let now = 0;
    const delayed = createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'delayed-contender',
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
      waitTimeoutMs: 1,
      retryDelayMs: 1,
      processIsLive: (candidatePid) => candidatePid === 303,
    }).acquire();
    await oldClaimHasStarted;
    await oldOwner.handle.release();
    const replacement = await createConductStateLease(statePath, {
      filesystem,
      pid: 303,
      newToken: () => 'replacement-owner',
    }).acquire();
    if (!replacement.ok) throw new Error(replacement.message);
    resumeOldClaim?.();
    const delayedResult = await delayed;
    const replacementOwnerBeforeRecovery = shared.owner;
    const foreignRootBeforeRecovery = await shared.readRecoveryClaim(`${statePath}.lease/recovery.json`);

    const recovered = await createConductStateLease(statePath, {
      filesystem,
      pid: 404,
      newToken: () => 'current-recoverer',
      processIsLive: () => false,
    }).acquire();

    expect({
      recovered: recovered.ok,
      delayedKind: delayedResult.ok ? undefined : delayedResult.kind,
      replacementOwnerBeforeRecovery,
      foreignRootBeforeRecovery,
      foreignRootWrites: claimPaths.filter((path) => path.endsWith('/recovery.json')).length,
      currentAuthorityPaths: claimPaths.filter((path) => !path.endsWith('/recovery.json')),
    }).toMatchObject({
      recovered: true,
      delayedKind: 'timeout',
      replacementOwnerBeforeRecovery: expect.stringContaining('"token":"replacement-owner"'),
      foreignRootBeforeRecovery: expect.stringContaining('"ownerToken":"old-owner"'),
      foreignRootWrites: 1,
      currentAuthorityPaths: [expect.any(String)],
    });
    if (recovered.ok) await recovered.handle.release();
  });

  it('releases a replacement owner after a delayed contender leaves its foreign claim', async () => {
    const statePath = '/worktree/replacement-release/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const oldOwner = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'old-owner',
    }).acquire();
    if (!oldOwner.ok) throw new Error(oldOwner.message);

    let resumeOldClaim: (() => void) | undefined;
    const oldClaimMayResume = new Promise<void>((resolve) => { resumeOldClaim = resolve; });
    let oldClaimStarted: (() => void) | undefined;
    const oldClaimHasStarted = new Promise<void>((resolve) => { oldClaimStarted = resolve; });
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeRecoveryClaim(path, contents): Promise<void> {
        if (path.endsWith('/recovery.json')) {
          oldClaimStarted?.();
          await oldClaimMayResume;
        }
        await shared.writeRecoveryClaim(path, contents);
      },
    };
    let now = 0;
    const delayed = createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'delayed-contender',
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
      waitTimeoutMs: 1,
      retryDelayMs: 1,
      processIsLive: (candidatePid) => candidatePid === 303,
    }).acquire();
    await oldClaimHasStarted;
    await oldOwner.handle.release();
    const replacement = await createConductStateLease(statePath, {
      filesystem,
      pid: 303,
      newToken: () => 'replacement-owner',
    }).acquire();
    if (!replacement.ok) throw new Error(replacement.message);
    resumeOldClaim?.();
    const delayedResult = await delayed;
    const released = await replacement.handle.release();
    const laterOwner = await createConductStateLease(statePath, {
      filesystem,
      pid: 404,
      newToken: () => 'later-owner',
    }).acquire();

    expect({
      delayedKind: delayedResult.ok ? undefined : delayedResult.kind,
      released,
      laterAcquired: laterOwner.ok,
    }).toEqual({
      delayedKind: 'timeout',
      released: { ok: true },
      laterAcquired: true,
    });
    if (laterOwner.ok) await laterOwner.handle.release();
  });

  it.each([
    ['an unbound legacy claim', (statePath: string) => [[`${statePath}.lease/recovery.json`, {
      version: 1, pid: 202, token: 'legacy-claim', claimedAt: '1970-01-01T00:00:00.000Z',
    }]]],
    ['a current-generation root claim', (statePath: string) => [[`${statePath}.lease/recovery.json`, {
      version: 1, pid: 202, token: 'current-claim', claimedAt: '1970-01-01T00:00:00.000Z',
      ownerToken: 'current-owner', predecessorToken: null,
    }]]],
    ['a current-generation authority path behind a foreign root', (statePath: string) => [[
      `${statePath}.lease/recovery.json`, {
        version: 1, pid: 202, token: 'foreign-claim', claimedAt: '1970-01-01T00:00:00.000Z',
        ownerToken: 'previous-owner', predecessorToken: null,
      },
    ], [`${statePath}.lease/recovery.${createHash('sha256').update(JSON.stringify(['current-owner', null])).digest('hex')}.json`, {
      version: 1, pid: 303, token: 'current-claim', claimedAt: '1970-01-01T00:00:00.000Z',
      ownerToken: 'current-owner', predecessorToken: null,
    }]]],
  ])('refuses release while %s is authoritative', async (_case, claimFactory) => {
    const statePath = '/worktree/release-authority/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const acquired = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'current-owner',
    }).acquire();
    if (!acquired.ok) throw new Error(acquired.message);
    const claims = claimFactory(statePath);
    for (const [path, claim] of claims as Array<[string, unknown]>) {
      await filesystem.writeRecoveryClaim(path, JSON.stringify(claim));
    }

    const released = await acquired.handle.release();

    expect({ released, stillHeld: filesystem.hasDirectory(`${statePath}.lease`) }).toEqual({
      released: { ok: false, message: 'Conduct-state lease recovery is in progress' },
      stillHeld: true,
    });
  });

  it('refuses release without deleting a changed owner generation', async () => {
    const statePath = '/worktree/release-changed-owner/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    let ownerChanged = false;
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async readOwner(path): Promise<string> {
        if (!ownerChanged) return shared.readOwner(path);
        return JSON.stringify({
          version: 1, pid: 202, token: 'replacement-owner', acquiredAt: '1970-01-01T00:00:00.000Z',
        });
      },
    };
    const acquired = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'original-owner',
    }).acquire();
    if (!acquired.ok) throw new Error(acquired.message);
    ownerChanged = true;

    expect({
      released: await acquired.handle.release(),
      stillHeld: shared.hasDirectory(`${statePath}.lease`),
    }).toEqual({
      released: { ok: false, message: 'Conduct-state lease ownership was lost before release' },
      stillHeld: true,
    });
  });

  it.each([
    ['a truncated successor', () => '{"version": 1, "pid":'],
    ['an unsupported successor', () => JSON.stringify({ version: 2, pid: 303, token: 'successor', claimedAt: '1970-01-01T00:00:00.000Z' })],
    ['an owner-mismatched successor', () => JSON.stringify({
      version: 1, pid: 303, token: 'successor', claimedAt: '1970-01-01T00:00:00.000Z', ownerToken: 'other-owner', predecessorToken: 'root-claim',
    })],
    ['a predecessor-mismatched successor', () => JSON.stringify({
      version: 1, pid: 303, token: 'successor', claimedAt: '1970-01-01T00:00:00.000Z', ownerToken: 'dead-owner', predecessorToken: 'other-claim',
    })],
    ['a repeated successor identity', () => JSON.stringify({
      version: 1, pid: 303, token: 'root-claim', claimedAt: '1970-01-01T00:00:00.000Z', ownerToken: 'dead-owner', predecessorToken: 'root-claim',
    })],
  ])('refuses recovery through %s without moving the lease', async (_case, successor) => {
    const statePath = '/worktree/inconsistent-successor/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    await shared.writeRecoveryClaim(`${statePath}.lease/recovery.json`, JSON.stringify({
      version: 1, pid: 202, token: 'root-claim', claimedAt: '1970-01-01T00:00:00.000Z',
      ownerToken: 'dead-owner', predecessorToken: null,
    }));
    await shared.writeRecoveryClaim(
      successorClaimPath(statePath, 'dead-owner', 'root-claim'),
      (successor as () => string)(),
    );
    let claimWrites = 0;
    let moves = 0;
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeRecoveryClaim(path, contents): Promise<void> {
        claimWrites += 1;
        if (claimWrites > 2) throw new Error('repeated successor traversal');
        await shared.writeRecoveryClaim(path, contents);
      },
      async moveDirectory(path, destination): Promise<void> {
        moves += 1;
        await shared.moveDirectory(path, destination);
      },
    };

    const result = await createConductStateLease(statePath, {
      filesystem,
      pid: 404,
      newToken: () => 'contender',
      processIsLive: () => false,
    }).acquire();

    expect({ result, moves, stillHeld: shared.hasDirectory(`${statePath}.lease`) }).toMatchObject({
      result: { ok: false, kind: 'recovery_refused', message: 'Unable to recover conduct-state lease: recovery claim is invalid or inconsistent' },
      moves: 0,
      stillHeld: true,
    });
  });

  it('refuses recovery when claimant liveness is unverifiable', async () => {
    const statePath = '/worktree/unverifiable-claimant/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    await filesystem.writeRecoveryClaim(`${statePath}.lease/recovery.json`, JSON.stringify({
      version: 1, pid: 202, token: 'claimant', claimedAt: '1970-01-01T00:00:00.000Z',
      ownerToken: 'dead-owner', predecessorToken: null,
    }));

    const result = await createConductStateLease(statePath, {
      filesystem,
      processIsLive: (candidatePid) => {
        if (candidatePid === 202) throw new Error('probe denied');
        return false;
      },
    }).acquire();

    expect({ result, stillHeld: filesystem.hasDirectory(`${statePath}.lease`) }).toEqual({
      result: {
        ok: false,
        kind: 'recovery_refused',
        message: 'Unable to recover conduct-state lease: recovery claimant liveness is unverifiable (probe denied)',
      },
      stillHeld: true,
    });
  });

  it.each([
    ['truncated JSON', '{"version": 1, "pid":'],
    ['an unsupported version', JSON.stringify({ version: 2, pid: 303, token: 'claim', claimedAt: '1970-01-01T00:00:00.000Z' })],
    ['an invalid pid', JSON.stringify({ version: 1, pid: 0, token: 'claim', claimedAt: '1970-01-01T00:00:00.000Z' })],
    ['an invalid token', JSON.stringify({ version: 1, pid: 303, token: '', claimedAt: '1970-01-01T00:00:00.000Z' })],
    ['an invalid claimed time', JSON.stringify({ version: 1, pid: 303, token: 'claim', claimedAt: 'not-a-date' })],
    ['only an owner binding', JSON.stringify({ version: 1, pid: 303, token: 'claim', claimedAt: '1970-01-01T00:00:00.000Z', ownerToken: 'existing-owner' })],
    ['only a predecessor binding', JSON.stringify({ version: 1, pid: 303, token: 'claim', claimedAt: '1970-01-01T00:00:00.000Z', predecessorToken: null })],
    ['a root predecessor binding', JSON.stringify({ version: 1, pid: 303, token: 'claim', claimedAt: '1970-01-01T00:00:00.000Z', ownerToken: 'existing-owner', predecessorToken: 'earlier-claim' })],
  ])('refuses %s recovery claim at acquisition without changing lease ownership', async (_case, malformedClaim) => {
    const statePath = '/worktree/malformed-recovery-claim/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'existing-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    const recoveryClaimPath = `${statePath}.lease/recovery.json`;
    await filesystem.writeRecoveryClaim(recoveryClaimPath, malformedClaim);
    const ownerBeforeAttempt = filesystem.owner;

    await expect(createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'would-be-owner',
      processIsLive: () => false,
    }).acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'recovery_refused',
    });
    expect(filesystem.owner).toBe(ownerBeforeAttempt);
    expect(filesystem.hasDirectory(`${statePath}.lease`)).toBe(true);
    await expect(filesystem.readRecoveryClaim(recoveryClaimPath)).resolves.toBe(malformedClaim);
    await held.handle.release();
  });

  it('retries a lease whose owner released it before recovery reads its metadata', async () => {
    const statePath = '/worktree/vanishing/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'departing-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);

    // The contender sees the held directory, then its filesystem seam releases
    // the first holder before rethrowing EEXIST. Its subsequent owner read must
    // therefore observe ENOENT and retry normal acquisition.
    let holderHasReleased = false;
    let ownerReadError: NodeJS.ErrnoException | undefined;
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async acquireDirectory(path): Promise<void> {
        try {
          await shared.acquireDirectory(path);
        } catch (error) {
          if (!holderHasReleased) {
            holderHasReleased = true;
            await held.handle.release();
          }
          throw error;
        }
      },
      async readOwner(path): Promise<string> {
        try {
          return await shared.readOwner(path);
        } catch (error) {
          ownerReadError = error as NodeJS.ErrnoException;
          throw error;
        }
      },
    };
    const diagnostics: unknown[] = [];
    let now = 0;

    const acquired = await createConductStateLease(statePath, {
      filesystem,
      label: 'intake ledger',
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
      pid: 202,
      newToken: () => 'next-owner',
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire();

    expect(acquired).toMatchObject({ ok: true });
    expect(ownerReadError).toMatchObject({ code: 'ENOENT' });
    expect(shared.owner).toContain('next-owner');
    expect(diagnostics).toEqual([]);
    if (acquired.ok) await expect(acquired.handle.release()).resolves.toEqual({ ok: true });
  });

  it('refuses an unreadable owner without changing its metadata', async () => {
    const statePath = '/worktree/unreadable/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'existing-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    const ownerBeforeAttempt = shared.owner;
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async readOwner(): Promise<string> {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    };
    const diagnostics: unknown[] = [];

    await expect(createConductStateLease(statePath, {
      filesystem,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire()).resolves.toEqual({
      ok: false,
      kind: 'recovery_refused',
      message: 'Unable to recover conduct-state lease: owner metadata is unavailable (permission denied)',
    });
    expect(diagnostics).toEqual([{ kind: 'refused', statePath, reason: 'ownership_changed' }]);
    expect(shared.owner).toBe(ownerBeforeAttempt);
    await held.handle.release();
  });

  it('waits between retries when a held lease has no owner metadata', async () => {
    const statePath = '/worktree/ownerless/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    await shared.acquireDirectory(`${statePath}.lease`);
    let now = 0;
    let acquisitionAttempts = 0;
    const waitDelays: number[] = [];
    const diagnostics: unknown[] = [];
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async acquireDirectory(path): Promise<void> {
        acquisitionAttempts += 1;
        await shared.acquireDirectory(path);
      },
    };

    const result = await createConductStateLease(statePath, {
      filesystem,
      now: () => now,
      wait: async (milliseconds) => {
        waitDelays.push(milliseconds);
        now += milliseconds;
      },
      waitTimeoutMs: 5,
      retryDelayMs: 5,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire();

    expect(result).toEqual({
      ok: false,
      kind: 'timeout',
      message: 'Unable to acquire conduct-state lease within 5ms',
    });
    expect(waitDelays).toEqual([5]);
    expect(acquisitionAttempts).toBe(waitDelays.length + 1);
    expect(now).toBe(5);
    expect(diagnostics).toEqual([]);
    expect(shared.hasDirectory(`${statePath}.lease`)).toBe(true);
    expect(shared.owner).toBeUndefined();
    await expect(shared.readRecoveryClaim(`${statePath}.lease/recovery.json`)).resolves.toBeNull();
  });

  it('retries a vanished lease without waiting', async () => {
    const statePath = '/worktree/vanished/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem: shared,
      pid: 101,
      newToken: () => 'departing-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    let released = false;
    const waitDelays: number[] = [];
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeRecoveryClaim(path, contents): Promise<void> {
        if (!released) {
          released = true;
          await held.handle.release();
        }
        await shared.writeRecoveryClaim(path, contents);
      },
    };

    const acquired = await createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'next-owner',
      processIsLive: () => false,
      wait: async (milliseconds) => { waitDelays.push(milliseconds); },
    }).acquire();

    expect(acquired).toMatchObject({ ok: true });
    expect(waitDelays).toEqual([]);
    if (acquired.ok) await expect(acquired.handle.release()).resolves.toEqual({ ok: true });
  });

  it('waits for a concurrent creator to publish owner metadata before recovering the lease', async () => {
    const statePath = '/worktree/initializing/.pipeline/conduct-state.json';
    const shared = sharedLeaseFilesystem();
    let allowOwnerWrite: (() => void) | undefined;
    const ownerWriteAllowed = new Promise<void>((resolve) => { allowOwnerWrite = resolve; });
    let ownerWriteStarted: (() => void) | undefined;
    const ownerWriteHasStarted = new Promise<void>((resolve) => { ownerWriteStarted = resolve; });
    const filesystem: ConductStateLeaseFilesystem = {
      ...shared,
      async writeOwner(path, contents): Promise<void> {
        ownerWriteStarted?.();
        await ownerWriteAllowed;
        await shared.writeOwner(path, contents);
      },
    };
    const first = createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'first-writer',
    }).acquire();
    await ownerWriteHasStarted;

    let waited = false;
    const second = createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'second-writer',
      processIsLive: (pid) => pid === 101,
      wait: async () => {
        waited = true;
        allowOwnerWrite?.();
        const acquired = await first;
        if (acquired.ok) await acquired.handle.release();
      },
    }).acquire();

    await expect(second).resolves.toMatchObject({ ok: true });
    expect(waited).toBe(true);
    const acquired = await second;
    if (acquired.ok) await expect(acquired.handle.release()).resolves.toEqual({ ok: true });
  });

  it('names a labelled store in acquire failures and recovery diagnostics', async () => {
    const statePath = '/worktree/ledger/.pipeline/ledger.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    const diagnostics: unknown[] = [];

    const recovered = await createConductStateLease(statePath, {
      filesystem,
      label: 'intake ledger',
      pid: 202,
      newToken: () => 'recovered-owner',
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire();

    expect(recovered).toMatchObject({ ok: true });
    expect(diagnostics).toEqual([{
      kind: 'recovered',
      statePath,
      ownerPid: 101,
      storeLabel: 'intake ledger',
    }]);
    if (recovered.ok) await recovered.handle.release();

    const failedFilesystem: ConductStateLeaseFilesystem = {
      ...filesystem,
      acquireDirectory: async () => {
        throw new Error('disk unavailable');
      },
    };
    await expect(createConductStateLease(statePath, {
      filesystem: failedFilesystem,
      label: 'intake ledger',
    }).acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'filesystem',
      message: 'Unable to acquire intake ledger lease: disk unavailable',
    });
  });

  it.each([
    ['corrupt', '{not json', 'invalid_owner_metadata'],
    ['ambiguous', JSON.stringify({ version: 1, pid: 101, token: 'owner', acquiredAt: 'not-a-date' }), 'invalid_owner_metadata'],
  ])('refuses %s owner metadata instead of stealing the lease', async (_case, owner, reason) => {
    const statePath = '/worktree/ambiguous/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    await filesystem.acquireDirectory(`${statePath}.lease`);
    await filesystem.writeOwner(`${statePath}.lease/owner.json`, owner);
    const diagnostics: unknown[] = [];

    await expect(createConductStateLease(statePath, {
      filesystem,
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'recovery_refused',
      message: 'Unable to recover conduct-state lease: owner metadata is invalid or ambiguous',
    });
    expect(diagnostics).toEqual([{ kind: 'refused', statePath, reason }]);
    expect(filesystem.owner).toBe(owner);
  });

  it('keeps leases for independent worktree state paths isolated', async () => {
    const filesystem = sharedLeaseFilesystem();
    const first = createConductStateLease('/worktree/one/.pipeline/conduct-state.json', {
      filesystem,
      newToken: () => 'one',
    });
    const second = createConductStateLease('/worktree/two/.pipeline/conduct-state.json', {
      filesystem,
      newToken: () => 'two',
    });

    const [firstAcquired, secondAcquired] = await Promise.all([first.acquire(), second.acquire()]);
    expect(firstAcquired).toMatchObject({ ok: true });
    expect(secondAcquired).toMatchObject({ ok: true });
    if (firstAcquired.ok) await firstAcquired.handle.release();
    if (secondAcquired.ok) await secondAcquired.handle.release();
  });

  it('holds the first writer, waits the second, then re-evaluates from the first committed state', async () => {
    const statePath = await createStatePath();
    await writeState(statePath, { complexity_tier: 'S', pr_url: 'https://example.test/pr/1' });
    const filesystem = sharedLeaseFilesystem();
    let now = 0;
    let firstWriterMayRelease: (() => void) | undefined;
    const firstWriterReleased = new Promise<void>((resolve) => {
      firstWriterMayRelease = resolve;
    });
    let firstWriterCommitted: (() => void) | undefined;
    const firstWriterHasCommitted = new Promise<void>((resolve) => {
      firstWriterCommitted = resolve;
    });
    let secondWaited = false;
    const wait = async (): Promise<void> => {
      secondWaited = true;
      firstWriterMayRelease?.();
      now += 1;
    };
    const newLease = (pid: number) => createConductStateLease(statePath, {
      filesystem,
      now: () => now,
      wait,
      pid,
      newToken: () => `writer-${pid}`,
      processIsLive: (ownerPid) => ownerPid === 101,
      waitTimeoutMs: 10,
      retryDelayMs: 1,
    });
    const firstPersistence: ConductStatePersistence = {
      async write(path, state): Promise<void> {
        await writeState(path, state);
        firstWriterCommitted?.();
        await firstWriterReleased;
      },
    };
    const secondWrites: ConductState[] = [];
    const secondPersistence: ConductStatePersistence = {
      async write(path, state): Promise<void> {
        secondWrites.push(state);
        await writeState(path, state);
      },
    };
    const first = createFilesystemConductStateStore(
      statePath,
      firstPersistence,
      undefined,
      undefined,
      newLease(101),
    );
    const second = createFilesystemConductStateStore(
      statePath,
      secondPersistence,
      undefined,
      undefined,
      newLease(202),
    );

    const firstApply = first.apply({
      field: 'complexity_tier',
      expected: 'S',
      intent: 'record assessed complexity',
      next: 'M',
    });
    await firstWriterHasCommitted;

    expect(JSON.parse(filesystem.owner ?? '{}')).toMatchObject({
      version: 1,
      pid: 101,
      token: 'writer-101',
      acquiredAt: '1970-01-01T00:00:00.000Z',
    });

    await expect(second.apply({
      field: 'pr_url',
      expected: 'https://example.test/pr/1',
      intent: 'record pull request URL',
      next: 'https://example.test/pr/2',
    })).resolves.toEqual({ kind: 'applied' });
    await expect(firstApply).resolves.toEqual({ kind: 'applied' });

    expect(secondWaited).toBe(true);
    expect(secondWrites).toEqual([{
      complexity_tier: 'M',
      pr_url: 'https://example.test/pr/2',
    }]);
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"complexity_tier": "M"');
  });
});
