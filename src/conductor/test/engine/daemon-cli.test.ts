// ─────────────────────────────────────────────────────────────────────────────
// Task 12 (adr-2026-07-03-gated-snapshot-status-read-model): the daemon must
// write `.daemon/gated.json` on EVERY discovery pass — populated, explicitly
// empty, and the identity-unresolved early-return alike.
//
// daemon-cli.ts wires this via `localWorkSource`'s `onGatedDiscovered` hook
// (daemon-work-source.ts): `discover()` invokes it with the exact `gated`
// list `discoverBacklog` computed, on every pass, BEFORE priority ordering
// runs. This drives that hook exactly the way daemon-cli.ts wires it —
// `(gated) => writeGatedSnapshot(daemonDir, { gated })` — against the REAL
// `gated-snapshot.ts` writer and a real temp directory, so these specs cover
// the actual single call site rather than a re-implementation of it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { localWorkSource, type LocalWorkSourceDeps } from '../../src/engine/daemon-work-source.js';
import { writeGatedSnapshot } from '../../src/engine/gated-snapshot.js';
import type { ConductState } from '../../src/types/index.js';
import { writeState } from '../../src/engine/state.js';

let daemonDir: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'daemon-cli-gated-snapshot-'));
  daemonDir = join(root, '.daemon');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<LocalWorkSourceDeps> = {}): LocalWorkSourceDeps {
  return {
    projectRoot: root,
    baseBranch: 'main',
    log: vi.fn(),
    isProcessed: vi.fn().mockResolvedValue(false),
    hasWarned: vi.fn().mockResolvedValue(false),
    markWarned: vi.fn().mockResolvedValue(undefined),
    fastForwardRoot: vi.fn().mockResolvedValue(undefined),
    discoverBacklog: vi.fn(),
    // The exact wiring daemon-cli.ts installs at its single call site.
    onGatedDiscovered: (gated) => writeGatedSnapshot(daemonDir, { gated }),
    ...overrides,
  } as LocalWorkSourceDeps;
}

describe('daemon-cli discover-path gated snapshot wiring (Task 12)', () => {
  it('a pass with 2 gated + 1 warning writes a full snapshot', async () => {
    const deps = baseDeps({
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [{ slug: 'buildable' } satisfies BacklogItem],
        waiting: [],
        gated: [
          { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
          { kind: 'spec', slug: 'bar', reason: 'unowned-post-cutover', remedy: 'add Owner: marker' },
          { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover' },
        ],
      }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.gated).toHaveLength(2);
    expect(parsed.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'no-cutover' })]),
    );
  });

  it('the NEXT pass with zero gated overwrites the stale file with an explicit empty snapshot and a fresh writtenAt', async () => {
    const deps = baseDeps({
      discoverBacklog: vi
        .fn()
        .mockResolvedValueOnce({
          items: [],
          waiting: [],
          gated: [{ kind: 'spec', slug: 'stale-gated', reason: 'unowned-indeterminate', remedy: 'set cutover' }],
        })
        .mockResolvedValueOnce({ items: [], waiting: [], gated: [] }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });
    const firstRaw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(firstRaw.gated).toHaveLength(1);
    const firstWrittenAt = firstRaw.writtenAt;

    // Ensure a distinguishable clock tick between passes.
    await new Promise((r) => setTimeout(r, 5));

    await source.discover({ refresh: false });
    const secondRaw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(secondRaw.gated).toEqual([]);
    expect(secondRaw.writtenAt).not.toBe(firstWrittenAt);
  });

  it('the identity-unresolved early return (repo warning, empty gated) still writes a snapshot', async () => {
    const deps = baseDeps({
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [],
        waiting: [],
        gated: [{ kind: 'repo', warning: 'identity-unresolved', remedy: 'authenticate gh' }],
      }),
    });

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });

    const raw = JSON.parse(await readFile(join(daemonDir, 'gated.json'), 'utf-8'));
    expect(raw.gated).toEqual([]);
    expect(raw.repoWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ warning: 'identity-unresolved' })]),
    );
  });

  it('Task 13: a snapshot write failure (unwritable .daemon/) is advisory — discover() still resolves with the full item list and never throws', async () => {
    const blockerFile = join(root, 'blocker-file');
    await (await import('node:fs/promises')).writeFile(blockerFile, 'x');
    // Point the snapshot sink at a directory whose parent is a plain file, so
    // `mkdir(daemonDir, { recursive: true })` inside writeGatedSnapshot can
    // never succeed — mirrors the real "unwritable .daemon/" negative path.
    const unwritableDaemonDir = join(blockerFile, 'nested', '.daemon');

    const deps = baseDeps({
      onGatedDiscovered: (gated) => writeGatedSnapshot(unwritableDaemonDir, { gated }),
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [{ slug: 'buildable' } satisfies BacklogItem],
        waiting: [],
        gated: [
          { kind: 'spec', slug: 'foo', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare owner' },
        ],
      }),
    });

    const source = localWorkSource(deps);
    const items = await source.discover({ refresh: false });

    // Discovery/dispatch is entirely unaffected by the snapshot failure: the
    // scan result (and thus dashboard/dispatch consumption of it) proceeds
    // exactly as if the sink were unwired.
    expect(items).toEqual([{ slug: 'buildable' }]);
  });

  it('Task 13: concurrent writes never produce a torn/partial gated.json — the file always parses as one complete snapshot from either pass', async () => {
    const deps = baseDeps();
    // Fire two overlapping discover() passes against the SAME daemonDir; the
    // atomic temp+rename write in gated-snapshot.ts must ensure a concurrent
    // reader can only ever observe one complete file, never an interleaving
    // of both writers' bytes.
    (deps.discoverBacklog as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [],
        waiting: [],
        gated: [{ kind: 'spec', slug: 'from-pass-a', reason: 'other-owner', otherOwner: 'a', remedy: 'r' }],
      })
      .mockResolvedValueOnce({
        items: [],
        waiting: [],
        gated: [{ kind: 'spec', slug: 'from-pass-b', reason: 'other-owner', otherOwner: 'b', remedy: 'r' }],
      });
    const source = localWorkSource(deps);

    const passA = source.discover({ refresh: false });
    const passB = source.discover({ refresh: false });
    await Promise.all([passA, passB]);

    const raw = await readFile(join(daemonDir, 'gated.json'), 'utf-8');
    const parsed = JSON.parse(raw); // throws (fails the test) on any torn/partial content
    expect(parsed.gated).toHaveLength(1);
    expect(['from-pass-a', 'from-pass-b']).toContain(parsed.gated[0].slug);
  });

  it('daemon-cli.ts wires onGatedDiscovered to writeGatedSnapshot at a single call site in localWorkSource construction', () => {
    // Static wiring check: guards against the call site being silently
    // dropped/duplicated in a future refactor of daemon-cli.ts.
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');
    const matches = src.match(/onGatedDiscovered:/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(src).toContain('writeGatedSnapshot(daemonDir, { gated })');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 22: Process-level SIGTERM in daemon-cli; per-conductor stays
// interactive-only (RED then GREEN)
//
// Story: "In-flight rate-limit wait is interruptible + SIGTERM-responsive"
// — N>1 negative paths (ADR 12)
//
// RED specs: These tests fail without the Task 22 implementation
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 22: Process-level SIGTERM handler in daemon-cli', () => {
  it('daemon-cli.ts source code has process-level SIGTERM handler wiring', () => {
    // Static check: daemon-cli.ts must wire ONE process-level handler that
    // aborts all in-flight waits, awaits state saves, then exits.
    const src = readFileSync(
      join(__dirname, '../../src/daemon-cli.ts'),
      'utf-8'
    );

    // Verify daemon-cli has the allWaitSignals tracking set
    expect(src).toContain('allWaitSignals');
    // Verify daemon-cli installs process-level SIGTERM handler
    expect(src).toContain(`process.on('SIGTERM'`);
    // Verify the handler aborts in-flight waits
    expect(src).toContain('abort()');
  });

  it('conductor.ts per-conductor SIGTERM handler is scoped to interactive mode only', () => {
    // Task 11 added per-conductor SIGTERM in conductor.ts.
    // Task 22 requirement: scope it to interactive mode only, so daemon path
    // uses the process-level handler (one per daemon) instead of N per-conductor handlers.
    const src = readFileSync(
      join(__dirname, '../../src/engine/conductor.ts'),
      'utf-8'
    );

    // Verify scoping: per-conductor handler should only be installed when NOT daemon mode
    // Look for the mode check guarding the per-conductor SIGTERM handler
    expect(src).toContain("!this.daemon");
    expect(src).toContain("process.on('SIGTERM'");
  });

  it('daemon-cli tracks conductor-level AbortController references for process-level handler', () => {
    // The daemon-cli process-level handler must be able to abort all in-flight
    // rate-limit waits across N concurrent conductors. This requires tracking
    // AbortControllers at the daemon process level (not per-conductor).
    const src = readFileSync(
      join(__dirname, '../../src/daemon-cli.ts'),
      'utf-8'
    );

    // Daemon must have a mechanism to collect AbortSignals/Controllers from conductors
    // so the process-level handler can abort them all on SIGTERM
    expect(src).toContain('allWaitSignals');
  });

  it('per-conductor handler installs only in interactive mode', async () => {
    // When daemon=false (interactive), per-conductor handler should be installed.
    // When daemon=true, per-conductor handler should be skipped (process-level handles it).
    // This guards against N redundant handlers in daemon mode.

    const dir = await mkdtemp(join(tmpdir(), 'conductor-interactive-test-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');

    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });

      // Verify the guard condition exists in source
      const src = readFileSync(
        join(__dirname, '../../src/engine/conductor.ts'),
        'utf-8'
      );

      // The handler should be guarded by: if (!this.daemon)
      expect(src).toContain('if (!this.daemon)');
      expect(src).toMatch(/if\s*\(\s*!this\.daemon\s*\)\s*\{[\s\S]*?process\.on\('SIGTERM'/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 21 (adr-2026-07-03-gate-writeback-daemon-tick): the daemon tick must
  // also announce every owner-gated spec on its implementation PR (Task 17-19)
  // and its originating Source-Ref issue (Task 20) — not just snapshot the
  // gated list. Static wiring check mirroring the Task 12 guard above: real
  // end-to-end coverage of the underlying `gh` calls already lives in
  // gate-writeback.test.ts / owner-gate-pr-writeback.acceptance.test.ts /
  // owner-gate-issue-writeback.acceptance.test.ts — this only pins the
  // single call site in daemon-cli.ts so a future refactor can't silently
  // drop the wiring.
  // ───────────────────────────────────────────────────────────────────────────
  it('daemon-cli.ts wires announceGatedPr and announceGatedIssue exactly once each, imported from gate-writeback.js', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');
    expect(src).toContain("import { announceGatedPr, announceGatedIssue } from './engine/gate-writeback.js';");
    expect(src.match(/announceGatedPr\(/g) ?? []).toHaveLength(1);
    expect(src.match(/announceGatedIssue\(/g) ?? []).toHaveLength(1);
  });

  it('the gated write-back announcer skips specs cleanly when no PR/state exists on disk (never throws, never calls gh)', async () => {
    const { announceGatedPr, announceGatedIssue } = await import('../../src/engine/gate-writeback.js');
    const logs: string[] = [];
    const entry = {
      kind: 'spec' as const,
      slug: 'never-built-slug',
      reason: 'other-owner' as const,
      otherOwner: 'alice',
      remedy: 'declare an owner',
    };
    // No prUrl (never dispatched) and no sourceRef (hand-authored spec) — both
    // orchestrator calls must no-op without ever invoking `gh`.
    await expect(
      announceGatedPr(entry, undefined as unknown as string, { cwd: '/repo', log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();
    await expect(
      announceGatedIssue(entry, undefined, { cwd: '/repo', log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 15 (wire-episode-daemon-cli): daemon-cli must construct and wire the
  // RateLimitEpisode into both the Conductor (for wait coordination) and the
  // runDaemon deps (for dispatch gating). Static wiring check to catch a
  // future refactor that silently drops the episode construction or wiring.
  // ───────────────────────────────────────────────────────────────────────────
  it('daemon-cli.ts wires RateLimitEpisode: imports create, constructs one episode, passes to Conductor and runDaemon', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');
    // Verify import
    expect(src).toContain("import { create as createRateLimitEpisode } from './engine/rate-limit-episode.js';");
    // Verify construction
    expect(src).toContain('const rateLimitEpisode = createRateLimitEpisode();');
    // Verify wiring to Conductor
    expect(src).toContain('rateLimitEpisode,') && expect(src).toMatch(/new Conductor\({[\s\S]*?rateLimitEpisode,/);
    // Verify wiring to runDaemon deps (should appear in the deps object)
    expect(src).toMatch(/await runDaemon\(\s*\{[\s\S]*?rateLimitEpisode,/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 (#561, daemon-releases-the-lock-only-after-draining-in-fl): SIGTERM
// must drain (via runDaemon's shouldStop) before the lock is released, with a
// bounded force-release if the drain never completes. Static source-assert
// checks mirroring the Task 22 SIGTERM block above.
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 3: SIGTERM drains then releases lock; bounded force-release', () => {
  it('daemonSigtermHandler body does not call process.exit directly and calls teardown.requestStop', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');

    const handlerMatch = src.match(
      /const daemonSigtermHandler = async \(\) => \{([\s\S]*?)\n  \};/,
    );
    expect(handlerMatch).not.toBeNull();
    const handlerBody = handlerMatch![1];

    // The handler must no longer force-exit the process directly — that now
    // happens only via the bounded teardown's onForceRelease callback.
    expect(handlerBody).not.toContain('process.exit');
    // The handler must request the drain-then-release teardown instead.
    expect(handlerBody).toContain('teardown.requestStop()');
  });

  it('runDaemon is invoked with a shouldStop dep wired to the teardown controller', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');

    expect(src).toMatch(/await runDaemon\(\s*\{[\s\S]*?shouldStop:\s*\(\)\s*=>\s*teardown\.shouldStop\(\),/);
  });

  it('onForceRelease synchronously releases the lock and logs a greppable force-release line', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');

    const teardownMatch = src.match(
      /createDaemonTeardown\(\{([\s\S]*?)\n  \}\);/,
    );
    expect(teardownMatch).not.toBeNull();
    const teardownArgs = teardownMatch![1];

    expect(teardownArgs).toContain('onForceRelease');
    expect(teardownArgs).toContain('releaseBackstop()');
    expect(teardownArgs).toMatch(/force-release/);
  });

  it('normal-completion path cancels the teardown controller before/around releasing the lock', () => {
    const src = readFileSync(join(__dirname, '../../src/daemon-cli.ts'), 'utf-8');

    expect(src).toMatch(/teardown\.cancel\(\);[\s\S]*?await lock\.release\(\);/);
  });
});
