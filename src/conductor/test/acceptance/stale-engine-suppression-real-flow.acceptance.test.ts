// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance spec: real-flow suppression breaks the restart loop within
// the SAME boot (issue #369, Story 3 Done When 2).
//
// Stories: .docs/stories/2026-07-10-stale-engine-residuals-369.md — Story 3
// Plan:    .docs/plans/2026-07-10-stale-engine-residuals-369.md — Task 13
// ADR:     .docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md §4
//
// #307/#367 false-green class: a unit test that injects a suppression record
// directly (or calls recordSuppression/isSuppressed on hand-picked fixture
// values) can pass while the REAL wiring inside `initStaleEngineState` still
// records the WRONG identity (the fresh boot identity instead of the marker's
// targetIdentity) — the bug lives in the wiring between the handshake and the
// suppression primitive, not in either primitive alone. This spec drives:
//   1. a REAL marker file on disk (writeRestartMarker),
//   2. the REAL handshake (initStaleEngineState — no injected record),
//   3. a REAL content-hash checker (createStaleEngineChecker over a genuinely
//      rebuilt dist fixture),
//   4. the REAL `isSuppressed` read,
//   5. the REAL `runDaemon` idle-boundary gate chain (isSuppressed +
//      requestRestart wired exactly as daemon-cli wires them),
// with zero injected suppression/record fakes anywhere in the flow.
//
// Pre-#369-fix, `initStaleEngineState` records suppression against the FRESH
// boot identity (X) instead of the marker's `targetIdentity` (T) — this spec
// fails for that reason until Task 1 lands.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { build } from 'tsup';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import { captureEngineIdentity, createStaleEngineChecker } from '../../src/engine/engine-identity.js';
import { writeRestartMarker, isSuppressed } from '../../src/engine/restart-intent.js';
import { initStaleEngineState } from '../../src/engine/stale-engine-init.js';
import { PUBLISH_WRAPPER_ENV_VAR } from '../../scripts/publish-guard.mjs';

/** Builds a REAL ESM bundle from `source` via tsup and returns its dist path. */
async function buildFixtureDist(workDir: string, source: string): Promise<string> {
  const entry = join(workDir, 'entry.ts');
  await writeFile(entry, source, 'utf-8');
  const outDir = join(workDir, 'dist');
  const previous = process.env[PUBLISH_WRAPPER_ENV_VAR];
  process.env[PUBLISH_WRAPPER_ENV_VAR] = '1';
  try {
    await build({
      entry: [entry],
      outDir,
      format: ['esm'],
      clean: true,
      silent: true,
      dts: false,
      sourcemap: false,
      skipNodeModulesBundle: true,
    });
  } finally {
    if (previous === undefined) {
      delete process.env[PUBLISH_WRAPPER_ENV_VAR];
    } else {
      process.env[PUBLISH_WRAPPER_ENV_VAR] = previous;
    }
  }
  return join(outDir, 'entry.js');
}

const FIXTURE_V1 = 'export const marker = "v1 — boot identity";\n';
const FIXTURE_V2 = 'export const marker = "v2 — the marker target we never reached at boot";\n';
const FIXTURE_V3 = 'export const marker = "v3 — engine moved past the failed target";\n';

describe('acceptance: real-flow suppression breaks the restart loop within the same boot (#369 Story 3)', () => {
  it(
    'non-converged handshake suppresses the marker target T; a later verdict targeting T is held; a verdict targeting a different U proceeds',
    async () => {
      const repoPath = await mkdtemp(join(tmpdir(), 'suppression-real-flow-repo-'));
      const distWorkDir = await mkdtemp(join(tmpdir(), 'suppression-real-flow-dist-'));
      try {
        // ── 1. Real boot identity: dist currently holds V1 content. ──────────
        const dist = await buildFixtureDist(distWorkDir, FIXTURE_V1);
        const bootIdentity = await captureEngineIdentity(dist); // X

        // Pre-derive the REAL hash the engine will have once it reaches V2 —
        // rebuilt at the SAME path (a rebuild in a different directory embeds
        // different absolute paths and hashes differently, even for identical
        // source), then rebuild back to V1 so the boot below observes X again.
        await buildFixtureDist(distWorkDir, FIXTURE_V2);
        const targetIdentity = await captureEngineIdentity(dist); // T
        await buildFixtureDist(distWorkDir, FIXTURE_V1);
        expect(await captureEngineIdentity(dist)).toBe(bootIdentity);
        expect(targetIdentity).not.toBe(bootIdentity);

        // ── 2. Real marker on disk. ───────────────────────────────────────────
        await writeRestartMarker(
          {
            reason: 'stale-engine',
            fromIdentity: 'f-original',
            targetIdentity,
            at: Date.now(),
          },
          repoPath,
        );

        // ── 3. Real handshake — no injected suppression record. Non-convergence
        // (bootIdentity !== targetIdentity) must record suppression against T
        // (the marker's targetIdentity), NOT X (the fresh boot identity) —
        // this is the exact #369 bug the handshake must not reproduce.
        const handshakeLog: string[] = [];
        const returnedIdentity = await initStaleEngineState({
          repoPath,
          entryPath: dist,
          flag: true,
          log: (msg) => handshakeLog.push(msg),
        });
        expect(returnedIdentity).toBe(bootIdentity);

        // ── 4. Real dist now genuinely converges to T (engine rebuilt to V2). ─
        await buildFixtureDist(distWorkDir, FIXTURE_V2); // same path as `dist`
        const checkerAtT = createStaleEngineChecker(bootIdentity, dist);
        expect(checkerAtT.check()).toBe('stale'); // real content diverged from bootIdentity
        expect(checkerAtT.targetIdentity?.()).toBe(targetIdentity);

        // ── 5. Real isSuppressed consult (no injected record): held for T. ────
        const suppressedForT = await isSuppressed(checkerAtT.targetIdentity?.() ?? null, repoPath);
        expect(suppressedForT).toBe(true);

        // ── 6. Prove the hold through the REAL runDaemon gate chain — the
        // restart must NOT be requested within this boot while T is suppressed.
        const requestRestartHeld = vi.fn(async () => ({ fired: true }));
        const resultHeld = await runDaemon(
          {
            discoverBacklog: async () => [],
            runFeature: async () => {
              throw new Error('must never dispatch in this scenario');
            },
            sleep: async () => {},
            log: () => {},
            staleEngineChecker: checkerAtT,
            isSuppressed: (currentIdentity) => isSuppressed(currentIdentity, repoPath),
            requestRestart: requestRestartHeld,
          } satisfies DaemonDeps,
          {
            concurrency: 1,
            once: false,
            maxIdlePolls: 1,
            isSelfHost: true,
            autoRestartOnStaleEngine: true,
          },
        );
        expect(requestRestartHeld).not.toHaveBeenCalled();
        expect(resultHeld.stoppedReason).toBe('idle_timeout');

        // ── 7. On-disk engine moves PAST the failed target to U ≠ T — the
        // suppression must not outlive its target: the restart now proceeds.
        await buildFixtureDist(distWorkDir, FIXTURE_V3);
        const checkerAtU = createStaleEngineChecker(bootIdentity, dist);
        expect(checkerAtU.check()).toBe('stale'); // real content diverged from bootIdentity
        const uIdentity = checkerAtU.targetIdentity?.() ?? null;
        expect(uIdentity).not.toBe(targetIdentity);

        const suppressedForU = await isSuppressed(uIdentity, repoPath);
        expect(suppressedForU).toBe(false);

        const requestRestartProceeds = vi.fn(async () => ({ fired: true }));
        await runDaemon(
          {
            discoverBacklog: async () => [],
            runFeature: async () => {
              throw new Error('must never dispatch in this scenario');
            },
            sleep: async () => {},
            log: () => {},
            staleEngineChecker: checkerAtU,
            isSuppressed: (currentIdentity) => isSuppressed(currentIdentity, repoPath),
            requestRestart: requestRestartProceeds,
          } satisfies DaemonDeps,
          {
            concurrency: 1,
            once: false,
            maxIdlePolls: 0,
            isSelfHost: true,
            autoRestartOnStaleEngine: true,
          },
        );
        expect(requestRestartProceeds).toHaveBeenCalledTimes(1);
        expect(requestRestartProceeds).toHaveBeenCalledWith({
          fromIdentity: bootIdentity,
          targetIdentity: uIdentity,
        });
      } finally {
        await rm(repoPath, { recursive: true, force: true });
        await rm(distWorkDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
