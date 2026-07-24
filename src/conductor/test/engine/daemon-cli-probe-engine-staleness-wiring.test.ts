// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires a REAL `probeEngineStaleness` dep into the daemon
// loop, unconditionally (fires only where the armed gate declines) —
// (.docs/plans/daemon-stale-engine-origin-advance.md Task 9; stories TI-4 HP3,
// NP3, NP4; TI-2 throttle-sharing note).
//
// Source-grep, not a full daemon-cli.ts process spin-up — same technique
// `daemon-cli-refresh-engine-source-wiring.test.ts` (Task 6) uses for this
// exact class of composition-root check in this repo.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

async function readBinding(): Promise<string> {
  const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
  const bindingMatch = source.match(/probeEngineStaleness\s*:[\s\S]{0,3000}?\n(?=\s{6}\w+:|\s{4}\};)/);
  expect(bindingMatch, 'expected a probeEngineStaleness: ... binding in the runDaemon deps object').toBeTruthy();
  return bindingMatch![0];
}

describe('daemon-cli wires probeEngineStaleness (advisory, self-heal-disabled path) into runDaemon deps', () => {
  it('threads a probeEngineStaleness dep into the real runDaemon({...}) deps object', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
    expect(source).toMatch(/probeEngineStaleness\s*:/);
  });

  it('shares the throttle mechanism (createRefreshThrottle) used by refreshEngineSource (TI-2)', async () => {
    const binding = await readBinding();
    expect(binding).toMatch(/createRefreshThrottle/);
    expect(binding).toMatch(/shouldRun\(\)/);
    expect(binding).toMatch(/markRan\(\)/);
  });

  it('reads the boot-stamped engine source SHA and probes it via GitRunner ancestry check (merge-base --is-ancestor, in engine-refresh.ts)', async () => {
    const binding = await readBinding();
    expect(binding).toMatch(/engineSourceSha/);
    expect(binding).toMatch(/makeGitRunner/);
    expect(binding).toMatch(/probeStampedShaBehindOrigin/);

    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
    expect(source).toMatch(
      /import\s*\{[^}]*probeStampedShaBehindOrigin[^}]*\}\s*from\s*['"]\.\/engine\/engine-refresh\.js['"]/,
    );

    const refreshSource = await readFile(
      join(__dirname, '../../src/engine/engine-refresh.ts'),
      'utf-8',
    );
    expect(refreshSource).toMatch(/merge-base/);
    expect(refreshSource).toMatch(/--is-ancestor/);
  });

  it('fires the deduped staleness warner with cause self-heal-disabled', async () => {
    const binding = await readBinding();
    expect(binding).toMatch(/createStalenessWarner/);
    expect(binding).toMatch(/\.warn\(/);
    expect(binding).toMatch(/self-heal-disabled/);
  });
});
