// ─────────────────────────────────────────────────────────────────────────────
// Tests for Task 14: boot honors pause + logs it (FR-4/FR-7).
//
// Verifies that `runDaemonMode` (the CLI-level daemon entry point), not just
// the inner `runDaemon` loop, honors a pre-existing `.daemon/PAUSED` marker at
// boot time:
//   1. Boot in a repo with the marker already set → a startup log line states
//      paused, and zero items are dispatched.
//   2. A marker set while the daemon was stopped is honored the NEXT time it
//      boots (FR-7 — no restart-to-notice race).
//   3. Resuming (removing the marker) while stopped means the NEXT boot
//      dispatches normally.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDaemonMode, type DaemonModeOptions } from '../../src/daemon-cli.js';
import { writePauseMarker, removePauseMarker } from '../../src/engine/pause-marker.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

let workDirs: string[] = [];

beforeEach(() => {
  workDirs = [];
});

afterEach(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'daemon-boot-pause-'));
  workDirs.push(d);
  return d;
}

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }) as BacklogItem);
}

// A minimal `runDaemonMode` invocation: no real git/gh/install-freshness I/O,
// so the only remaining boot-time real work is the pidfile lock + log file
// under `projectRoot/.daemon` (pure fs) and the pause-marker check itself.
function baseOpts(projectRoot: string, dispatched: string[], discoverItems: BacklogItem[]): DaemonModeOptions {
  return {
    projectRoot,
    concurrency: 1,
    baseBranch: 'main', // skip the real `git` default-branch lookup
    ensureFresh: async () => {}, // skip the stale-install backstop
    workSource: {
      discover: async () => {
        for (const it of discoverItems) dispatched.push(it.slug);
        return [];
      },
    },
  };
}

describe('Task 14: runDaemonMode boot honors pause + logs it (FR-4/FR-7)', () => {
  it('boots with the pause marker already set: logs a paused startup line and dispatches zero items', async () => {
    const repo = await freshDir();
    await writePauseMarker(repo, { pausedBy: 'test-operator' });

    const dispatched: string[] = [];
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(String(msg));
    try {
      await runDaemonMode(baseOpts(repo, dispatched, items(2)));
    } finally {
      console.log = origLog;
    }

    expect(dispatched).toEqual([]);
    expect(lines.some((l) => /paused/i.test(l))).toBe(true);
  });

  it('a marker set while the daemon was stopped is honored on the next boot (FR-7)', async () => {
    const repo = await freshDir();
    // Daemon is "stopped" here — no daemon process running. An operator (or
    // another tool) sets the pause marker directly on disk.
    await writePauseMarker(repo, { pausedBy: 'test-operator' });

    const dispatched: string[] = [];
    await runDaemonMode(baseOpts(repo, dispatched, items(1)));

    expect(dispatched).toEqual([]);
  });

  it('resuming while stopped means the next boot dispatches normally', async () => {
    const repo = await freshDir();
    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    // Resume while stopped: remove the marker before the daemon ever boots.
    await removePauseMarker(repo);

    const dispatched: string[] = [];
    await runDaemonMode(baseOpts(repo, dispatched, items(2)));

    expect(dispatched).toEqual(['f0', 'f1']);
  });
});
