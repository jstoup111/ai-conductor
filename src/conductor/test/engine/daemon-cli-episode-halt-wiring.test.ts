// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires the REAL episode-halt tracker into the daemon loop
// (Task 20, daemon-api-rate-limit-episode-cascades-into-mass-h).
//
// `DaemonDeps.onHaltWritten` / `DaemonDeps.sweepEpisodeHalts` are optional and
// guarded with `?.()` in daemon.ts — the daemon-level behavior (stamp on park,
// sweep on the episode active→inactive transition) is covered in
// daemon.test.ts with injected fakes. That coverage proves NOTHING about
// production unless `daemon-cli.ts` actually creates a tracker and threads its
// callbacks into the runDaemon deps object. This PR originally shipped
// `episode-halt-tracker.ts` with zero importers (an orphaned primitive: green
// unit tests, inert feature) — this source-assembly check pins the wiring so
// it cannot silently regress.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('Task 20 — daemon-cli wires the episode-halt tracker into runDaemon deps', () => {
  it('imports createEpisodeHaltTracker and constructs a tracker', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{\s*createEpisodeHaltTracker\s*\}\s*from\s*['"]\.\/engine\/episode-halt-tracker\.js['"]/,
    );
    expect(source).toMatch(/const episodeHaltTracker\s*=\s*createEpisodeHaltTracker\(\)/);
  });

  it('wires onHaltWritten and sweepEpisodeHalts through the tracker in the runDaemon deps', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // Stamp path: the deps' onHaltWritten delegates to the tracker.
    expect(source).toMatch(/onHaltWritten:\s*async[\s\S]{0,200}episodeHaltTracker\.onHaltWritten\(/);

    // Sweep path: the deps' sweepEpisodeHalts reads stamped slugs from the
    // tracker (gated on the live HALT marker) and clears via the existing
    // rekick primitive, respecting operator-park.
    const sweepMatch = source.match(/sweepEpisodeHalts:\s*async\s*\(([\s\S]*?)\n\s*\},/);
    expect(sweepMatch, 'expected a sweepEpisodeHalts binding in the runDaemon deps').toBeTruthy();
    const sweepBody = sweepMatch![0];
    expect(sweepBody).toMatch(/episodeHaltTracker\.getEpisodeHalts\(/);
    expect(sweepBody).toMatch(/clearMarker\(/);
    expect(sweepBody).toMatch(/isParked/);
  });

  it('the real tracker records only episode-caused parks and gates on the live HALT marker', async () => {
    const { createEpisodeHaltTracker } = await import('../../src/engine/episode-halt-tracker.js');

    const tracker = createEpisodeHaltTracker();
    tracker.onHaltWritten('episode-halt', true);
    tracker.onHaltWritten('ordinary-halt', false);

    // Only the stamped slug comes back, and only while its HALT is still live.
    expect(await tracker.getEpisodeHalts(async () => true)).toEqual(['episode-halt']);
    expect(await tracker.getEpisodeHalts(async () => false)).toEqual([]);
  });
});
