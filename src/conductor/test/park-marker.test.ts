import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance specs for the park-marker module (Task 1/2, FR-1/FR-2/FR-7).
// Sibling of halt-marker.ts: `.daemon/parked/<slug>` is the single-source
// marker the daemon loop and dashboard treat as a per-slug operator park.
// Task 2 adds idempotency (re-park is a no-op) and fail-toward-parked error
// handling for isOperatorParked.
// ─────────────────────────────────────────────────────────────────────────────

const MOD_PATH = '../src/engine/park-marker.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
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
  repoPath = await mkdtemp(join(tmpdir(), 'park-marker-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('park-marker', () => {
  it('exposes the OPERATOR_PARKED_SUBDIR constant', async () => {
    const mod = await load();
    expect(mod.OPERATOR_PARKED_SUBDIR).toBe('parked');
  });

  it('isOperatorParked reports false on a fresh root', async () => {
    const mod = await load();
    const isOperatorParked = requireFn(mod, 'isOperatorParked');
    await expect(isOperatorParked(repoPath, 'some-slug')).resolves.toBe(false);
  });

  it('writeOperatorPark creates .daemon/parked/<slug> with timestamp and provenance body', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');

    await writeOperatorPark(repoPath, 'my-feature-slug');

    const raw = await readFile(join(repoPath, '.daemon', 'parked', 'my-feature-slug'), 'utf-8');
    const lines = raw.split('\n');
    expect(Number.isNaN(Date.parse(lines[0]))).toBe(false);
    expect(raw).toContain('parked by operator');
  });

  it('isOperatorParked reports true after writeOperatorPark', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    await writeOperatorPark(repoPath, 'my-feature-slug');

    await expect(isOperatorParked(repoPath, 'my-feature-slug')).resolves.toBe(true);
  });

  it('removeOperatorPark deletes the marker', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');
    const removeOperatorPark = requireFn(mod, 'removeOperatorPark');
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    await writeOperatorPark(repoPath, 'my-feature-slug');
    await removeOperatorPark(repoPath, 'my-feature-slug');

    await expect(isOperatorParked(repoPath, 'my-feature-slug')).resolves.toBe(false);
  });

  it('marker is scoped per-slug — other slugs remain unaffected', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    await writeOperatorPark(repoPath, 'slug-a');

    await expect(isOperatorParked(repoPath, 'slug-a')).resolves.toBe(true);
    await expect(isOperatorParked(repoPath, 'slug-b')).resolves.toBe(false);
  });

  it('writeOperatorPark is idempotent — re-parking an existing marker leaves content and mtime unchanged', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');

    await writeOperatorPark(repoPath, 'my-feature-slug');
    const markerPath = join(repoPath, '.daemon', 'parked', 'my-feature-slug');
    const firstContent = await readFile(markerPath, 'utf-8');
    const firstStat = await stat(markerPath);

    // Ensure any timestamp embedded in a rewrite would differ if a rewrite happened.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(writeOperatorPark(repoPath, 'my-feature-slug')).resolves.toBeUndefined();

    const secondContent = await readFile(markerPath, 'utf-8');
    const secondStat = await stat(markerPath);

    expect(secondContent).toBe(firstContent);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it('concurrent writeOperatorPark calls for the same slug leave exactly one intact marker', async () => {
    const mod = await load();
    const writeOperatorPark = requireFn(mod, 'writeOperatorPark');

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => writeOperatorPark(repoPath, 'race-slug'))
    );

    // None of the racers should reject — idempotent create swallows the "already exists" case.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const markerPath = join(repoPath, '.daemon', 'parked', 'race-slug');
    const raw = await readFile(markerPath, 'utf-8');
    expect(raw).toContain('parked by operator');
    const lines = raw.split('\n');
    expect(Number.isNaN(Date.parse(lines[0]))).toBe(false);
  });

  it('isOperatorParked fails toward parked (true) for a zero-byte marker file', async () => {
    const mod = await load();
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    const dir = join(repoPath, '.daemon', 'parked');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'empty-slug'), '', 'utf-8');

    await expect(isOperatorParked(repoPath, 'empty-slug')).resolves.toBe(true);
  });

  it('isOperatorParked fails toward parked (true) and invokes the log callback on a non-ENOENT read error', async () => {
    const mod = await load();
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    // Make the "marker" path a directory instead of a file so reading it as a
    // file fails with EISDIR — a read error that isn't a plain ENOENT.
    const dir = join(repoPath, '.daemon', 'parked');
    await mkdir(join(dir, 'weird-slug'), { recursive: true });

    let loggedErr: Error | undefined;
    await expect(
      isOperatorParked(repoPath, 'weird-slug', (err: Error) => {
        loggedErr = err;
      })
    ).resolves.toBe(true);

    expect(loggedErr).toBeInstanceOf(Error);
  });

  it('isOperatorParked reports false with no callback invocation on plain ENOENT', async () => {
    const mod = await load();
    const isOperatorParked = requireFn(mod, 'isOperatorParked');

    let called = false;
    await expect(
      isOperatorParked(repoPath, 'does-not-exist', () => {
        called = true;
      })
    ).resolves.toBe(false);

    expect(called).toBe(false);
  });
});
