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
    expect(source).toMatch(
      /import\s*\{\s*isOperatorParked\s*\}\s*from\s*['"]\.\/engine\/park-marker\.js['"]/,
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
