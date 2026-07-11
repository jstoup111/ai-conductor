// ─────────────────────────────────────────────────────────────────────────────
// Test: Task 23 — daemon-cli wires ci_watch config + runCiFix dispatch into
// the sweepMergeableLabels ciFix opts, mirroring the mergeable_autoresolve
// wiring (source-assembly check, same pattern as
// daemon-cli-rekick-park-wiring.test.ts: read daemon-cli.ts as text and
// assert on the real production wiring rather than re-simulating the logic
// inline, since sweepMergeableLabels is called deep inside runDaemon with
// live gh/git side effects that aren't practical to drive end-to-end here).
//
// Acceptance criteria covered:
//   1. Config is read once at daemon startup (not per-sweep) — the ciFix
//      opts literal must reference the outer `config` binding, not a fresh
//      `loadConfig()` call inside the sweepMergeableLabels callback.
//   2. sweepMergeableLabels receives a populated `ciFix` opts when ci_watch
//      is enabled (isEligible → isEligibleForCiFix, dispatch → runCiFix).
//   3. When ci_watch is disabled, `ciFix.enabled` is false (config?.ci_watch
//      ?.enabled ?? true, default-on per CiWatchConfig, but explicit false
//      must resolve to false).
//   4. The dispatch wiring mirrors the pattern used for
//      `mergeable_autoresolve` (same object shape: enabled/isEligible/dispatch).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../src/daemon-cli.ts');

describe('Task 23 — daemon-cli wires ci_watch config and runCiFix dispatch', () => {
  it('imports isEligibleForCiFix and runCiFix from ci-fix.ts', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{[^}]*isEligibleForCiFix[^}]*\}\s*from\s*['"]\.\/engine\/ci-fix\.js['"]/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*runCiFix[^}]*\}\s*from\s*['"]\.\/engine\/ci-fix\.js['"]/,
    );
  });

  it('the sweepMergeableLabels call passes a ciFix opts block reading config?.ci_watch, mirroring mergeable_autoresolve', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    const sweepCallMatch = source.match(
      /await sweepMergeableLabels\(\{([\s\S]*?)\n\s*\}\);\n\s*\},/,
    );
    expect(sweepCallMatch, 'expected an `await sweepMergeableLabels({ ... });` call').toBeTruthy();
    const sweepCallBody = sweepCallMatch![1];

    // AC2/AC4: a `ciFix:` block exists, shaped like `autoresolve:`.
    expect(sweepCallBody).toMatch(/ciFix\s*:\s*\{/);
    expect(sweepCallBody).toMatch(/enabled\s*:\s*config\?\.ci_watch\?\.enabled\s*\?\?\s*true/);
    expect(sweepCallBody).toMatch(/isEligible\s*:/);
    expect(sweepCallBody).toMatch(/isEligibleForCiFix\(/);
    expect(sweepCallBody).toMatch(/dispatch\s*:/);
    expect(sweepCallBody).toMatch(/runCiFix\(/);

    // AC1: config is read from the outer `config` binding (populated once at
    // startup via `loadConfig` — see daemon-cli.ts:545), not re-loaded here.
    expect(sweepCallBody).not.toMatch(/loadConfig\(/);
  });
});
