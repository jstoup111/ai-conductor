/**
 * Acceptance specs for
 * .docs/stories/update-check-config-single-source-of-truth.md (ST-1400-1..4).
 *
 * These specs drive the real public command entry points. They deliberately do
 * not import the proposed config-set detector, scalar writer, bash accessors,
 * or legacy seed: a direct helper test could pass while bin/update, bin/conduct,
 * or the conduct-ts dispatch chain remained wired to the legacy JSON.
 *
 * Story-flow classification:
 * - ST-1400-1: multi-step (write/dispatch, then read observable config state)
 * - ST-1400-2: multi-step (seed, rename, then perform the requested write)
 * - ST-1400-3: multi-step here only for real CLI wiring (set, then read)
 * - ST-1400-4: multi-step (failed read, then advisory update-entry decision)
 * - ST-1400-5: unit-covered by its dedicated integrity-check fixture
 * - ST-1400-6: unit/static-covered by deletion and documentation checks
 *
 * Production entry points covered: bin/update --auto / --set-channel,
 * bin/conduct --set-channel, and bin/conduct-ts config set / config read.
 * No third-party service is called; git is replaced with a deterministic fake.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa, type ResultPromise } from 'execa';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const REAL_CONDUCT = join(REPO_ROOT, 'bin', 'conduct');
const REAL_UPDATE = join(REPO_ROOT, 'bin', 'update');
const REAL_COMMON = join(REPO_ROOT, 'bin', 'lib', 'harness-common.sh');

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface FixtureHarness {
  root: string;
  update: string;
  gitLog: string;
  env: NodeJS.ProcessEnv;
}

let scratch: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'update-config-acceptance-'));
  home = join(scratch, 'home');
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const child: ResultPromise = execa(executable, args, {
    cwd: scratch,
    env,
    reject: false,
    timeout: 10_000,
  });
  const result = await child;
  return {
    exitCode: result.exitCode ?? -1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

async function writeUserConfig(yaml: string): Promise<string> {
  const path = join(home, '.ai-conductor', 'config.yml');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, yaml, 'utf8');
  return path;
}

async function makeHarness(options: { withConductor?: boolean } = {}): Promise<FixtureHarness> {
  const root = join(scratch, 'harness');
  const bin = join(root, 'bin');
  const lib = join(bin, 'lib');
  const update = join(bin, 'update');
  const gitLog = join(scratch, 'git-calls.log');
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(lib, { recursive: true });
  await copyFile(REAL_UPDATE, update);
  await copyFile(REAL_COMMON, join(lib, 'harness-common.sh'));
  await chmod(update, 0o755);

  if (options.withConductor !== false) {
    await symlink(REAL_CONDUCT_TS, join(bin, 'conduct-ts'));
  }

  const fakeGit = join(bin, 'git');
  await writeFile(
    fakeGit,
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$FAKE_GIT_LOG"\nexit 1\n',
    'utf8',
  );
  await chmod(fakeGit, 0o755);

  return {
    root,
    update,
    gitLog,
    env: {
      ...process.env,
      HOME: home,
      FAKE_GIT_LOG: gitLog,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    },
  };
}

function parsedConfig(raw: string): Record<string, unknown> {
  return loadYaml(raw) as Record<string, unknown>;
}

describe('update-check config uses one schema-owned surface (#1400)', () => {
  it('dispatches real config set/read commands, preserves unrelated config, and writes typed scalars', async () => {
    const configPath = await writeUserConfig(
      'markdown_viewer:\n  command: glow\n  args: ["-p"]\n',
    );
    const env = { ...process.env, HOME: home };

    const channelSet = await run(
      REAL_CONDUCT_TS,
      ['config', 'set', 'conductor.update_channel', 'main'],
      env,
    );
    expect(channelSet.exitCode).toBe(0);

    const autoSet = await run(
      REAL_CONDUCT_TS,
      ['config', 'set', 'conductor.auto_check', 'false'],
      env,
    );
    expect(autoSet.exitCode).toBe(0);

    const readBack = await run(
      REAL_CONDUCT_TS,
      ['config', 'read', 'conductor.update_channel'],
      env,
    );
    // This acceptance seam proves the real dispatcher reaches `config read`;
    // the persisted YAML below is the durable observable for the complete
    // set/read flow. Output formatting is covered by cli-config-user tests.
    expect(readBack.exitCode).toBe(0);

    const config = parsedConfig(await readFile(configPath, 'utf8'));
    expect(config).toMatchObject({
      conductor: { update_channel: 'main', auto_check: false },
      markdown_viewer: { command: 'glow', args: ['-p'] },
    });
  });

  it('keeps both real update CLIs on the YAML surface instead of recreating legacy JSON', async () => {
    const harness = await makeHarness();
    const env = {
      ...harness.env,
      PATH: `${join(harness.root, 'bin')}:${REPO_ROOT}/bin:${process.env.PATH ?? ''}`,
    };

    const updateResult = await run(harness.update, ['--set-channel', 'main'], env);
    expect(updateResult.exitCode).toBe(0);

    const conductResult = await run(REAL_CONDUCT, ['--set-channel', 'tagged'], env);
    expect(conductResult.exitCode).toBe(0);

    const config = parsedConfig(
      await readFile(join(home, '.ai-conductor', 'config.yml'), 'utf8'),
    );
    expect(config).toMatchObject({ conductor: { update_channel: 'tagged' } });
    expect(existsSync(join(home, '.claude', 'ai-conductor.config.json'))).toBe(false);
  });

  it('seeds live legacy identity before a fresh write, renames the seed, and preserves unrelated YAML', async () => {
    const harness = await makeHarness();
    const configPath = await writeUserConfig(
      'conductor:\n' +
        '  update_channel: tagged\n' +
        '  current_version: v0.99.12\n' +
        'markdown_viewer:\n' +
        '  command: glow\n',
    );
    const legacyPath = join(home, '.claude', 'ai-conductor.config.json');
    const legacyRaw = JSON.stringify(
      {
        updateChannel: 'main',
        autoCheck: false,
        currentVersion: 'v0.100.0',
        lastCheckedAt: '2026-08-09T11:29:25Z',
      },
      null,
      2,
    ) + '\n';
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, legacyRaw, 'utf8');

    const result = await run(harness.update, ['--set-channel', 'tagged'], harness.env);

    expect(result.exitCode).toBe(0);
    expect(existsSync(legacyPath)).toBe(false);
    expect(await readFile(`${legacyPath}.migrated`, 'utf8')).toBe(legacyRaw);
    expect(parsedConfig(await readFile(configPath, 'utf8'))).toMatchObject({
      conductor: {
        update_channel: 'tagged',
        auto_check: false,
        current_version: 'v0.100.0',
        last_checked_at: '2026-08-09T11:29:25Z',
      },
      markdown_viewer: { command: 'glow' },
    });
  });

  it('treats a migrated legacy backup as inert and silently skips auto-check when YAML disables it', async () => {
    const harness = await makeHarness();
    await writeUserConfig(
      'conductor:\n  update_channel: main\n  auto_check: false\n',
    );
    const migratedPath = join(home, '.claude', 'ai-conductor.config.json.migrated');
    await mkdir(dirname(migratedPath), { recursive: true });
    await writeFile(migratedPath, '{"autoCheck":true,"updateChannel":"tagged"}\n', 'utf8');

    const result = await run(harness.update, ['--auto'], harness.env);

    expect(result).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
    expect(existsSync(harness.gitLog)).toBe(false);
  });

  it('reports malformed YAML and declines the advisory auto-check without invoking git', async () => {
    const harness = await makeHarness();
    await writeUserConfig('conductor:\n  update_channel: [\n');

    const result = await run(harness.update, ['--auto'], harness.env);

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/unable to read user config|parse error/i);
    expect(existsSync(harness.gitLog)).toBe(false);
  });

  it('names a missing conduct-ts prerequisite and contains the advisory failure', async () => {
    const harness = await makeHarness({ withConductor: false });
    await writeUserConfig('conductor:\n  auto_check: true\n');
    const env = {
      ...harness.env,
      PATH: `${join(harness.root, 'bin')}:/usr/bin:/bin`,
    };

    const result = await run(harness.update, ['--auto'], env);

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/conduct-ts/i);
    expect(existsSync(harness.gitLog)).toBe(false);
  });
});
