// Covers: task:9
//
// Daemon startup boundary coverage. The real merged config loader and daemon
// event bus run against temporary local files; the daemon's external seams are
// injected so this test cannot contact a provider or GitHub.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemonMode } from '../src/daemon-cli.js';
import { allInstalledProviderDiscoveryRunner } from './engine/boot-test-helpers.js';

const dirs: string[] = [];
let previousHome: string | undefined;

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  previousHome = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function daemonDeprecatedKeys(
  projectConfig: string,
  userConfig: string,
): Promise<string[]> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-deprecated-project-'));
  const home = await mkdtemp(join(tmpdir(), 'daemon-deprecated-home-'));
  dirs.push(projectRoot, home);
  await Promise.all([
    mkdir(join(projectRoot, '.ai-conductor'), { recursive: true }),
    mkdir(join(home, '.ai-conductor'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), projectConfig, 'utf8'),
    writeFile(join(home, '.ai-conductor', 'config.yml'), userConfig, 'utf8'),
  ]);
  previousHome = process.env.HOME;
  process.env.HOME = home;

  await runDaemonMode({
    projectRoot,
    concurrency: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
    workSource: { discover: async () => [] },
    watch: false,
  });

  const ledger = await readFile(join(projectRoot, '.daemon', 'events.jsonl'), 'utf8').catch(() => '');
  return ledger
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; key?: string })
    .filter((event) => event.type === 'config_deprecated_key')
    .map((event) => event.key!);
}

describe('daemon deprecated config key emission', () => {
  it.each([
    ['deduplicates wiring present in both project and user config', 'wiring: {}\n', 'wiring: {}\n', ['wiring']],
    ['emits wiring from user config when the project config omits it', '', 'wiring: {}\n', ['wiring']],
    ['emits nothing when neither config contains wiring', '', '', []],
  ])('%s', async (_name, projectConfig, userConfig, expected) => {
    await expect(daemonDeprecatedKeys(projectConfig, userConfig)).resolves.toEqual(expected);
  });
});
