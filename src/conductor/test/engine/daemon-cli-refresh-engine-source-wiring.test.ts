// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires the REAL `refreshEngineSource` dep into the daemon
// loop, self-host only (.docs/plans/daemon-stale-engine-origin-advance.md
// Task 6; stories TI-1 HP1, NP4, TI-2, TI-4 HP1/HP2).
//
// Source-grep, not a full daemon-cli.ts process spin-up — same technique
// `daemon-cli-build-auth-wiring.test.ts` and `daemon-cli-episode-halt-wiring.test.ts`
// use for this exact class of composition-root check in this repo.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('daemon-cli wires refreshEngineSource (self-host only) into runDaemon deps', () => {
  it('imports fastForwardRoot, createRefreshThrottle, and createStalenessWarner', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(/fastForwardRoot/);
    expect(source).toMatch(
      /import\s*\{[^}]*createRefreshThrottle[^}]*\}\s*from\s*['"]\.\/engine\/engine-refresh\.js['"]/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*createStalenessWarner[^}]*\}\s*from\s*['"]\.\/engine\/engine-refresh\.js['"]/,
    );
  });

  it('threads a refreshEngineSource dep into the real runDaemon({...}) deps object', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(/refreshEngineSource\s*:/);
  });

  it('refreshEngineSource is gated on isSelfHost — undefined off self-host (NP4)', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    const bindingMatch = source.match(
      /refreshEngineSource\s*:\s*isSelfHost[\s\S]{0,20}\?[\s\S]{0,2000}?:\s*undefined,/,
    );
    expect(
      bindingMatch,
      'expected refreshEngineSource to be ternary-gated on isSelfHost, falling back to undefined',
    ).toBeTruthy();
  });

  it('the self-host branch consults engine_refresh_min_interval_seconds and the throttle before fetching', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    const bindingMatch = source.match(/refreshEngineSource\s*:\s*isSelfHost[\s\S]{0,2000}?:\s*undefined,/);
    expect(bindingMatch).toBeTruthy();
    const binding = bindingMatch![0];

    expect(binding).toMatch(/engine_refresh_min_interval_seconds/);
    expect(binding).toMatch(/createRefreshThrottle/);
    expect(binding).toMatch(/shouldRun\(\)/);
    expect(binding).toMatch(/markRan\(\)/);
  });

  it('the self-host branch calls fastForwardRoot and routes degraded causes into the staleness warner (TI-4)', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    const bindingMatch = source.match(/refreshEngineSource\s*:\s*isSelfHost[\s\S]{0,2000}?:\s*undefined,/);
    expect(bindingMatch).toBeTruthy();
    const binding = bindingMatch![0];

    expect(binding).toMatch(/fastForwardRoot\(/);
    expect(binding).toMatch(/createStalenessWarner/);
    expect(binding).toMatch(/\.warn\(/);
    expect(binding).toMatch(/dirty/);
    expect(binding).toMatch(/diverged/);
    expect(binding).toMatch(/fetch-failed/);
  });
});
