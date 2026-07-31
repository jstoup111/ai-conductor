import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import { reconcileParkedFeatures } from '../../src/engine/park-reconciliation.js';
import { writeOperatorPark } from '../../src/engine/park-marker.js';
import { createGithubTrackerClient, type GhRunner } from '../../src/engine/tracker-client.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

const source = readFileSync(resolve(process.cwd(), 'src/daemon-cli.ts'), 'utf8');

describe('daemon-cli parked reconciliation wiring (Task 11)', () => {
  it('snapshots cleanup config once and binds a per-run cache into the daemon sweep', () => {
    expect(source).toMatch(/const reconcileParkedAutoCleanup = config\?\.reconcile_parked_auto_cleanup \?\? true;/);
    expect(source).toMatch(/const parkedSweepCache = new Map<string, ParkClassification>\(\);/);
    expect(source).toMatch(/reconcileParkedFeatures: async \(\{ disposeHaltWatcher \}\) => \{[\s\S]*cache: parkedSweepCache,[\s\S]*autoCleanup: reconcileParkedAutoCleanup,/);
    expect(source).toContain('log: (message) => log(message, true),');
  });

  it('supplies BOTH adr-2026-07-27 hand-off callbacks from the production sweep binding (rem-adr-002, rem-adr-005)', () => {
    const sweepBinding = source.match(
      /reconcileParkedFeatures: async \(\{ disposeHaltWatcher \}\) => \{([\s\S]*?)\n {6}\},/,
    );
    expect(sweepBinding?.[1]).toBeDefined();
    // The ST-916 repair adapter is constructed from the real production factory,
    // not left `undefined` (which silently defers every record-missing park forever).
    expect(sweepBinding?.[1]).toContain('requestRecordRepair: makeRecordRepairRequester({ cwd: projectRoot, log })');
    // The disposer is the daemon-owned one handed in by runDaemon, never a local stub.
    expect(sweepBinding?.[1]).toContain('disposeHaltWatcher,');
    expect(source).toContain("import { makeRecordRepairRequester } from './engine/shipment-evidence-cli.js';");
  });

  it('binds the receiver-dependent tracker issue-state lookup for the idle sweep', () => {
    const sweepBinding = source.match(
      /reconcileParkedFeatures: async \(\{ disposeHaltWatcher \}\) => \{([\s\S]*?)\n {6}\},/,
    );
    expect(sweepBinding?.[1]).toContain('getIssueState: tracker.getIssueState.bind(tracker),');
  });

  it('classifies a CLOSED non-ancestor park as orphan through the bound real tracker seam', async () => {
    const projectRoot = await mkdtemp(resolve(tmpdir(), 'daemon-parked-tracker-binding-'));
    try {
      await mkdir(resolve(projectRoot, '.docs', 'intake'), { recursive: true });
      await writeOperatorPark(projectRoot, 'orphan-park');
      await writeFile(resolve(projectRoot, '.docs', 'intake', 'orphan-park.md'), 'Source-Ref: owner/repo#42\n');
      const tracker = createGithubTrackerClient((async () => ({
        stdout: JSON.stringify({ state: 'closed' }),
      })) as GhRunner);
      // Faithful base-branch reads: origin/main is readable and carries no
      // shipped record for this slug, the slug's branch exists, and its
      // ancestry probe exits 1 — the exact shape of a real non-ancestor park.
      const runGit = (async (args: string[]) => {
        if (args[0] === 'ls-tree') return { stdout: '\n' };
        if (args[0] === 'for-each-ref') return { stdout: 'feat/orphan-park\n' };
        throw Object.assign(new Error('not an ancestor'), { code: 1 });
      }) as GitRunner;

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit,
        autoCleanup: false,
        // getIssueState calls this.viewIssue; this mirrors the idle callback binding.
        getIssueState: tracker.getIssueState.bind(tracker),
      });

      expect(result.entries).toEqual([{ slug: 'orphan-park', classification: 'orphan', annotation: 'orphan' }]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('forces dashboard classification to autoCleanup: false, so a configured false toggle cannot delete during render', () => {
    const dashboardCall = source.match(/const reconciliation = await reconcileParkedFeatures\(\{([\s\S]*?)\}\);/);
    expect(dashboardCall?.[1]).toBeDefined();
    expect(dashboardCall?.[1]).toContain('autoCleanup: false');
    expect(source).toContain("classification === 'merged'\n                ? 'merged-ready'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rem-adr-004 / rem-adr-005: the disposer the sweep receives is the daemon's
// OWN live per-slug HALT-watcher disposer, not an injectable test-only stub.
// These drive the real `runDaemon` core with a faithful in-process
// `watchHaltCleared` fake at the (only) fs-watch boundary.
// ─────────────────────────────────────────────────────────────────────────────

describe('runDaemon — per-slug HALT-watcher disposal reaches parked reconciliation (rem-adr-004)', () => {
  it('hands the sweep a disposer that invokes and removes the live watcher for that slug', async () => {
    const disposed: string[] = [];
    const seen: Array<(slug: string) => void> = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [{ slug: 'merged-park' }],
      runFeature: async (item) => ({ slug: item.slug, status: 'halted' }),
      sleep: async () => {},
      watchHaltCleared: (slug) => () => disposed.push(slug),
      reconcileParkedFeatures: async ({ disposeHaltWatcher }) => {
        seen.push(disposeHaltWatcher);
        disposeHaltWatcher('merged-park');
      },
    };

    await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 2 });

    // The watcher registered when the feature halted was disposed exactly once
    // by reconciliation — a second sweep tick finds nothing left to dispose,
    // and daemon exit does not double-dispose it either.
    expect(disposed).toEqual(['merged-park']);
    expect(seen.length).toBeGreaterThan(1);
    expect(typeof seen[0]).toBe('function');
  });

  it('disposing a slug with no live watcher is a silent no-op', async () => {
    const disposed: string[] = [];
    await runDaemon({
      discoverBacklog: async () => [],
      runFeature: async (item) => ({ slug: item.slug, status: 'done' }),
      sleep: async () => {},
      watchHaltCleared: (slug) => () => disposed.push(slug),
      reconcileParkedFeatures: async ({ disposeHaltWatcher }) => {
        disposeHaltWatcher('never-dispatched');
      },
    }, { concurrency: 1, once: false, maxIdlePolls: 1 });

    expect(disposed).toEqual([]);
  });
});
