import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-7
//
// RED acceptance specs for Story "Every discovery pass atomically rewrites the
// gated snapshot" (adr-2026-07-03-gated-snapshot-status-read-model). The
// module `src/engine/gated-snapshot.ts` does NOT exist yet (plan Tasks 11-13):
// no `writeGatedSnapshot`, no `.daemon/gated.json`, no temp+rename atomicity.
//
// This drives the REAL module via a dynamic import (it will not resolve until
// plan Task 11 lands), following the exact pattern used by
// `operator-park-dashboard-precedence.acceptance.test.ts` for `park-marker.ts`.
// Every test fails at `loadGatedSnapshot()` for the SAME clear reason
// (module/export not yet implemented) until the module exists — after which
// each test describes the real, intended multi-step behavior: an in-memory
// gated list flowing through the serializer into a real file on disk, read
// back with real fs.
// ─────────────────────────────────────────────────────────────────────────────

const GATED_SNAPSHOT_MOD = '../../src/engine/gated-snapshot.js';

interface GatedSpecEntry {
  kind: 'spec';
  slug: string;
  reason: 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';
  otherOwner?: string;
  remedy: string;
}
interface GatedRepoEntry {
  kind: 'repo';
  warning: 'identity-unresolved' | 'no-cutover';
  remedy: string;
}
type GatedEntry = GatedSpecEntry | GatedRepoEntry;

interface GatedSnapshotState {
  gated: GatedEntry[];
}

interface GatedSnapshotModule {
  writeGatedSnapshot: (
    daemonDir: string,
    state: GatedSnapshotState,
    clock: () => Date,
  ) => Promise<void>;
  readGatedSnapshot: (daemonDir: string) => Promise<unknown>;
}

async function loadGatedSnapshot(): Promise<GatedSnapshotModule> {
  const mod = (await import(GATED_SNAPSHOT_MOD)) as Record<string, unknown>;
  for (const name of ['writeGatedSnapshot', 'readGatedSnapshot'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from gated-snapshot.ts to be a function (not yet implemented)`,
      );
    }
  }
  return mod as unknown as GatedSnapshotModule;
}

let daemonDir: string;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-gate-snapshot-'));
  daemonDir = join(root, '.daemon');
  await mkdir(daemonDir, { recursive: true });
});

afterEach(async () => {
  await rm(join(daemonDir, '..'), { recursive: true, force: true });
});

const FIXED_CLOCK = () => new Date('2026-07-05T12:00:00.000Z');

describe('owner-gate gated-snapshot atomic write acceptance (Covers: FR-7)', () => {
  it('a pass with 2 gated specs + 1 repo warning writes .daemon/gated.json with schemaVersion, writtenAt, and both channels', async () => {
    const mod = await loadGatedSnapshot();

    const state: GatedSnapshotState = {
      gated: [
        { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
        { kind: 'spec', slug: 'bar', reason: 'unowned-post-cutover', remedy: 'add Owner: marker' },
        { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover' },
      ],
    };

    await mod.writeGatedSnapshot(daemonDir, state, FIXED_CLOCK);

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.writtenAt).toBe('2026-07-05T12:00:00.000Z');
    expect(parsed.gated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'foo', reason: 'other-owner', otherOwner: 'alice' }),
        expect.objectContaining({ slug: 'bar', reason: 'unowned-post-cutover' }),
      ]),
    );
    expect(parsed.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'no-cutover' })]),
    );
  });

  it('a spec gated last pass that gained an Owner: stamp is absent from the NEXT snapshot (whole-file rewrite, no cleanup code path)', async () => {
    const mod = await loadGatedSnapshot();

    await mod.writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'stale-gated', reason: 'unowned-indeterminate', remedy: 'set cutover' }] },
      FIXED_CLOCK,
    );
    let raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    expect(JSON.parse(raw).gated.some((g: { slug?: string }) => g.slug === 'stale-gated')).toBe(true);

    // Next pass: the spec now resolves ownership and is no longer gated.
    await mod.writeGatedSnapshot(daemonDir, { gated: [] }, () => new Date('2026-07-05T12:05:00.000Z'));
    raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.gated).toEqual([]);
    expect(parsed.gated.some((g: { slug?: string }) => g.slug === 'stale-gated')).toBe(false);
    expect(parsed.writtenAt).toBe('2026-07-05T12:05:00.000Z');
  });

  it('a pass with ZERO gated specs still rewrites an explicit empty snapshot with a fresh writtenAt (a stale unchanged file is a failure)', async () => {
    const mod = await loadGatedSnapshot();

    await mod.writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'was-gated', reason: 'other-owner', otherOwner: 'x', remedy: 'r' }] },
      FIXED_CLOCK,
    );

    const later = () => new Date('2026-07-05T13:00:00.000Z');
    await mod.writeGatedSnapshot(daemonDir, { gated: [] }, later);

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.gated).toEqual([]);
    expect(parsed.writtenAt).toBe('2026-07-05T13:00:00.000Z');
  });

  it('the identity-unresolved early return (no per-spec scan ran) still writes a snapshot carrying the repo warning and an empty gated list', async () => {
    const mod = await loadGatedSnapshot();

    // Mirrors the fail-closed early-return shape from daemon-backlog.ts: only a
    // repo-scoped entry, no per-spec entries (no scan ran this pass).
    await mod.writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'repo', warning: 'identity-unresolved', remedy: 'authenticate gh' }] },
      FIXED_CLOCK,
    );

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'identity-unresolved' })]),
    );
    expect(parsed.gated).toEqual([]);
  });

  it('concurrent writes never leave a torn/partial file: after two overlapping passes complete, the file always parses as one complete, valid snapshot', async () => {
    const mod = await loadGatedSnapshot();

    const passA = mod.writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'from-pass-a', reason: 'other-owner', otherOwner: 'a', remedy: 'r' }] },
      () => new Date('2026-07-05T14:00:00.000Z'),
    );
    const passB = mod.writeGatedSnapshot(
      daemonDir,
      { gated: [{ kind: 'spec', slug: 'from-pass-b', reason: 'other-owner', otherOwner: 'b', remedy: 'r' }] },
      () => new Date('2026-07-05T14:00:01.000Z'),
    );
    await Promise.all([passA, passB]);

    // Whichever pass "won" the rename race, the file must be one complete,
    // parseable JSON document — never a half-written interleaving of both.
    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw); // throws (fails the test) on any torn/partial content
    expect(parsed.gated).toHaveLength(1);
    expect(['from-pass-a', 'from-pass-b']).toContain(parsed.gated[0].slug);
  });

  it('a snapshot write failure (unwritable .daemon/ directory) is logged and swallowed — never throws, never blocks the caller', async () => {
    const mod = await loadGatedSnapshot();

    const unwritableDir = join(daemonDir, 'does-not-exist', 'nested');
    // No mkdir for `unwritableDir` — the writer must handle a missing parent
    // directory as an advisory failure, not a thrown exception that would
    // abort the discovery pass (FR-12-style advisory semantics, mirrored here
    // for snapshot writes per the story's negative path).
    let threw = false;
    try {
      await mod.writeGatedSnapshot(unwritableDir, { gated: [] }, FIXED_CLOCK);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
