// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires the REAL `isOperatorParked` (park-marker.ts) into the
// re-kick sweep's deps object (Task 6, operator-park-a-human-placed-halt-
// must-survive-the, FR-2 happy: sweeps across restarts honor the marker).
//
// `RekickSweepDeps.isOperatorParked` is optional and, when present, is
// consulted FIRST in `rekickSweep` (see daemon-rekick.ts) — but that only
// matters in production if `daemon-cli.ts` actually threads the real
// `park-marker.ts` primitive into the deps object passed to `rekickSweep`.
// This is an integration-level source-assembly check (mirrors the
// single-writer invariant check for operator-park elsewhere in this plan):
// it drives the actual `rekickDeps` object literal wired in `daemon-cli.ts`
// against real fs fixtures, proving the production wiring — not just that
// `rekickSweep` itself honors the field (already covered by
// `daemon-rekick.test.ts` / the operator-park rekick-sweep acceptance spec).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('Task 6 — daemon-cli wires the real isOperatorParked dep into the re-kick sweep', () => {
  it('imports isOperatorParked from park-marker.ts and wires it into the rekickDeps object', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // 1. The real production primitive is imported from park-marker.ts.
    // Allow for other imports in the same statement (e.g., reconcileStrandedParkMarkers).
    expect(source).toMatch(
      /import\s*\{[^}]*isOperatorParked[^}]*\}\s*from\s*['"]\.\/engine\/park-marker\.js['"]/,
    );

    // 2. The rekickDeps object assembled for rekickSweep includes an
    //    `isOperatorParked` field that calls the imported primitive.
    const rekickDepsMatch = source.match(
      /const rekickDeps:\s*RekickSweepDeps\s*=\s*\{([\s\S]*?)\n\s*\};/,
    );
    expect(rekickDepsMatch, 'expected a `rekickDeps: RekickSweepDeps = { ... }` block').toBeTruthy();
    const rekickDepsBody = rekickDepsMatch![1];

    expect(rekickDepsBody).toMatch(/isOperatorParked\s*:/);
    expect(rekickDepsBody).toMatch(/isOperatorParked\(/);
  });

  it('the real isOperatorParked primitive is callable and returns a boolean against real fs fixtures', async () => {
    const { isOperatorParked, writeOperatorPark } = (await import(
      '../../src/engine/park-marker.js'
    )) as {
      isOperatorParked: (root: string, slug: string, cb?: (e: Error) => void) => Promise<boolean>;
      writeOperatorPark: (root: string, slug: string) => Promise<void>;
    };

    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-cli-park-wiring-'));
    try {
      expect(await isOperatorParked(projectRoot, 'never-parked')).toBe(false);

      await writeOperatorPark(projectRoot, 'parked-feat');
      expect(await isOperatorParked(projectRoot, 'parked-feat')).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('Task 5 — daemon-cli wires the real readHaltClass dep into the re-kick sweep', () => {
  it('imports readHaltClass from halt-marker.ts and wires it into the rekickDeps object', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // 1. The real production primitive is imported from halt-marker.ts.
    expect(source).toMatch(
      /import\s*\{[^}]*readHaltClass[^}]*\}\s*from\s*['"]\.\/engine\/halt-marker\.js['"]/,
    );

    // 2. The rekickDeps object assembled for rekickSweep includes a
    //    `readHaltClass` field that calls the imported primitive.
    const rekickDepsMatch = source.match(
      /const rekickDeps:\s*RekickSweepDeps\s*=\s*\{([\s\S]*?)\n\s*\};/,
    );
    expect(rekickDepsMatch, 'expected a `rekickDeps: RekickSweepDeps = { ... }` block').toBeTruthy();
    const rekickDepsBody = rekickDepsMatch![1];

    expect(rekickDepsBody).toMatch(/readHaltClass\s*:/);
    expect(rekickDepsBody).toMatch(/readHaltClass\(/);
  });

  it('the real readHaltClass primitive resolves to "unclassified" against a fresh fixture worktree', async () => {
    const { readHaltClass } = (await import('../../src/engine/halt-marker.js')) as {
      readHaltClass: (worktreePath: string) => Promise<'needs-human' | 'mechanical' | 'unclassified'>;
    };

    const worktreePath = await mkdtemp(join(tmpdir(), 'daemon-cli-halt-class-wiring-'));
    try {
      expect(await readHaltClass(worktreePath)).toBe('unclassified');

      await mkdir(join(worktreePath, '.pipeline'), { recursive: true });
      await writeFile(join(worktreePath, '.pipeline', 'HALT.class'), 'needs-human\n', 'utf-8');
      expect(await readHaltClass(worktreePath)).toBe('needs-human');
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 20 — sealed Story 3 requires EVERY automatic path (base-advance sweep,
// progress re-kick, episode-end sweep) to retain a classified human halt with
// no resume authorization. These drive the two paths the base-advance sweep
// does not own, against real `.pipeline/HALT.class` fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 20 — the progress re-kick predicate retains classified human halts', () => {
  const RETAINED = ['needs-human', 'plan-gap', 'kickback-cap', 'over-scope'];

  async function seedProgress(
    worktreeBase: string,
    slug: string,
    haltClass: string | undefined,
  ): Promise<void> {
    const pipeline = join(worktreeBase, slug, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'HALT'), 'halted\n', 'utf-8');
    if (haltClass !== undefined) await writeFile(join(pipeline, 'HALT.class'), haltClass, 'utf-8');
    // Forward progress: two resolved tasks against a stamped baseline of zero.
    await writeFile(
      join(pipeline, 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }] }),
      'utf-8',
    );
    await writeFile(
      join(pipeline, 'task-evidence.json'),
      JSON.stringify({ lastResolvedCount: 0 }),
      'utf-8',
    );
  }

  it.each(RETAINED)('returns false for a %s halt even with forward task progress', async (haltClass) => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-retain-'));
    try {
      await seedProgress(worktreeBase, 'feat', haltClass);
      const deps = buildProgressReKickDeps({ build_progress_halt: { enabled: true } } as never, worktreeBase);
      expect(await deps.isProgressReKickEligible!('feat')).toBe(false);
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  // An ABSENT sidecar is the one case that differs from the base-advance sweep:
  // the progress path exists precisely to recover halts written without a
  // class, and sealed Story 3 names four CLASSES, not the absence of one.
  it('still returns true when the class sidecar is absent', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-unreadable-'));
    try {
      await seedProgress(worktreeBase, 'feat', undefined);
      const deps = buildProgressReKickDeps({ build_progress_halt: { enabled: true } } as never, worktreeBase);
      expect(await deps.isProgressReKickEligible!('feat')).toBe(true);
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('still returns true for a mechanical halt with forward progress', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-mechanical-'));
    try {
      await seedProgress(worktreeBase, 'feat', 'mechanical');
      const deps = buildProgressReKickDeps({ build_progress_halt: { enabled: true } } as never, worktreeBase);
      expect(await deps.isProgressReKickEligible!('feat')).toBe(true);
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });
});

describe('Task 20 — episode-end recovery shares the retention predicate', () => {
  it('leaves a needs-human halt in place and still clears a mechanical one', async () => {
    const { recoverEpisodeHalts } = await import('../../src/engine/daemon-rekick.js');
    const cleared: string[] = [];
    const classes: Record<string, string> = { human: 'needs-human', broken: 'mechanical' };
    const result = await recoverEpisodeHalts({
      stampedHalts: async () => ['human', 'broken'],
      readHaltClass: async (slug) => classes[slug] as never,
      clearMarker: async (slug) => { cleared.push(slug); },
    });
    expect(cleared).toEqual(['broken']);
    expect(result).toEqual(['broken']);
  });

  it('leaves an operator-parked slug alone before it even reads the class', async () => {
    const { recoverEpisodeHalts } = await import('../../src/engine/daemon-rekick.js');
    const cleared: string[] = [];
    let classReads = 0;
    await recoverEpisodeHalts({
      stampedHalts: async () => ['parked'],
      isOperatorParked: async () => true,
      readHaltClass: async () => { classReads += 1; return 'mechanical'; },
      clearMarker: async (slug) => { cleared.push(slug); },
    });
    expect(cleared).toEqual([]);
    expect(classReads).toBe(0);
  });

  it('retains a halt whose class sidecar read throws (fails closed)', async () => {
    const { recoverEpisodeHalts } = await import('../../src/engine/daemon-rekick.js');
    const cleared: string[] = [];
    await recoverEpisodeHalts({
      stampedHalts: async () => ['unreadable'],
      readHaltClass: async () => { throw new Error('EACCES'); },
      clearMarker: async (slug) => { cleared.push(slug); },
    });
    expect(cleared).toEqual([]);
  });
});

describe('Task 20 — daemon-cli wires both paths through the shared predicate', () => {
  it('the episode-end sweep delegates to recoverEpisodeHalts with the real class reader', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
    const sweep = source.match(/sweepEpisodeHalts:\s*async\s*\([\s\S]*?\n\s{6}\},/);
    expect(sweep, 'expected a sweepEpisodeHalts binding').toBeTruthy();
    expect(sweep![0]).toMatch(/recoverEpisodeHalts\(/);
    expect(sweep![0]).toMatch(/readHaltClass:\s*\(slug\)\s*=>\s*readRawHaltClass\(/);
  });

  it('the progress re-kick predicate consults resolveHaltRetention', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
    const predicate = source.match(/isProgressReKickEligible:\s*async\s*\(slug: string\)[\s\S]*?\n {4}\},/);
    expect(predicate, 'expected an isProgressReKickEligible binding').toBeTruthy();
    expect(predicate![0]).toMatch(/resolveHaltRetention\(/);
  });
});
