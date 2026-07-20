import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for `gcVersions` in src/engine/engine-store.ts (Task 7, Phase 1 —
// FR-15: "GC deletes old versions only when NOT current AND NOT
// live-pidfile-referenced AND min-age satisfied AND outside keep-last-K").
//
// Safety-critical, fail-closed: every error path (registry enumeration
// failure, an unreadable fleet pidfile) must result in ZERO deletions, never
// a partial/best-guess GC.
// ─────────────────────────────────────────────────────────────────────────────

async function loadEngineStore(): Promise<typeof import('../../src/engine/engine-store.js')> {
  return import('../../src/engine/engine-store.js');
}

let conductorRoot: string;
let storeRoot: string;
let registryRoot: string; // parent temp dir holding registry.json + fake repos
let registryPath: string;

const NOW = new Date('2026-07-04T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  conductorRoot = await mkdtemp(join(tmpdir(), 'engine-store-gc-conductor-'));
  storeRoot = join(conductorRoot, 'dist-versions');
  await mkdir(storeRoot, { recursive: true });

  registryRoot = await mkdtemp(join(tmpdir(), 'engine-store-gc-registry-'));
  registryPath = join(registryRoot, 'registry.json');
  await writeFile(registryPath, '[]\n', 'utf-8');
});

afterEach(async () => {
  // Restore perms in case a test chmod'd a pidfile to 000, else rm fails.
  await chmod(join(registryRoot, 'repo-a', '.daemon', 'daemon.pid'), 0o644).catch(() => {});
  await rm(conductorRoot, { recursive: true, force: true });
  await rm(registryRoot, { recursive: true, force: true });
});

/** Create a version directory and (optionally) backdate its mtime by `ageMs`. */
async function makeVersion(id: string, ageMs: number): Promise<void> {
  const dir = join(storeRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.js'), 'export {};\n', 'utf-8');
  const mtime = new Date(NOW.getTime() - ageMs);
  await utimes(dir, mtime, mtime);
}

/** Register a fake repo (with a real `.daemon/daemon.pid`) in the registry. */
async function registerRepoWithPidfile(
  name: string,
  engineDir: string | undefined,
): Promise<string> {
  const repoPath = join(registryRoot, name);
  await mkdir(join(repoPath, '.daemon'), { recursive: true });
  const record = {
    schemaVersion: 1,
    name,
    path: repoPath,
    status: 'registered',
    registeredAt: NOW.toISOString(),
  };
  const existing = JSON.parse(await (await import('node:fs/promises')).readFile(registryPath, 'utf-8'));
  existing.push(record);
  await writeFile(registryPath, JSON.stringify(existing), 'utf-8');

  if (engineDir !== undefined) {
    const pidRecord = {
      pid: process.pid, // always alive: this test process
      uuid: 'test-uuid',
      startedAt: NOW.toISOString(),
      engineDir,
    };
    await writeFile(join(repoPath, '.daemon', 'daemon.pid'), JSON.stringify(pidRecord), 'utf-8');
  }
  return repoPath;
}

describe('gcVersions', () => {
  it('happy path: ancient, non-current, unreferenced, outside keep-K version is deleted', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    await makeVersion('20260601T000000Z-aaaaaaaaaaaa', 30 * ONE_DAY_MS); // ancient, eligible
    await makeVersion('20260701T000000Z-bbbbbbbbbbbb', 3 * ONE_DAY_MS);
    await makeVersion('20260702T000000Z-cccccccccccc', 2 * ONE_DAY_MS);
    await makeVersion('20260703T000000Z-dddddddddddd', 1 * ONE_DAY_MS); // current

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260703T000000Z-dddddddddddd' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 3,
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).toEqual(['20260601T000000Z-aaaaaaaaaaaa']);
    expect(result.deletedCount).toBe(1);
    expect(await listVersions(storeRoot)).not.toContain('20260601T000000Z-aaaaaaaaaaaa');
  });

  it('condition 1: never deletes the current version, even if ancient and outside keep-K', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    await makeVersion('20260101T000000Z-aaaaaaaaaaaa', 200 * ONE_DAY_MS); // current, ancient
    await makeVersion('20260601T000000Z-bbbbbbbbbbbb', 30 * ONE_DAY_MS);
    await makeVersion('20260701T000000Z-cccccccccccc', 30 * ONE_DAY_MS);
    await makeVersion('20260702T000000Z-dddddddddddd', 30 * ONE_DAY_MS);

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260101T000000Z-aaaaaaaaaaaa' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 1,
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).not.toContain('20260101T000000Z-aaaaaaaaaaaa');
    expect(await listVersions(storeRoot)).toContain('20260101T000000Z-aaaaaaaaaaaa');
  });

  it('condition 2: never deletes a version referenced by a live pidfile, even if ancient', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const referencedId = '20260101T000000Z-eeeeeeeeeeee';
    await makeVersion(referencedId, 200 * ONE_DAY_MS); // ancient, would otherwise be eligible
    await makeVersion('20260701T000000Z-ffffffffffff', 30 * ONE_DAY_MS); // current

    await registerRepoWithPidfile('repo-a', join(storeRoot, referencedId, 'engine'));

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260701T000000Z-ffffffffffff' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).not.toContain(referencedId);
    expect(await listVersions(storeRoot)).toContain(referencedId);
  });

  it('condition 3: never deletes a version younger than min-age', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const youngId = '20260704T000000Z-1111111111ff';
    await makeVersion(youngId, 60 * 1000); // 1 minute old
    await makeVersion('20260704T060000Z-2222222222ff', 30 * 1000); // current, even younger

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260704T060000Z-2222222222ff' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).not.toContain(youngId);
    expect(await listVersions(storeRoot)).toContain(youngId);
  });

  it('condition 4: keeps at least the newest K versions regardless of age', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    await makeVersion('20260101T000000Z-aaaaaaaaaaaa', 200 * ONE_DAY_MS);
    await makeVersion('20260102T000000Z-bbbbbbbbbbbb', 199 * ONE_DAY_MS);
    await makeVersion('20260103T000000Z-cccccccccccc', 198 * ONE_DAY_MS); // current

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260103T000000Z-cccccccccccc' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 3, // all 3 versions kept: they're the newest 3 that exist
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).toEqual([]);
    const remaining = await listVersions(storeRoot);
    expect(remaining).toHaveLength(3);
  });

  it('registry enumeration error -> zero deletions and a warning is logged', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    await writeFile(registryPath, '{ not valid json', 'utf-8'); // corrupt registry

    const ancientId = '20260101T000000Z-aaaaaaaaaaaa';
    await makeVersion(ancientId, 200 * ONE_DAY_MS);
    await makeVersion('20260701T000000Z-bbbbbbbbbbbb', 30 * ONE_DAY_MS); // current

    const warnings: string[] = [];
    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260701T000000Z-bbbbbbbbbbbb' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      registryPath,
      now: NOW,
      warn: (msg) => warnings.push(msg),
    });

    expect(result.deleted).toEqual([]);
    expect(result.deletedCount).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(await listVersions(storeRoot)).toContain(ancientId);
  });

  it('one unreadable pidfile -> zero deletions, fail-closed', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const ancientId = '20260101T000000Z-aaaaaaaaaaaa';
    await makeVersion(ancientId, 200 * ONE_DAY_MS);
    await makeVersion('20260701T000000Z-bbbbbbbbbbbb', 30 * ONE_DAY_MS); // current

    // A repo IS registered with a pidfile, but it's unreadable — the GC must
    // treat this as "cannot prove nothing is referenced" and abort entirely,
    // even though `ancientId` isn't actually referenced by anything.
    const repoPath = await registerRepoWithPidfile('repo-a', join(storeRoot, ancientId, 'engine'));
    await chmod(join(repoPath, '.daemon', 'daemon.pid'), 0o000);

    // Skip this test entirely when running as root (root ignores file mode
    // bits, so the read would succeed and the fail-closed path would never
    // trigger) — mirrors the guard used by other chmod-based tests in this
    // suite (see daemon-log.test.ts).
    if (process.getuid && process.getuid() === 0) return;

    const warnings: string[] = [];
    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260701T000000Z-bbbbbbbbbbbb' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      registryPath,
      now: NOW,
      warn: (msg) => warnings.push(msg),
    });

    expect(result.deleted).toEqual([]);
    expect(result.deletedCount).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(await listVersions(storeRoot)).toContain(ancientId);
  });

  it('protectVersionIds: never deletes a self-protected version even when all four legacy conditions would otherwise delete it', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const protectedId = '20260101T000000Z-aaaaaaaaaaaa';
    await makeVersion(protectedId, 200 * ONE_DAY_MS); // ancient, not current, not live-referenced, outside keep-K
    await makeVersion('20260701T000000Z-bbbbbbbbbbbb', 30 * ONE_DAY_MS); // current

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260701T000000Z-bbbbbbbbbbbb' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      protectVersionIds: [protectedId as any],
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).not.toContain(protectedId);
    expect(await listVersions(storeRoot)).toContain(protectedId);
  });

  it('protectVersionIds: protects exactly the named version among several equally-eligible siblings, deleting all others (guard is not widened)', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const protectedId = '20260101T000000Z-aaaaaaaaaaaa';
    const siblingIds = [
      '20260102T000000Z-bbbbbbbbbbbb',
      '20260103T000000Z-cccccccccccc',
      '20260104T000000Z-dddddddddddd',
    ];

    // Every one of these — the protected version AND its siblings — is
    // ancient, not current, not live-referenced, and outside keep-K: all
    // four legacy conditions say "delete" for all of them equally. Only
    // `protectedId` is named in protectVersionIds.
    await makeVersion(protectedId, 200 * ONE_DAY_MS);
    for (const id of siblingIds) {
      await makeVersion(id, 200 * ONE_DAY_MS);
    }
    await makeVersion('20260701T000000Z-eeeeeeeeeeee', 30 * ONE_DAY_MS); // current

    const result = await gcVersions({
      conductorRoot,
      currentVersionId: '20260701T000000Z-eeeeeeeeeeee' as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 0,
      protectVersionIds: [protectedId as any],
      registryPath,
      now: NOW,
      warn: () => {},
    });

    // The protected version survives...
    expect(result.deleted).not.toContain(protectedId);
    // ...but the guard must NOT widen to cover its equally-eligible siblings:
    // every one of them is deleted exactly as if no guard existed.
    for (const id of siblingIds) {
      expect(result.deleted).toContain(id);
    }
    expect(result.deletedCount).toBe(siblingIds.length);

    const remaining = await listVersions(storeRoot);
    expect(remaining).toContain(protectedId);
    for (const id of siblingIds) {
      expect(remaining).not.toContain(id);
    }
  });

  it('regression: with protectVersionIds absent/empty, the four legacy delete conditions behave exactly as before', async () => {
    const { gcVersions, listVersions } = await loadEngineStore();

    const currentId = '20260703T120000Z-dddddddddddd';
    const keptByAgeId = '20260703T060000Z-cccccccccccc'; // too young to delete
    const referencedId = '20260101T000000Z-eeeeeeeeeeee'; // ancient but live-referenced
    const eligibleId = '20260601T000000Z-aaaaaaaaaaaa'; // ancient, unreferenced, outside keep-K

    await makeVersion(eligibleId, 30 * ONE_DAY_MS);
    await makeVersion(referencedId, 30 * ONE_DAY_MS);
    await makeVersion(keptByAgeId, 6 * 60 * 60 * 1000); // 6 hours old, under minAge
    await makeVersion(currentId, 0);

    await registerRepoWithPidfile('repo-a', join(storeRoot, referencedId, 'engine'));

    // protectVersionIds explicitly empty — must be a no-op vs. omitting it.
    const result = await gcVersions({
      conductorRoot,
      currentVersionId: currentId as any,
      minAgeMsecs: ONE_DAY_MS,
      keepLastK: 1,
      protectVersionIds: [],
      registryPath,
      now: NOW,
      warn: () => {},
    });

    expect(result.deleted).toEqual([eligibleId]);
    expect(result.deletedCount).toBe(1);

    const remaining = await listVersions(storeRoot);
    expect(remaining).not.toContain(eligibleId);
    expect(remaining).toContain(referencedId); // condition 2: live-referenced
    expect(remaining).toContain(keptByAgeId); // condition 3: too young
    expect(remaining).toContain(currentId); // condition 1: current
  });
});
