/**
 * Tests for observation-sweep.ts (Task 6: observation registry with v1 schema and tolerant IO).
 *
 * Tests the registry helpers: enrollObservation, readObservationWatch, rewriteObservationWatch.
 * Temp directories are created per-suite and cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  enrollObservation,
  readObservationWatch,
  rewriteObservationWatch,
  type ObservationEntry,
} from '../../src/engine/observation-sweep.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function entry(overrides?: Partial<ObservationEntry>): ObservationEntry {
  const enrolledAt = Date.now();
  return {
    v: 1,
    sourceRef: '#42',
    prUrl: 'https://github.com/foo/bar/pull/42',
    slug: 'my-feature',
    signature: 'test',
    isRegex: false,
    windowDays: 14,
    enrolledAt,
    ...overrides,
  };
}

// ── Temp dir lifecycle ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'observation-sweep-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Task 6: observation registry helpers ──────────────────────────────────────

describe('enrollObservation', () => {
  it('appends v:1 JSONL entry to registry file', async () => {
    const testEntry = entry();
    await enrollObservation(tmpDir, testEntry);

    // Verify .daemon directory was created
    const files = await readFile(join(tmpDir, '.daemon', 'observation-watch.jsonl'), 'utf-8');
    expect(files).toContain('"v":1');
    expect(files).toContain('"sourceRef":"#42"');
  });

  it('creates .daemon directory if missing', async () => {
    const testEntry = entry();
    // tmpDir has no .daemon yet
    await enrollObservation(tmpDir, testEntry);

    const result = await readObservationWatch(tmpDir);
    expect(result).toHaveLength(1);
  });

  it('creates observation-watch.jsonl if missing', async () => {
    const testEntry = entry();
    await enrollObservation(tmpDir, testEntry);

    const filePath = join(tmpDir, '.daemon', 'observation-watch.jsonl');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBeTruthy();
  });
});

describe('readObservationWatch', () => {
  it('returns empty array when file does not exist', async () => {
    const result = await readObservationWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns persisted entries across restart', async () => {
    const e1 = entry({ sourceRef: '#42' });
    const e2 = entry({ sourceRef: '#43' });

    await enrollObservation(tmpDir, e1);
    await enrollObservation(tmpDir, e2);

    // New registry instance reads from same file
    const result = await readObservationWatch(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].sourceRef).toBe('#42');
    expect(result[1].sourceRef).toBe('#43');
  });

  it('skips malformed line and logs warning', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    const valid1 = JSON.stringify(entry({ sourceRef: '#42' }));
    const malformed = '{not valid json';
    const valid2 = JSON.stringify(entry({ sourceRef: '#43' }));

    await writeFile(
      join(tmpDir, '.daemon', 'observation-watch.jsonl'),
      [valid1, malformed, valid2].join('\n') + '\n',
    );

    const logs: string[] = [];
    const result = await readObservationWatch(tmpDir, (msg) => logs.push(msg));

    expect(result).toHaveLength(2);
    expect(result[0].sourceRef).toBe('#42');
    expect(result[1].sourceRef).toBe('#43');
    expect(logs.some((l) => l.includes('malformed') || l.includes('line'))).toBe(true);
  });

  it('skips unknown schema versions', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    const v1Entry = JSON.stringify(entry());
    const v2Entry = JSON.stringify({ v: 2, sourceRef: '#99', prUrl: 'https://...' });

    await writeFile(
      join(tmpDir, '.daemon', 'observation-watch.jsonl'),
      [v1Entry, v2Entry].join('\n') + '\n',
    );

    const result = await readObservationWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].v).toBe(1);
    expect(result[0].sourceRef).toBe('#42');
  });

  it('returns empty array for completely empty file', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    await writeFile(join(tmpDir, '.daemon', 'observation-watch.jsonl'), '');
    const result = await readObservationWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips valid JSON but wrong shape (missing required fields)', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    const validEntry = JSON.stringify(entry());
    const wrongShape = JSON.stringify({ v: 1, sourceRef: '#99' }); // missing other fields

    await writeFile(
      join(tmpDir, '.daemon', 'observation-watch.jsonl'),
      [validEntry, wrongShape].join('\n') + '\n',
    );

    const result = await readObservationWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].sourceRef).toBe('#42');
  });
});

describe('rewriteObservationWatch', () => {
  it('overwrites the file with given entries, replacing prior content', async () => {
    const e1 = entry({ sourceRef: '#42' });
    const e2 = entry({ sourceRef: '#43' });

    await enrollObservation(tmpDir, e1);
    await enrollObservation(tmpDir, e2);

    // Rewrite with only e1
    await rewriteObservationWatch(tmpDir, [e1]);

    const result = await readObservationWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].sourceRef).toBe('#42');
  });

  it('writes empty file when entries is empty array', async () => {
    await enrollObservation(tmpDir, entry());
    await rewriteObservationWatch(tmpDir, []);

    const result = await readObservationWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('swallows write failure without throwing', async () => {
    // Writing to a path whose parent directory does not exist must not throw.
    await expect(
      rewriteObservationWatch('/no/such/directory/here', []),
    ).resolves.toBeUndefined();
  });

  it('preserves entries enrolled concurrently between read and rewrite', async () => {
    // Simulate concurrency: read registry → enroll new entry → rewrite
    const entryA = entry({ sourceRef: '#42', prUrl: 'https://github.com/foo/bar/pull/42' });
    const entryB = entry({ sourceRef: '#43', prUrl: 'https://github.com/foo/bar/pull/43' });

    // 1. Enroll entry A
    await enrollObservation(tmpDir, entryA);

    // 2. Read registry into survivors
    const survivors = await readObservationWatch(tmpDir);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].sourceRef).toBe('#42');

    // 3. While simulating a rewrite, separately enroll entry B
    // This happens concurrently with the rewrite
    await enrollObservation(tmpDir, entryB);

    // 4. Call rewriteObservationWatch with survivors (only A)
    await rewriteObservationWatch(tmpDir, survivors);

    // 5. Read registry again
    const final = await readObservationWatch(tmpDir);

    // Expected: both A and B present in the final registry
    expect(final).toHaveLength(2);
    expect(final.map((e) => e.sourceRef).sort()).toEqual(['#42', '#43']);
  });
});

describe('ObservationEntry schema validation', () => {
  it('preserves optional timestamp fields across round-trip', async () => {
    const testEntry = entry({
      lastPollAt: 1234567890,
      mergedAt: 1234567891,
      lastScanAt: 1234567892,
    });

    await enrollObservation(tmpDir, testEntry);
    const result = await readObservationWatch(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].lastPollAt).toBe(1234567890);
    expect(result[0].mergedAt).toBe(1234567891);
    expect(result[0].lastScanAt).toBe(1234567892);
  });

  it('omits optional fields when not present', async () => {
    const testEntry = entry();
    // v, sourceRef, prUrl, slug, signature, isRegex, windowDays, enrolledAt all required
    // lastPollAt, mergedAt, lastScanAt are optional and not set

    await enrollObservation(tmpDir, testEntry);
    const result = await readObservationWatch(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].lastPollAt).toBeUndefined();
    expect(result[0].mergedAt).toBeUndefined();
    expect(result[0].lastScanAt).toBeUndefined();
  });
});
