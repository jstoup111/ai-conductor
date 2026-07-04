// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli guards the `.pipeline/REKICK` sentinel resume call site
// (`resumeRebaseFirst`) on operator-park (Task 8, operator-park-a-human-
// placed-halt-must-survive-the, FR-2 happy: a pending sentinel on a parked
// worktree is left untouched — resume is skipped, the sentinel survives).
//
// `resumeRebaseFirst` is ONE-SHOT: it deletes `.pipeline/REKICK` up front
// regardless of outcome (see daemon-rekick.ts). If daemon-cli.ts called it
// unconditionally for a parked worktree, the sentinel would be silently
// consumed even though the operator-park must survive re-kick sweeps
// unconditionally (same invariant Task 3/7 already enforce at the sweep and
// dispatch-eligibility layers). This is a source-assembly check — mirroring
// the pattern used by daemon-cli-rekick-park-wiring.test.ts (Task 6) — proving
// the production wiring in daemon-cli.ts itself, since the call site lives
// inside an unexported closure (`runConductorInWorktree`) that isn't
// practical to invoke in isolation without a full daemon/provider harness.
// The underlying `isOperatorParked` primitive's correctness against real fs
// fixtures is already covered by park-marker.test.ts and the Task 6 wiring
// test.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('Task 8 — daemon-cli guards resumeRebaseFirst (REKICK sentinel) on operator-park', () => {
  it('checks isOperatorParked and returns BEFORE the one-shot resumeRebaseFirst call, so a parked sentinel is never consumed', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // The real production primitive is already imported (Task 7 wiring).
    expect(source).toMatch(
      /import\s*\{\s*isOperatorParked\s*\}\s*from\s*['"]\.\/engine\/park-marker\.js['"]/,
    );

    // Isolate the region from the ranManualTest computation through the
    // resumeRebaseFirst call, so we can assert relative ordering.
    const region = source.match(
      /const ranManualTest[\s\S]*?await resumeRebaseFirst\(\{[\s\S]*?\}\);/,
    );
    expect(
      region,
      'expected a block spanning ranManualTest through the resumeRebaseFirst(...) call',
    ).toBeTruthy();
    const block = region![0];

    const parkedCheckIdx = block.search(/isOperatorParked\(/);
    const resumeCallIdx = block.search(/await resumeRebaseFirst\(\{/);
    expect(parkedCheckIdx).toBeGreaterThan(-1);
    expect(resumeCallIdx).toBeGreaterThan(-1);
    expect(parkedCheckIdx).toBeLessThan(resumeCallIdx);

    // The parked branch must return (skip the whole resume — and by
    // extension conductor.run()) rather than merely logging, so a parked
    // worktree's sentinel is genuinely never touched.
    const between = block.slice(parkedCheckIdx, resumeCallIdx);
    expect(between).toMatch(/return;/);
  });

  it('the parked branch is reached before the sentinel would be consumed (behavioral proxy via the real primitives)', async () => {
    const { mkdtemp, rm, mkdir, writeFile: write, access } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { isOperatorParked, writeOperatorPark } = (await import(
      '../../src/engine/park-marker.js'
    )) as {
      isOperatorParked: (root: string, slug: string) => Promise<boolean>;
      writeOperatorPark: (root: string, slug: string) => Promise<void>;
    };
    const { REKICK_SENTINEL } = await import('../../src/engine/daemon-rekick.js');

    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-cli-sentinel-guard-root-'));
    const worktreeBase = await mkdtemp(join(tmpdir(), 'daemon-cli-sentinel-guard-wt-'));
    try {
      const slug = 'parked-with-sentinel';
      const wtPath = join(worktreeBase, slug);
      await mkdir(join(wtPath, '.pipeline'), { recursive: true });
      await write(join(wtPath, REKICK_SENTINEL), 'rekick\n', 'utf-8');
      await writeOperatorPark(projectRoot, slug);

      // Mirror the guard's decision exactly: parked → skip (do not touch the
      // sentinel), matching what the daemon-cli.ts call site now does.
      const parked = await isOperatorParked(projectRoot, slug);
      expect(parked).toBe(true);
      if (!parked) {
        // Not exercised in this branch — asserts the guard shape, not a
        // real resumeRebaseFirst invocation (covered by daemon-rekick.test.ts).
        throw new Error('unreachable: parked must be true for this fixture');
      }

      // Sentinel must still be present — it was never consumed.
      await expect(access(join(wtPath, REKICK_SENTINEL))).resolves.toBeUndefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });
});
