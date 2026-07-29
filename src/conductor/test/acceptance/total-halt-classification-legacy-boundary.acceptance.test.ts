import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HALT_CLEARED_MARKER,
  HALT_MARKER,
  REKICK_SENTINEL,
  clearMarker,
  listHaltedWorktrees,
  readHaltReason,
  rekickSweep,
  type RekickSweepDeps,
} from '../../src/engine/daemon-rekick.js';
import {
  HALT_CLASS_MARKER,
  readHaltClass,
} from '../../src/engine/halt-marker.js';

// Acceptance coverage for:
// .docs/stories/most-conductor-halts-carry-no-class-sidecar-so-the.md
//
// Story 2 is exercised as the real migration -> persisted marker -> real sweep
// flow. Story 3 is exercised through every real filesystem call site used by
// the sweep. Story 1's type/integrity authoring gates and Story 4's interrupted
// writer ordering are single-operation contracts owned by the lower-layer
// tests named in plan Tasks 1 and 17. Story 4's canonical clear lifecycle is
// covered here because it participates directly in the sweep flow.
//
// The migration module does not exist at RED time, so it is loaded dynamically.
// This lets Vitest execute the specs and report the missing production boundary
// as the intended failure instead of failing test collection.

const HALT_MIGRATION_MOD = '../../src/engine/halt-class-migration.js';
const MIGRATION_WATERMARK = '.daemon/migrations/halt-classification-v1';
const SHA = 'a'.repeat(40);

type MigrateLegacyHaltClasses = (
  projectRoot: string,
  worktreeBase: string,
  log?: (message: string) => void,
) => Promise<void>;

async function loadMigration(): Promise<MigrateLegacyHaltClasses> {
  const mod = (await import(HALT_MIGRATION_MOD)) as Record<string, unknown>;
  const migrate = mod.migrateLegacyHaltClasses;
  if (typeof migrate !== 'function') {
    throw new Error(
      'expected export "migrateLegacyHaltClasses" to be a function (not yet implemented)',
    );
  }
  return migrate as MigrateLegacyHaltClasses;
}

let projectRoot: string;
let worktreeBase: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'halt-class-boundary-root-'));
  worktreeBase = await mkdtemp(join(tmpdir(), 'halt-class-boundary-worktrees-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(worktreeBase, { recursive: true, force: true });
});

async function seedHalt(
  slug: string,
  haltClass?: string,
): Promise<void> {
  const worktree = join(worktreeBase, slug);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, HALT_MARKER), `halted: ${slug}\n`, 'utf-8');
  if (haltClass !== undefined) {
    await writeFile(join(worktree, HALT_CLASS_MARKER), haltClass, 'utf-8');
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

function marker(slug: string, name: string): string {
  return join(worktreeBase, slug, '.pipeline', name);
}

function realSweepDeps(log: string[]): {
  deps: RekickSweepDeps;
  abortRebase: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  const abortRebase = vi.fn(async (_slug: string) => {});
  const clear = vi.fn(async (slug: string) => clearMarker(join(worktreeBase, slug)));
  const deps: RekickSweepDeps = {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress: async () => false,
    abortRebase,
    clearMarker: clear,
    lastRekickSha: new Map(),
    log: (message) => log.push(message),
    readHaltClass: (slug) => readHaltClass(join(worktreeBase, slug)),
  };
  return { deps, abortRebase, clear };
}

describe('total HALT classification acceptance: explicit legacy boundary and fail-closed sweep', () => {
  it('upgrades only pre-boundary classless HALTs, records completion, then retries legacy and mechanical while retaining needs-human', async () => {
    await seedHalt('historical-bare');
    await seedHalt('already-mechanical', 'mechanical');
    await seedHalt('already-human', 'needs-human');

    const migrate = await loadMigration();
    const migrationLog: string[] = [];
    await migrate(projectRoot, worktreeBase, (message) => migrationLog.push(message));

    await expect(readFile(marker('historical-bare', 'HALT.class'), 'utf-8')).resolves.toBe(
      'legacy',
    );
    await expect(readFile(marker('already-mechanical', 'HALT.class'), 'utf-8')).resolves.toBe(
      'mechanical',
    );
    await expect(readFile(marker('already-human', 'HALT.class'), 'utf-8')).resolves.toBe(
      'needs-human',
    );
    expect(await exists(join(projectRoot, MIGRATION_WATERMARK))).toBe(true);

    const sweepLog: string[] = [];
    const { deps } = realSweepDeps(sweepLog);
    const result = await rekickSweep(deps, SHA);

    expect(result.cleared.sort()).toEqual(['already-mechanical', 'historical-bare']);
    expect(result.skipped).toEqual(['already-human']);
    expect(await exists(marker('historical-bare', 'REKICK'))).toBe(true);
    expect(await exists(marker('already-mechanical', 'REKICK'))).toBe(true);
    expect(await exists(marker('already-human', 'HALT'))).toBe(true);
    expect(sweepLog.some((line) => /historical-bare/.test(line) && /legacy/.test(line))).toBe(true);
    expect(sweepLog.some((line) => /already-human/.test(line) && /needs-human/.test(line))).toBe(
      true,
    );
  });

  it('does not bless a bare or malformed HALT created after the compatibility watermark and performs no retry side effects', async () => {
    const migrate = await loadMigration();
    await migrate(projectRoot, worktreeBase);
    expect(await exists(join(projectRoot, MIGRATION_WATERMARK))).toBe(true);

    await seedHalt('post-boundary-bare');
    await seedHalt('post-boundary-unknown', 'retry-me');

    // A later startup observes the completed boundary and must not reinterpret
    // either current malformed marker as historical state.
    await migrate(projectRoot, worktreeBase);

    const log: string[] = [];
    const { deps, abortRebase, clear } = realSweepDeps(log);
    const result = await rekickSweep(deps, SHA);

    expect(result.cleared).toEqual([]);
    expect(result.skipped.sort()).toEqual(['post-boundary-bare', 'post-boundary-unknown']);
    expect(abortRebase).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(deps.lastRekickSha.size).toBe(0);

    for (const slug of ['post-boundary-bare', 'post-boundary-unknown']) {
      expect(await exists(marker(slug, 'HALT'))).toBe(true);
      expect(await exists(marker(slug, 'HALT.cleared'))).toBe(false);
      expect(await exists(marker(slug, 'REKICK'))).toBe(false);
      expect(log.some((line) => line.includes(slug) && line.includes('unclassified'))).toBe(true);
    }
  });

  it('applies the complete persisted-disposition matrix through the real sweep call site', async () => {
    await seedHalt('mechanical', 'mechanical');
    await seedHalt('legacy', 'legacy');
    await seedHalt('needs-human', 'needs-human');
    await seedHalt('missing');
    await seedHalt('empty', '');
    await seedHalt('unknown', 'something-else');

    const log: string[] = [];
    const { deps, abortRebase, clear } = realSweepDeps(log);
    const result = await rekickSweep(deps, SHA);

    expect(result.cleared.sort()).toEqual(['legacy', 'mechanical']);
    expect(result.skipped.sort()).toEqual(['empty', 'missing', 'needs-human', 'unknown']);
    expect(abortRebase).not.toHaveBeenCalled();
    expect(clear.mock.calls.map(([slug]) => slug).sort()).toEqual(['legacy', 'mechanical']);
    expect([...deps.lastRekickSha.keys()].sort()).toEqual(['legacy', 'mechanical']);

    for (const slug of ['empty', 'missing', 'needs-human', 'unknown']) {
      expect(await exists(marker(slug, 'HALT'))).toBe(true);
      expect(await exists(marker(slug, 'HALT.cleared'))).toBe(false);
      expect(await exists(marker(slug, 'REKICK'))).toBe(false);
      expect(log.some((line) => line.includes(slug))).toBe(true);
    }
  });

  it('clears the HALT body and class together and remains harmless when cleanup repeats', async () => {
    await seedHalt('clear-twice', 'mechanical');

    await clearMarker(join(worktreeBase, 'clear-twice'));
    await clearMarker(join(worktreeBase, 'clear-twice'));

    expect(await exists(marker('clear-twice', 'HALT'))).toBe(false);
    expect(await exists(marker('clear-twice', 'HALT.class'))).toBe(false);
    expect(await exists(marker('clear-twice', 'HALT.cleared'))).toBe(true);
    expect(await exists(marker('clear-twice', 'REKICK'))).toBe(true);
    await expect(readFile(marker('clear-twice', 'REKICK'), 'utf-8')).resolves.toBe('rekick\n');
  });
});
