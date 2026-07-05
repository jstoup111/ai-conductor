import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

const fsPromises = await import('node:fs/promises');
const {
  writeGatedSnapshot,
  readGatedSnapshot,
} = await import('../../src/engine/gated-snapshot.js');
type GatedItem = import('../../src/engine/gated-snapshot.js').GatedItem;

// ─────────────────────────────────────────────────────────────────────────────
// Task 11 — snapshot serializer with atomic write.
//
// Two layers of coverage:
//   1. Behavioral tests against the real filesystem (schema shape, split by
//      kind, whole-file rewrite, advisory failure handling).
//   2. An injected-fs spy layer that asserts the *mechanism*: the module must
//      go through rename() onto the final path, never a direct write to
//      gated.json itself — proving atomicity rather than merely asserting
//      the end result.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let daemonDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gated-snapshot-'));
  daemonDir = join(root, '.daemon');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const FIXED_CLOCK = () => new Date('2026-07-05T12:00:00.000Z');

describe('writeGatedSnapshot', () => {
  it('writes schemaVersion 1, writtenAt from the clock, and splits gated/repo entries', async () => {
    const state: { gated: GatedItem[] } = {
      gated: [
        { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
        { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover' },
      ],
    };

    await writeGatedSnapshot(daemonDir, state, FIXED_CLOCK);

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.writtenAt).toBe('2026-07-05T12:00:00.000Z');
    expect(parsed.gated).toEqual([
      { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
    ]);
    expect(parsed.repoWarnings).toEqual([
      { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover' },
    ]);
  });

  it('performs a whole-file rewrite: a spec absent from the new list is absent from the snapshot', async () => {
    await writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'stale', reason: 'unowned-indeterminate', remedy: 'set cutover' }] },
      FIXED_CLOCK,
    );
    await writeGatedSnapshot(daemonDir, { gated: [] }, () => new Date('2026-07-05T12:05:00.000Z'));

    const parsed = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(parsed.gated).toEqual([]);
    expect(parsed.writtenAt).toBe('2026-07-05T12:05:00.000Z');
  });

  it('creates .daemon/ if it does not yet exist', async () => {
    await writeGatedSnapshot(daemonDir, { gated: [] }, FIXED_CLOCK);
    const parsed = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(parsed.schemaVersion).toBe(1);
  });

  it('swallows a write failure (unwritable parent) instead of throwing', async () => {
    // Simulate an un-creatable directory by pointing daemonDir at a path
    // whose parent is actually a file, so mkdir(recursive) fails.
    const blockerFile = join(root, 'blocker');
    await (await import('node:fs/promises')).writeFile(blockerFile, 'x');
    const impossibleDir = join(blockerFile, 'cant-make-this');

    let threw = false;
    try {
      await writeGatedSnapshot(impossibleDir, { gated: [] }, FIXED_CLOCK);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('logs the failure reason once via the injected log sink (Task 13: advisory failure is observable, not silent)', async () => {
    const blockerFile = join(root, 'blocker-2');
    await (await import('node:fs/promises')).writeFile(blockerFile, 'x');
    const impossibleDir = join(blockerFile, 'cant-make-this');

    const log = vi.fn();
    let threw = false;
    try {
      await writeGatedSnapshot(impossibleDir, { gated: [] }, FIXED_CLOCK, log);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('writeGatedSnapshot');
  });

  it('uses temp+rename, not a direct write to the final path (mocked-fs assertion)', async () => {
    const finalPath = join(daemonDir, 'gated.json');
    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const renameMock = fsPromises.rename as unknown as ReturnType<typeof vi.fn>;
    writeFileMock.mockClear();
    renameMock.mockClear();

    await writeGatedSnapshot(daemonDir, { gated: [] }, FIXED_CLOCK);

    // The content write goes to a temp path, never straight to gated.json.
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [writtenPath] = writeFileMock.mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).not.toBe(finalPath);
    expect(writtenPath.startsWith(daemonDir)).toBe(true);

    // The atomic swap onto the real path happens via rename(), from that
    // same temp path, onto gated.json.
    expect(renameMock).toHaveBeenCalledTimes(1);
    const [renameFrom, renameTo] = renameMock.mock.calls[0] as [string, string];
    expect(renameFrom).toBe(writtenPath);
    expect(renameTo).toBe(finalPath);

    const entries = await readFile(finalPath, 'utf-8');
    expect(JSON.parse(entries).schemaVersion).toBe(1);
  });
});

describe('readGatedSnapshot', () => {
  // readGatedSnapshot takes the REPO root (not the .daemon dir directly) and
  // joins `.daemon/gated.json` itself — this matches how daemon status calls
  // it (one repo path per registry entry) — and returns an explicit
  // discriminated union, never `null`, so an absent/corrupt/future-shaped
  // snapshot can never be misread by a caller as an implied all-clear.

  it('returns { kind: "unknown", why: "missing" } when no snapshot has been written yet', async () => {
    const result = await readGatedSnapshot(root);
    expect(result).toEqual({ kind: 'unknown', why: 'missing' });
  });

  it('round-trips a written snapshot as { kind: "ok", gated, repoWarnings, writtenAt }', async () => {
    await writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'a', remedy: 'r' }] },
      FIXED_CLOCK,
    );
    const result = await readGatedSnapshot(root);
    expect(result).toEqual({
      kind: 'ok',
      writtenAt: '2026-07-05T12:00:00.000Z',
      repoWarnings: [],
      gated: [{ kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'a', remedy: 'r' }],
    });
  });

  it('returns { kind: "unknown", why: "unreadable" } for truncated/invalid JSON', async () => {
    await mkdir(daemonDir, { recursive: true });
    await writeFile(join(daemonDir, 'gated.json'), '{"schemaVersion": 1, "writtenAt": "2026-07-0', 'utf-8');

    const result = await readGatedSnapshot(root);
    expect(result).toEqual({ kind: 'unknown', why: 'unreadable' });
  });

  it('returns { kind: "unknown", why: "version" } for an unrecognized schemaVersion', async () => {
    await mkdir(daemonDir, { recursive: true });
    await writeFile(
      join(daemonDir, 'gated.json'),
      JSON.stringify({ schemaVersion: 999, writtenAt: 'x', repoWarnings: [], gated: [] }),
      'utf-8',
    );

    const result = await readGatedSnapshot(root);
    expect(result).toEqual({ kind: 'unknown', why: 'version' });
  });
});
