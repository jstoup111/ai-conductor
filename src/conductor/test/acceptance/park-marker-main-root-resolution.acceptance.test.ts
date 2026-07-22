/**
 * RED acceptance specs for "Park-Marker Main-Root Resolution" (#486,
 * .docs/stories/auto-park-markers-written-to-the-worktree-s-daemon.md;
 * adr-2026-07-10-park-marker-main-root-resolution.md).
 *
 * These drive the REAL production primitives against a REAL git repo with a
 * REAL linked worktree (`git worktree add`, no mocked git) — the exact shape
 * the daemon runs in: a build agent operating inside `.worktrees/<slug>`
 * while the daemon's own gates (`isOperatorParked`, `rekickSweep`) are bound
 * to the MAIN checkout root. The #486 regression is that `writeAutoPark`
 * wrote to the WORKTREE root while the sweep's gate read the MAIN root — two
 * different files, so a capped feature never actually parked from the
 * sweep's point of view and kept re-dispatching.
 *
 * `resolveMainRepoRoot` and `reconcileStrandedParkMarkers` do not exist yet
 * at RED time (plan Tasks 1, 13); `park-marker.ts` is loaded dynamically so a
 * missing export produces a genuine per-test FAILED result, not a
 * suite-level collection error — the same pattern as
 * test/acceptance/operator-park-rekick-sweep.acceptance.test.ts and
 * test/integration/autoresolve-worktree-lifecycle.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { rekickSweep, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';
import { checkAndAutoPark } from '../../src/engine/daemon-auto-park.js';
import {
  incrementNoEvidenceAttempts,
  readNoEvidenceAttempts,
} from '../../src/engine/task-evidence.js';
import { dispatchDaemonPark } from '../../src/engine/daemon-park-cli.js';

const execFile = promisify(execFileCb);

const PARK_MARKER_MOD = '../../src/engine/park-marker.js';

interface ParkMarkerModule {
  writeAutoPark: (root: string, slug: string, reason: string) => Promise<void>;
  isOperatorParked: (
    root: string,
    slug: string,
    logCallback?: (err: Error) => void,
  ) => Promise<boolean>;
  removeOperatorPark: (root: string, slug: string) => Promise<void>;
  getProvenanceType: (root: string, slug: string) => Promise<'auto' | 'operator' | null>;
  listOperatorParkedSlugs: (root: string) => Promise<string[]>;
  resolveMainRepoRoot: (startDir: string) => Promise<string>;
  reconcileStrandedParkMarkers: (mainRoot: string, log?: (msg: string) => void) => Promise<void>;
}

async function loadParkMarker(): Promise<ParkMarkerModule> {
  const mod = (await import(PARK_MARKER_MOD)) as Record<string, unknown>;
  for (const name of [
    'writeAutoPark',
    'isOperatorParked',
    'removeOperatorPark',
    'getProvenanceType',
    'listOperatorParkedSlugs',
    'resolveMainRepoRoot',
    'reconcileStrandedParkMarkers',
  ] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from park-marker.ts to be a function (not yet implemented)`,
      );
    }
  }
  return mod as unknown as ParkMarkerModule;
}

let mainRoot: string;

/** Real git repo + a real linked worktree at `<mainRoot>/.worktrees/<slug>`. */
async function initRepoWithWorktree(slug: string): Promise<string> {
  const g = (args: string[], cwd = mainRoot) => execFile('git', args, { cwd });
  await g(['init', '-q', '-b', 'main']);
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await g(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(mainRoot, 'README.md'), '# base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);
  await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
  const worktreeDir = join(mainRoot, '.worktrees', slug);
  await g(['worktree', 'add', '-b', `spec/${slug}`, worktreeDir, 'main']);
  return worktreeDir;
}

async function markerPathAt(root: string, slug: string): Promise<string> {
  return join(root, '.daemon', 'parked', slug);
}

async function fileExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

beforeEach(async () => {
  mainRoot = await mkdtemp(join(tmpdir(), 'park-main-root-'));
});

afterEach(async () => {
  await rm(mainRoot, { recursive: true, force: true });
});

/** Build RekickSweepDeps the way daemon-cli.ts binds them: isOperatorParked
 *  against the MAIN root, listing exactly the given slugs as "halted". */
function sweepDeps(opts: {
  slugs: string[];
  parkMarker: ParkMarkerModule;
  log?: (m: string) => void;
}): { deps: RekickSweepDeps; abortRebaseSpy: ReturnType<typeof vi.fn>; clearMarkerSpy: ReturnType<typeof vi.fn> } {
  const abortRebaseSpy = vi.fn(async () => {});
  const clearMarkerSpy = vi.fn(async () => {});
  const deps = {
    listHaltedWorktrees: async () => opts.slugs,
    readHaltReason: async () => 'reason',
    hasRebaseInProgress: async () => false,
    abortRebase: abortRebaseSpy,
    clearMarker: clearMarkerSpy,
    lastRekickSha: new Map<string, string>(),
    log: opts.log ?? (() => {}),
    isOperatorParked: (slug: string) => opts.parkMarker.isOperatorParked(mainRoot, slug),
  } as RekickSweepDeps;
  return { deps, abortRebaseSpy, clearMarkerSpy };
}

describe('park-marker main-root resolution acceptance (#486): worktree-written markers are visible to the main-root gate', () => {
  it('happy: writeAutoPark from a worktree root converges on the main root across every primitive (Story 2)', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('convergent-feat');

    await parkMarker.writeAutoPark(worktreeDir, 'convergent-feat', 'no completion evidence after 3 attempts');

    // Written under the MAIN root, not the worktree.
    expect(await fileExists(await markerPathAt(mainRoot, 'convergent-feat'))).toBe(true);
    expect(await fileExists(await markerPathAt(worktreeDir, 'convergent-feat'))).toBe(false);

    // Both roots read the same file.
    expect(await parkMarker.isOperatorParked(mainRoot, 'convergent-feat')).toBe(true);
    expect(await parkMarker.isOperatorParked(worktreeDir, 'convergent-feat')).toBe(true);

    // Provenance + listing resolve from the worktree root too.
    expect(await parkMarker.getProvenanceType(worktreeDir, 'convergent-feat')).toBe('auto');
    expect(await parkMarker.listOperatorParkedSlugs(worktreeDir)).toContain('convergent-feat');

    // Removal from the worktree root clears the main marker.
    await parkMarker.removeOperatorPark(worktreeDir, 'convergent-feat');
    expect(await parkMarker.isOperatorParked(mainRoot, 'convergent-feat')).toBe(false);
    expect(await fileExists(await markerPathAt(mainRoot, 'convergent-feat'))).toBe(false);
  });

  it('happy: a daemon feature capped inside a worktree is skipped by the SAME sweep the main-root daemon runs (Story 3, the #486 regression itself)', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('capped-feat');

    // Task 13/#773: the durable no-evidence counter park path was removed
    // — checkAndAutoPark now only parks when an explicit `reason` is
    // supplied (e.g. by the wall-clock/attempt-bound no-task-progress
    // halt). Drive that explicit-reason path instead of the retired
    // counter.
    const parkResult = await checkAndAutoPark(worktreeDir, 'capped-feat', {
      reason: 'build stalled: no task progress',
      daemon: true,
    });
    expect(parkResult.parked).toBe(true);
    expect(await fileExists(await markerPathAt(mainRoot, 'capped-feat'))).toBe(true);

    const log: string[] = [];
    const { deps, abortRebaseSpy, clearMarkerSpy } = sweepDeps({
      slugs: ['capped-feat'],
      parkMarker,
      log: (m) => log.push(m),
    });

    const result = await rekickSweep(deps, '1'.repeat(40));

    expect(result.skipped).toContain('capped-feat');
    expect(result.cleared).not.toContain('capped-feat');
    expect(log).toContain('re-kick capped-feat: skipped — operator-parked');
    expect(abortRebaseSpy).not.toHaveBeenCalled();
    expect(clearMarkerSpy).not.toHaveBeenCalled();
  });

  it('negative: an interactive (daemon:false) run at cap writes no marker at EITHER root, and the sweep does not skip it', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('interactive-feat');
    await incrementNoEvidenceAttempts(worktreeDir);
    await incrementNoEvidenceAttempts(worktreeDir);
    await incrementNoEvidenceAttempts(worktreeDir);

    const parkResult = await checkAndAutoPark(worktreeDir, 'interactive-feat', {
      maxAttempts: 3,
      daemon: false,
    });
    expect(parkResult.parked).toBe(false);
    expect(await fileExists(await markerPathAt(mainRoot, 'interactive-feat'))).toBe(false);
    expect(await fileExists(await markerPathAt(worktreeDir, 'interactive-feat'))).toBe(false);

    const { deps } = sweepDeps({ slugs: ['interactive-feat'], parkMarker });
    const result = await rekickSweep(deps, '1'.repeat(40));
    expect(result.skipped).not.toContain('interactive-feat');
  });

  it('negative: removing the park marker restores sweep eligibility on the very next sweep (no residual cached parked state)', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('unparked-again-feat');
    await parkMarker.writeAutoPark(worktreeDir, 'unparked-again-feat', 'no evidence');

    const first = await rekickSweep(sweepDeps({ slugs: ['unparked-again-feat'], parkMarker }).deps, '1'.repeat(40));
    expect(first.skipped).toContain('unparked-again-feat');

    await parkMarker.removeOperatorPark(mainRoot, 'unparked-again-feat');

    const second = await rekickSweep(sweepDeps({ slugs: ['unparked-again-feat'], parkMarker }).deps, '2'.repeat(40));
    expect(second.skipped).not.toContain('unparked-again-feat');
  });

  it('negative: a non-git temp root preserves byte-for-byte pre-#486 semantics (marker under <tmpRoot>/.daemon/parked)', async () => {
    const parkMarker = await loadParkMarker();
    const tmpRoot = await mkdtemp(join(tmpdir(), 'non-git-root-'));
    try {
      await parkMarker.writeAutoPark(tmpRoot, 'non-git-feat', 'no evidence');
      expect(await fileExists(await markerPathAt(tmpRoot, 'non-git-feat'))).toBe(true);
      expect(await parkMarker.isOperatorParked(tmpRoot, 'non-git-feat')).toBe(true);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('negative: concurrent writeAutoPark for the same slug from the worktree root AND the main root leaves exactly one marker and neither call throws', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('racy-feat');

    await expect(
      Promise.all([
        parkMarker.writeAutoPark(worktreeDir, 'racy-feat', 'reason A'),
        parkMarker.writeAutoPark(mainRoot, 'racy-feat', 'reason B'),
      ]),
    ).resolves.toBeDefined();

    expect(await fileExists(await markerPathAt(mainRoot, 'racy-feat'))).toBe(true);
    expect(await fileExists(await markerPathAt(worktreeDir, 'racy-feat'))).toBe(false);
  });
});

describe('park-marker main-root resolution acceptance (#486): stranded worktree markers self-heal (Story 6)', () => {
  it('happy: a pre-fix stranded marker under .worktrees/<slug>/.daemon/parked is moved to the main root, body preserved, and the SAME sweep skips it', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('stranded-feat');

    const strandedBody = 'auto-parked: no completion evidence after 3 attempts\ntimestamp: 2026-07-01T00:00:00.000Z\n';
    await mkdir(join(worktreeDir, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(worktreeDir, '.daemon', 'parked', 'stranded-feat'), strandedBody);

    const log: string[] = [];
    await parkMarker.reconcileStrandedParkMarkers(mainRoot, (m) => log.push(m));

    const mainBody = await readFile(await markerPathAt(mainRoot, 'stranded-feat'), 'utf-8');
    expect(mainBody).toBe(strandedBody);
    expect(await fileExists(await markerPathAt(worktreeDir, 'stranded-feat'))).toBe(false);

    const { deps } = sweepDeps({ slugs: ['stranded-feat'], parkMarker });
    const result = await rekickSweep(deps, '1'.repeat(40));
    expect(result.skipped).toContain('stranded-feat');
  });

  it('happy: reconciliation is idempotent — a second run finds nothing left to move', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('idempotent-feat');
    await mkdir(join(worktreeDir, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(worktreeDir, '.daemon', 'parked', 'idempotent-feat'), 'auto-parked: x\n');

    await parkMarker.reconcileStrandedParkMarkers(mainRoot);
    const bodyAfterFirst = await readFile(await markerPathAt(mainRoot, 'idempotent-feat'), 'utf-8');

    await expect(parkMarker.reconcileStrandedParkMarkers(mainRoot)).resolves.not.toThrow();
    const bodyAfterSecond = await readFile(await markerPathAt(mainRoot, 'idempotent-feat'), 'utf-8');
    expect(bodyAfterSecond).toBe(bodyAfterFirst);
  });

  it('negative: markers present at BOTH roots keep the main copy unchanged (first-writer-wins) and delete the worktree copy', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('both-roots-feat');

    const mainBody = 'auto-parked: main copy\ntimestamp: 2026-07-01T00:00:00.000Z\n';
    await mkdir(join(mainRoot, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(mainRoot, '.daemon', 'parked', 'both-roots-feat'), mainBody);
    await mkdir(join(worktreeDir, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(worktreeDir, '.daemon', 'parked', 'both-roots-feat'), 'auto-parked: worktree copy\n');

    await parkMarker.reconcileStrandedParkMarkers(mainRoot);

    expect(await readFile(await markerPathAt(mainRoot, 'both-roots-feat'), 'utf-8')).toBe(mainBody);
    expect(await fileExists(await markerPathAt(worktreeDir, 'both-roots-feat'))).toBe(false);
  });

  it('negative: one unreadable stranded marker among several is logged and skipped without blocking the others', async () => {
    const parkMarker = await loadParkMarker();
    const badDir = await initRepoWithWorktree('unreadable-feat');
    const goodDir = await initRepoWithWorktree('readable-feat');

    await mkdir(join(badDir, '.daemon', 'parked'), { recursive: true });
    const badMarker = join(badDir, '.daemon', 'parked', 'unreadable-feat');
    await writeFile(badMarker, 'auto-parked: x\n');
    await chmod(badMarker, 0o000);

    await mkdir(join(goodDir, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(goodDir, '.daemon', 'parked', 'readable-feat'), 'auto-parked: y\n');

    const log: string[] = [];
    try {
      await expect(parkMarker.reconcileStrandedParkMarkers(mainRoot, (m) => log.push(m))).resolves.not.toThrow();
    } finally {
      await chmod(badMarker, 0o644).catch(() => {});
    }

    expect(await fileExists(await markerPathAt(mainRoot, 'readable-feat'))).toBe(true);
    expect(log.some((l) => /unreadable-feat/.test(l))).toBe(true);
  });

  it('negative: a marker filename that differs from its worktree directory name is moved keyed by the FILENAME, not the worktree name', async () => {
    const parkMarker = await loadParkMarker();
    const worktreeDir = await initRepoWithWorktree('host-worktree');
    await mkdir(join(worktreeDir, '.daemon', 'parked'), { recursive: true });
    // Cross-slug stray: the marker filename ("other-slug") is not the
    // worktree's own name ("host-worktree").
    await writeFile(join(worktreeDir, '.daemon', 'parked', 'other-slug'), 'auto-parked: x\n');

    await parkMarker.reconcileStrandedParkMarkers(mainRoot);

    expect(await fileExists(await markerPathAt(mainRoot, 'other-slug'))).toBe(true);
    expect(await fileExists(await markerPathAt(mainRoot, 'host-worktree'))).toBe(false);
  });
});

describe('park-marker main-root resolution acceptance (#486): daemon park/unpark act on the resolved main root from a worktree cwd (Stories 4 & 5)', () => {
  it('happy: park from a worktree cwd writes the marker at the main root and echoes its absolute path', async () => {
    const worktreeDir = await initRepoWithWorktree('cli-park-feat');
    // Plan lives only at the worktree — validateSlug must pass against the RESOLVED root.

    const lines: string[] = [];
    const code = await dispatchDaemonPark(
      { kind: 'park', slug: 'cli-park-feat' },
      { cwd: worktreeDir, out: (l) => lines.push(l) },
    );

    expect(code).toBe(0);
    expect(await fileExists(await markerPathAt(mainRoot, 'cli-park-feat'))).toBe(true);
    const absMainMarker = await markerPathAt(mainRoot, 'cli-park-feat');
    expect(lines.some((l) => l.includes(absMainMarker))).toBe(true);
  });

  it('happy: unpark from a worktree cwd clears the marker at the resolved main root, and dispatch is eligible again (Task 13/#773: the no-evidence counter park path is retired — park now requires an explicit reason)', async () => {
    const worktreeDir = await initRepoWithWorktree('cli-unpark-feat');
    await checkAndAutoPark(worktreeDir, 'cli-unpark-feat', {
      reason: 'build stalled: no task progress',
      daemon: true,
    });
    expect(await fileExists(await markerPathAt(mainRoot, 'cli-unpark-feat'))).toBe(true);

    const lines: string[] = [];
    const code = await dispatchDaemonPark(
      { kind: 'unpark', slug: 'cli-unpark-feat' },
      { cwd: worktreeDir, out: (l) => lines.push(l) },
    );

    expect(code).toBe(0);
    expect(await fileExists(await markerPathAt(mainRoot, 'cli-unpark-feat'))).toBe(false);

    const parkResult = await checkAndAutoPark(worktreeDir, 'cli-unpark-feat', {
      daemon: true,
    });
    expect(parkResult.parked).toBe(false);
  });

  it('negative: a typo\'d slug from a worktree cwd exits 1 and writes nothing at either root', async () => {
    const worktreeDir = await initRepoWithWorktree('known-feat');

    const lines: string[] = [];
    const code = await dispatchDaemonPark(
      { kind: 'park', slug: 'typo-slug-that-does-not-exist' },
      { cwd: worktreeDir, out: (l) => lines.push(l) },
    );

    expect(code).toBe(1);
    expect(await fileExists(await markerPathAt(mainRoot, 'typo-slug-that-does-not-exist'))).toBe(false);
    expect(await fileExists(await markerPathAt(worktreeDir, 'typo-slug-that-does-not-exist'))).toBe(false);
  });
});
