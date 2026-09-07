// Covers: task:3
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
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('Task 20 — daemon-cli wires the episode-halt tracker into runDaemon deps', () => {
  it('imports createEpisodeHaltTracker and constructs a tracker', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{[\s\S]*?createEpisodeHaltTracker[\s\S]*?\}\s*from\s*['"]\.\/engine\/episode-halt-tracker\.js['"]/,
    );
    expect(source).toMatch(/const episodeHaltTracker\s*=\s*createEpisodeHaltTracker\(\)/);
  });

  it('wires onHaltWritten and sweepEpisodeHalts through the tracker in the runDaemon deps', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // Stamp path: the deps' onHaltWritten delegates to the tracker.
    expect(source).toMatch(/onHaltWritten:\s*async[\s\S]{0,200}episodeHaltTracker\.onHaltWritten\(/);

    // Sweep path: the deps delegate to the real sweep binding, which the
    // integration case below drives against real marker files.
    expect(source).toMatch(
      /sweepEpisodeHalts:\s*\(isParkedDep\)\s*=>\s*sweepEpisodeHalts\(episodeHaltTracker, worktreeBase, log, isParkedDep\)/,
    );
    expect(source).toMatch(/isOperatorActionHalt\(disposition\)/);
    expect(source).toMatch(/readHaltClass\(join\(worktreeBase, slug\)\)/);
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

  it('retains operator-action episode halts while clearing mechanical halts, after operator-park precedence', async () => {
    const { createEpisodeHaltTracker } = await import('../../src/engine/episode-halt-tracker.js');
    const { sweepEpisodeHalts } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(process.env.TMPDIR!, 'episode-halt-sweep-'));
    const tracker = createEpisodeHaltTracker();
    const lines: string[] = [];

    const writeLiveHalt = async (slug: string, haltClass?: string) => {
      const pipeline = join(worktreeBase, slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(join(pipeline, 'HALT'), 'episode-caused halt\n');
      if (haltClass) await writeFile(join(pipeline, 'HALT.class'), haltClass);
      tracker.onHaltWritten(slug, true);
    };

    try {
      await writeLiveHalt('mechanical', 'mechanical');
      await writeLiveHalt('needs-human', 'needs-human');
      await writeLiveHalt('missing-sidecar');
      await writeLiveHalt('operator-park', 'mechanical');

      await sweepEpisodeHalts(tracker, worktreeBase, (line) => lines.push(line), async (slug) =>
        slug === 'operator-park',
      );

      await expect(access(join(worktreeBase, 'mechanical', '.pipeline', 'HALT'))).rejects.toThrow();
      await expect(access(join(worktreeBase, 'needs-human', '.pipeline', 'HALT'))).resolves.toBeUndefined();
      await expect(access(join(worktreeBase, 'missing-sidecar', '.pipeline', 'HALT'))).resolves.toBeUndefined();
      await expect(access(join(worktreeBase, 'operator-park', '.pipeline', 'HALT'))).resolves.toBeUndefined();
      expect(lines).toContain('episode-end sweep: needs-human needs-human — left for a human');
      expect(lines).toContain('episode-end sweep: missing-sidecar unclassified — left for a human');
      expect(lines).toContain('episode-end sweep: operator-park operator-parked — left for a human');
      expect(lines).toContain('episode-end sweep: re-kicked mechanical (episode-caused HALT cleared)');
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });
});
