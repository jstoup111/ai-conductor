// Test: Durable authored-keys ledger (Task 15, FR-12, ADR-006)
//
// The engineer records every (project, feature) pair it has AUTHORED a spec for.
// This ledger is DURABLE — it persists to a JSON file under the engineer dir and
// survives process/session restarts.
//
// Tests:
//   (a) record then read returns the pair
//   (b) DURABILITY — fresh reader against same temp dir sees the pair
//   (c) idempotency — recording the same pair twice yields one entry
//   (d) absent ledger file → readAuthoredKeys returns []
//   (e) malformed ledger file → clear throw naming the file

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordAuthoredKey,
  readAuthoredKeys,
} from '../../../src/engine/engineer/authored-ledger.js';

// Helper: create a fresh temp dir for each test so tests are fully isolated.
// We override the engineer dir via AI_CONDUCTOR_ENGINEER_DIR env variable.

describe('authored-keys ledger', () => {
  let tempDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'authored-ledger-test-'));
    env = { AI_CONDUCTOR_ENGINEER_DIR: tempDir };
  });

  // Cleanup after each test to avoid leaking temp dirs.
  // Not strictly required but good practice.
  // (No afterEach cleanup so we can inspect on failure if needed.)

  // ── (a) record then read returns the pair ─────────────────────────────────
  it('records a (project, feature) pair and reads it back', async () => {
    await recordAuthoredKey('my-project', 'feature-x', { env });
    const keys = await readAuthoredKeys({ env });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'my-project', feature: 'feature-x' });
  });

  // ── (b) DURABILITY — simulated restart ────────────────────────────────────
  it('persists across simulated process restart (fresh call reads same file)', async () => {
    // Write in "this process"
    await recordAuthoredKey('proj-a', 'feat-1', { env });

    // Simulate restart: call readAuthoredKeys with the same env (same dir),
    // as if a new process had just started and loaded from disk.
    const keysAfterRestart = await readAuthoredKeys({ env });

    expect(keysAfterRestart).toHaveLength(1);
    expect(keysAfterRestart[0]).toEqual({ project: 'proj-a', feature: 'feat-1' });
  });

  // ── (c) idempotency ───────────────────────────────────────────────────────
  it('recording the same pair twice yields exactly one entry (idempotent)', async () => {
    await recordAuthoredKey('proj-b', 'feat-2', { env });
    await recordAuthoredKey('proj-b', 'feat-2', { env }); // duplicate
    const keys = await readAuthoredKeys({ env });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'proj-b', feature: 'feat-2' });
  });

  // ── additional idempotency: multiple different pairs ──────────────────────
  it('records multiple distinct pairs without duplication', async () => {
    await recordAuthoredKey('proj-c', 'feat-a', { env });
    await recordAuthoredKey('proj-c', 'feat-b', { env });
    await recordAuthoredKey('proj-c', 'feat-a', { env }); // duplicate of first
    const keys = await readAuthoredKeys({ env });
    expect(keys).toHaveLength(2);
    const sorted = [...keys].sort((a, b) => a.feature.localeCompare(b.feature));
    expect(sorted[0]).toEqual({ project: 'proj-c', feature: 'feat-a' });
    expect(sorted[1]).toEqual({ project: 'proj-c', feature: 'feat-b' });
  });

  // ── (d) absent ledger file → [] ───────────────────────────────────────────
  it('returns [] when the ledger file does not exist (engineer dir is empty)', async () => {
    // tempDir exists but authored-keys.json was never written
    const keys = await readAuthoredKeys({ env });
    expect(keys).toEqual([]);
  });

  // ── (e) malformed ledger file → clear throw naming the file ──────────────
  it('throws a clear error naming the ledger file when the file is malformed JSON', async () => {
    // Write corrupt JSON into the ledger location
    const ledgerPath = join(tempDir, 'authored-keys.json');
    await writeFile(ledgerPath, '{ this is not valid json ]]]', 'utf-8');

    await expect(readAuthoredKeys({ env })).rejects.toThrow(/authored-keys\.json/);
  });

  // ── (f) non-ENOENT read error → surfaces rather than returning [] ─────────
  it('throws (does not return []) when the ledger path is a directory (EISDIR)', async () => {
    // Create the ledger path AS A DIRECTORY so readFile yields EISDIR (not ENOENT).
    // This proves the ENOENT-only swallow: a genuinely-absent file still returns [],
    // but any other read failure must surface so callers learn the ledger is broken.
    const ledgerDir = join(tempDir, 'authored-keys.json');
    await mkdir(ledgerDir, { recursive: true });

    await expect(readAuthoredKeys({ env })).rejects.toThrow(/authored-keys\.json/);
  });

  // ── adversarial: project/feature with special characters ─────────────────
  it('handles project and feature names containing colons and slashes', async () => {
    await recordAuthoredKey('org/repo', 'feat:v2/sub', { env });
    const keys = await readAuthoredKeys({ env });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ project: 'org/repo', feature: 'feat:v2/sub' });
  });

  // ── adversarial: empty string project or feature is NOT valid ─────────────
  it('throws when project is an empty string', async () => {
    await expect(recordAuthoredKey('', 'feat-x', { env })).rejects.toThrow(
      /project.*empty|empty.*project/i,
    );
  });

  it('throws when feature is an empty string', async () => {
    await expect(recordAuthoredKey('my-proj', '', { env })).rejects.toThrow(
      /feature.*empty|empty.*feature/i,
    );
  });
});
