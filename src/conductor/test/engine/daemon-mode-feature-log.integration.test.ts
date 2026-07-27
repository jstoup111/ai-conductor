import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = vi.hoisted(() => ({ worktreePath: '' }));
const daemonLogSpy = vi.hoisted(() => ({
  formatDaemonActivityLine: vi.fn((message: string, featureOwned = false) =>
    featureOwned ? `[daemon]${message}` : `[daemon] ${message}`,
  ),
}));
const ciFixProbeSpy = vi.hoisted(() => ({
  defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
}));
const buildAuthSpy = vi.hoisted(() => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));

vi.mock('../../src/engine/daemon-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-log.js')>();
  return { ...actual, formatDaemonActivityLine: daemonLogSpy.formatDaemonActivityLine };
});

vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/ci-fix.js')>();
  return { ...actual, defaultCiFixProbe: ciFixProbeSpy.defaultCiFixProbe };
});

// The daemon loop checks its build credential before dispatch. This test owns
// feature-log wiring, so it supplies a deterministic credential boundary
// rather than depending on a developer or CI host token.
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: buildAuthSpy.readDaemonBuildToken,
}));

// Keep the daemon entry point real while replacing only the external feature
// executor. Its controlled output exercises beginFeatureRun's actual scoped
// logger, event renderer, console tee, and durable daemon-log sink.
vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: {
    beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<{
      log?: (message: string) => void;
      events: { emit: (event: unknown) => Promise<void> };
      stop: () => void;
    }>;
  }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun(
      { path: fixture.worktreePath, branch: `feat/${item.slug}` },
      item,
    );
    scope.log?.('setup complete');
    await scope.events.emit({ type: 'step_started', step: 'build' });
    // These all have established daemon render cases. They must remain wired
    // through the feature-owned event scope, not only the former global bus.
    await scope.events.emit({ type: 'gate_verdict', step: 'build', satisfied: false, reason: 'blocked' });
    await scope.events.emit({ type: 'kickback', from: 'build', to: 'plan', count: 1 });
    await scope.events.emit({ type: 'navigation_back', from: 'manual_test', to: 'build' });
    await scope.events.emit({ type: 'loop_halt', reason: 'cap' });
    await scope.events.emit({ type: 'loop_converged' });
    await scope.events.emit({ type: 'ci_failed', prUrl: 'https://example.test/pr/1', slug: item.slug, checks: ['test'], attempts: 1, phase: 'detected' });
    await scope.events.emit({ type: 'build_review_base', mergeBase: 'abc1234567890', trackingRefSha: 'abc1234567890', remoteHeadSha: 'abc1234567890', fresh: true });
    await scope.events.emit({ type: 'build_review_stale_mirage_regrade', mergeBase: 'abc1234567890', regradeCount: 1 });
    await scope.events.emit({ type: 'auto_park_contradiction', slug: item.slug, verdict: 'empty/missing plan', evidence: { summaryTasksCompleted: 1, evidenceStamps: 1, resolvedTasks: 0 } });
    scope.log?.('WARNING: provider unavailable');
    scope.log?.('retrying build (2/3)');
    scope.log?.('subprocess diagnostic: exit 1');
    scope.stop();
    return { slug: item.slug, status: 'done' };
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
  daemonLogSpy.formatDaemonActivityLine.mockClear();
  ciFixProbeSpy.defaultCiFixProbe.mockClear();
  buildAuthSpy.readDaemonBuildToken.mockClear();
});

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('daemon-mode feature log integration', () => {
  it('writes feature lifecycle output with one contextual tag to the live and durable daemon paths', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'daemon-feature-log-integration-'));
    dirs.push(repo);
    fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
    await mkdir(fixture.worktreePath, { recursive: true });

    const consoleLines: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (line: unknown) => consoleLines.push(String(line));
    try {
      await runDaemonMode({
        projectRoot: repo,
        concurrency: 1,
        maxItems: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        watch: false,
        workSource: { discover: async () => [{ slug: 'feature-a' }] },
      });
    } finally {
      console.log = originalConsoleLog;
    }

    const expected = [
      '▶ start feature-a',
      'setup complete',
      '· ▶ build',
      '· gate build: unsatisfied — blocked',
      '↩ KICKBACK: build re-opened plan (×1)',
      '↰ BACK: manual_test → build (operator)',
      '· ✋ loop halted: cap',
      '· ✓ gate loop converged',
      '· ✋ ci_failed[feature-a]: phase=detected attempts=1 checks=[test]',
      '· build_review base',
      '· build_review stale-mirage regrade',
      '· ✋ auto_park_contradiction[feature-a]',
      'WARNING: provider unavailable',
      'retrying build (2/3)',
      'subprocess diagnostic: exit 1',
      '■ done feature-a: done',
    ];
    const live = consoleLines.join('\n');
    const persisted = await readFile(daemonLogPath(repo), 'utf8');
    for (const message of expected) {
      expect(live).toContain(`[daemon][feature-a] ${message}`);
      expect(persisted).toContain(`[daemon][feature-a] ${message}`);
    }
    expect(daemonLogSpy.formatDaemonActivityLine).toHaveBeenCalledWith(
      '[feature-a] ▶ start feature-a',
      true,
    );
    expect(buildAuthSpy.readDaemonBuildToken).toHaveBeenCalledTimes(1);
    expect(persisted).not.toMatch(/\[daemon\]\[feature-a\]\[feature-a\]/);

    // step_started is one of the 19 TerminalSubscriber-rendered event types.
    // It must render exactly once (tagged) — not a second time untagged via
    // the daemon-wide bus the feature-scoped bus forwards onto.
    const buildLineOccurrences = live
      .split('\n')
      .filter((line) => line.includes('▶ build')).length;
    expect(buildLineOccurrences).toBe(1);
    expect(live).not.toContain('[daemon] · ▶ build');
  });
});
