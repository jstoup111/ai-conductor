// Covers: S6.3, task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = vi.hoisted(() => ({ worktreePath: '' }));

vi.mock('../../src/engine/daemon-deps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-deps.js')>();
  return { ...actual, resolveDaemonBaseSha: vi.fn(async () => 'a'.repeat(40)) };
});

vi.mock('../../src/engine/work-order.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/work-order.js')>();
  return { ...actual, buildWorkOrder: vi.fn((input) => input) };
});

vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));

vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: {
    beginFeatureRun: (
      worktree: { path: string; branch: string },
      item: { slug: string },
    ) => Promise<{
      providerExecution: { diagnosticLog?: (message: string) => void };
      stop: () => Promise<void>;
    }>;
  }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun(
      { path: fixture.worktreePath, branch: `feat/${item.slug}` },
      item,
    );
    scope.providerExecution.diagnosticLog?.(
      'provider diagnostic first\n  provider child detail\nprovider final detail',
    );
    await scope.stop();
    return { slug: item.slug, status: 'done' };
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runDaemonWithVerbosity(verbose: boolean): Promise<string[]> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-log-verbosity-'));
  tempDirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await mkdir(fixture.worktreePath, { recursive: true });
  await writeFile(
    join(repo, '.ai-conductor', 'config.yml'),
    `daemon_verbose: ${verbose}\n`,
    'utf8',
  );

  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    await runDaemonMode({
      projectRoot: repo,
      concurrency: 1,
      maxItems: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      watch: false,
      workSource: { discover: async () => [{ slug: 'feature-a' }] },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  return (await readFile(daemonLogPath(repo), 'utf8'))
    .trimEnd()
    .split('\n')
    .filter((line) => line.includes('provider diagnostic') || line.includes('provider child detail') || line.includes('provider final detail'));
}

describe('acceptance: daemon log verbosity', () => {
  it('collapses a feature provider diagnostic to one informative default-log line', async () => {
    const lines = await runDaemonWithVerbosity(false);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[daemon][feature-a] provider diagnostic first');
    expect(lines[0]).toContain('+2 more lines');
    expect(lines[0]).toContain('daemon_verbose: true');
  });

  it('shows every non-blank provider diagnostic line with marked continuations in verbose mode', async () => {
    const lines = await runDaemonWithVerbosity(true);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('[daemon][feature-a] provider diagnostic first');
    expect(lines[1]).toContain('[daemon][feature-a] │   provider child detail');
    expect(lines[2]).toContain('[daemon][feature-a] │ provider final detail');
  });
});
