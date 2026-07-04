import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance specs for the park-marker module (Task 1, FR-1/FR-7). Sibling of
// halt-marker.ts: `.daemon/parked/<slug>` is the single-source marker the
// daemon loop and dashboard treat as a per-slug operator park. This task only
// covers the happy path — idempotency and error isolation land in Task 2.
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
});
