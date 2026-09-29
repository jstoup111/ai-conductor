// Covers: task:8
//
// Daemon-startup boundary coverage: mock only the executing harness identity;
// load the project config through the production config loader.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allInstalledProviderDiscoveryRunner } from './engine/boot-test-helpers.js';

type InstalledHarnessVersionForConfig = typeof import('../src/engine/version-report.js').installedHarnessVersionForConfig;

const installedHarnessVersionForConfig = vi.hoisted(() => vi.fn<InstalledHarnessVersionForConfig>());

vi.mock('../src/engine/version-report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/version-report.js')>();
  return { ...actual, installedHarnessVersionForConfig };
});

import { runDaemonMode } from '../src/daemon-cli.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  installedHarnessVersionForConfig.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runWithConstraint(constraint: string): Promise<Error | undefined> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-harness-version-gate-'));
  roots.push(root);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), `harness_version: "${constraint}"\n`);
  installedHarnessVersionForConfig.mockResolvedValue('1.5.0');

  try {
    await runDaemonMode({
      projectRoot: root,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      workSource: { discover: async () => [] },
      watch: false,
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}

describe('daemon harness version gate', () => {
  it('rejects a project constraint the installed harness does not satisfy', async () => {
    const error = await runWithConstraint('^2.0.0');

    expect(error?.message).toMatch(/Config error:.*1\.5\.0.*\^2\.0\.0/is);
  });

  it('allows a project constraint the installed harness satisfies', async () => {
    const error = await runWithConstraint('^1.2.0');

    expect(error).toBeUndefined();
  });
});
