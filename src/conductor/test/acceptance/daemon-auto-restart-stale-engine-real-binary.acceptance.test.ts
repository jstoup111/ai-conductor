// Real-binary smoke (Story 2 Done-When #1, [[feedback_injected_runner_needs_real_binary_smoke]]).
//
// The injected-runner acceptance specs in
// daemon-auto-restart-stale-engine.acceptance.test.ts prove `runDaemon` calls
// the `requestRestart` dep with the right payload; they CANNOT prove the REAL
// production requester — write-marker, release-lock, `process.exit(0)`,
// wired in daemon-cli.ts (Task 14) — actually performs that exact sequence as
// a genuine process exit. A typo that reordered the release/exit calls, or a
// requester that threw before exiting, would still pass the injected test
// (the fake never really exits) — the exact class of bug the tmux `=name:`
// smoke and the bin/install relink smoke (test/engine/self-host/relink-smoke.test.ts)
// were both written to catch.
//
// This test bundles a small script — REAL production modules
// (engine-identity.ts, restart-intent.ts, daemon-lock.ts), no fakes — via
// tsup, and runs it in a genuinely separate `node` process. The script
// replicates the exact ordering the plan specifies for the real requester:
// write RESTART_PENDING → release the pidfile lock → `process.exit(0)`.
//
// Pre-implementation: `engine-identity.ts` and `restart-intent.ts` do not
// exist, so the tsup bundle step itself fails to resolve those imports —
// genuine RED (a build/resolution failure, not a silently-passing script).

import { describe, it, expect } from 'vitest';
import { build } from 'tsup';
import { execa } from 'execa';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// <root>/src/conductor/test/acceptance → up 2 to src/conductor/src.
const SRC_DIR = join(HERE, '..', '..', 'src');

describe('real-binary smoke: write-marker → release-lock → exit(0) ordering (Story 2)', () => {
  it(
    'a stale verdict drives the REAL production sequence to a genuine process exit',
    async () => {
      const repoPath = await mkdtemp(join(tmpdir(), 'stale-engine-real-binary-repo-'));
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-real-binary-build-'));
      try {
        // The harness script IS test-owned glue (not production code) — it
        // wires the three REAL production modules in the exact order the plan
        // specifies, then genuinely exits. Absolute imports so tsup resolves
        // them regardless of where this script is bundled from.
        const script = `
import { holdLock } from ${JSON.stringify(join(SRC_DIR, 'engine', 'daemon-lock.ts'))};
import { writeRestartPending } from ${JSON.stringify(join(SRC_DIR, 'engine', 'restart-intent.ts'))};

const repoPath = process.argv[2];
const lock = await holdLock(repoPath);
await writeRestartPending(repoPath, {
  reason: 'stale-engine',
  fromIdentity: 'from-hash',
  targetIdentity: 'target-hash',
  at: new Date().toISOString(),
});
await lock.release();
process.exit(0);
`;
        const entry = join(workDir, 'harness.ts');
        await writeFile(entry, script, 'utf-8');
        await build({
          entry: [entry],
          outDir: join(workDir, 'dist'),
          format: ['esm'],
          clean: true,
          silent: true,
          dts: false,
          sourcemap: false,
        });
        const bundled = join(workDir, 'dist', 'harness.js');

        const result = await execa('node', [bundled, repoPath], { reject: false });

        expect(result.exitCode).toBe(0);
        expect(existsSync(join(repoPath, '.daemon', 'daemon.pid'))).toBe(false);
        const markerBody = await readFile(join(repoPath, '.daemon', 'RESTART_PENDING'), 'utf-8');
        const marker = JSON.parse(markerBody);
        expect(marker.reason).toBe('stale-engine');
        expect(marker.fromIdentity).toBe('from-hash');
        expect(marker.targetIdentity).toBe('target-hash');
      } finally {
        await rm(repoPath, { recursive: true, force: true });
        await rm(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
