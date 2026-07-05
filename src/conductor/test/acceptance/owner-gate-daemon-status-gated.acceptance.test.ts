import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import type { ProjectRecord } from '../../src/engine/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-5, FR-6, FR-13, FR-14
//
// RED acceptance specs for Story "daemon status shows per-repo gated state
// with freshness". `runDaemonStatus`/`computeStatusRow` read ONLY pidfile,
// pause-marker, and tmux state today — nothing reads `.daemon/gated.json`, so
// there is no GATED section, no freshness age, and no degraded "unknown"
// wording anywhere in the status output (plan Tasks 14-16).
//
// This drives the REAL `runDaemonStatus` end-to-end: a real registry file on
// disk (read via the real `readRegistry`), real repo directories, and a
// hand-written `.daemon/gated.json` fixture per repo (the snapshot's on-disk
// SHAPE is a fixed, documented contract — schemaVersion/writtenAt/repoWarnings/
// gated — independent of the not-yet-existing serializer that will produce it
// in production, exactly as this feature's ADR specifies). The read side
// (`readGatedSnapshot` / the status renderer) does not exist yet, so every
// assertion below fails on the missing GATED rendering, not on any fixture
// mechanics.
// ─────────────────────────────────────────────────────────────────────────────

let registryDir: string;
let registryPath: string;
let repoA: string;
let repoB: string;
let repoMissing: string;

beforeEach(async () => {
  registryDir = await mkdtemp(join(tmpdir(), 'owner-gate-status-registry-'));
  registryPath = join(registryDir, 'registry.json');
  repoA = await mkdtemp(join(tmpdir(), 'owner-gate-status-repoA-'));
  repoB = await mkdtemp(join(tmpdir(), 'owner-gate-status-repoB-'));
  repoMissing = join(tmpdir(), 'owner-gate-status-repo-missing-does-not-exist');
});

afterEach(async () => {
  await rm(registryDir, { recursive: true, force: true });
  await rm(repoA, { recursive: true, force: true });
  await rm(repoB, { recursive: true, force: true });
});

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'active' as ProjectRecord['status'],
    registeredAt: new Date().toISOString(),
  };
}

async function writeRegistry(records: ProjectRecord[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records), 'utf-8');
}

async function writeSnapshot(repoPath: string, body: unknown): Promise<void> {
  const daemonDir = join(repoPath, '.daemon');
  await mkdir(daemonDir, { recursive: true });
  await writeFile(join(daemonDir, 'gated.json'), typeof body === 'string' ? body : JSON.stringify(body), 'utf-8');
}

describe('owner-gate daemon-status GATED rendering acceptance (Covers: FR-5, FR-6, FR-13, FR-14)', () => {
  it('a repo with a populated snapshot shows a GATED section with slug/reason/remedy and an "as of Nm ago" freshness label', async () => {
    const writtenAt = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 minutes ago
    await writeSnapshot(repoA, {
      schemaVersion: 1,
      writtenAt,
      repoWarnings: [],
      gated: [
        { kind: 'spec', slug: 'gated-one', reason: 'other-owner', otherOwner: 'alice', remedy: 'declare ownership' },
      ],
    });
    await writeRegistry([record('repo-a', repoA)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    expect(code).toBe(0);
    const output = lines.join('\n');
    // Fails today: computeStatusRow/runDaemonStatus never reads gated.json.
    expect(output).toContain('gated-one');
    expect(output).toContain('alice');
    expect(output.toLowerCase()).toMatch(/as of \d+m ago/);
  });

  it('a repo whose snapshot is an explicit empty snapshot states no specs are gated (same wording as the dashboard\'s empty form)', async () => {
    await writeSnapshot(repoA, {
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      repoWarnings: [],
      gated: [],
    });
    await writeRegistry([record('repo-a', repoA)]);

    const lines: string[] = [];
    await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    const output = lines.join('\n');
    // Fails today: no gated-state wording of any kind is rendered.
    expect(output.toLowerCase()).toContain('no specs are gated');
  });

  it('a repo with NO snapshot file shows "gated state unknown — no scan recorded", not an implied all-clear and not a crash', async () => {
    await writeRegistry([record('repo-a', repoA)]); // no .daemon/gated.json written at all

    const lines: string[] = [];
    const { code } = await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    expect(code).toBe(0);
    const output = lines.join('\n');
    // Fails today: there is no "gated state unknown" wording anywhere.
    expect(output.toLowerCase()).toContain('gated state unknown');
    expect(output.toLowerCase()).toContain('no scan recorded');
  });

  it('a snapshot with truncated/invalid JSON degrades that repo to "gated state unknown — snapshot unreadable"; other repos render normally; exit code unchanged', async () => {
    await writeSnapshot(repoA, '{"schemaVersion": 1, "writtenAt": "2026-07-0'); // truncated
    await writeSnapshot(repoB, {
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      repoWarnings: [],
      gated: [],
    });
    await writeRegistry([record('repo-a', repoA), record('repo-b', repoB)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    expect(code).toBe(0);
    const output = lines.join('\n');
    // Fails today: no unreadable-snapshot handling exists.
    expect(output.toLowerCase()).toContain('gated state unknown');
    expect(output.toLowerCase()).toContain('snapshot unreadable');
    expect(output.toLowerCase()).toContain('no specs are gated'); // repo-b renders normally
  });

  it('a snapshot with an unrecognized schemaVersion degrades to the same explicit unknown state (forward-compat guard)', async () => {
    await writeSnapshot(repoA, {
      schemaVersion: 999,
      writtenAt: new Date().toISOString(),
      repoWarnings: [],
      gated: [{ kind: 'spec', slug: 'future-shape', reason: 'other-owner', otherOwner: 'x', remedy: 'r' }],
    });
    await writeRegistry([record('repo-a', repoA)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    expect(code).toBe(0);
    const output = lines.join('\n');
    // Fails today: no schemaVersion guard exists, and no unknown-state wording.
    expect(output.toLowerCase()).toContain('gated state unknown');
    expect(output).not.toContain('future-shape'); // never misrender an unrecognized shape's fields
  });

  it('a registry entry whose path is missing (path-missing liveness) never attempts a snapshot read, and its liveness row is unchanged', async () => {
    await writeRegistry([record('repo-missing', repoMissing), record('repo-a', repoA)]);
    await writeSnapshot(repoA, {
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      repoWarnings: [],
      gated: [{ kind: 'spec', slug: 'gated-two', reason: 'other-owner', otherOwner: 'y', remedy: 'r' }],
    });

    const lines: string[] = [];
    const { code, rows } = await runDaemonStatus({ registryPath, out: (l) => lines.push(l) });

    expect(code).toBe(0);
    const missingRow = rows.find((r) => r.name === 'repo-missing');
    expect(missingRow?.liveness).toBe('path-missing'); // existing behavior unchanged

    const output = lines.join('\n');
    // Fails today: repo-a's GATED section is entirely absent regardless.
    expect(output).toContain('gated-two');
  });
});
