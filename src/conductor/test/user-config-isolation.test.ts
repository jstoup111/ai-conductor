// Covers: task:2
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

import { loadMergedConfig } from '../src/engine/config.js';
import { resolveOtelConfig } from '../src/engine/otel/otel-config.js';
import { USER_CONFIG_DIR_ENV } from '../src/engine/user-config.js';
import { RUN_TMP_ROOT_ENV } from './tmpdir-leak-guard.js';

const execFile = promisify(execFileCallback);
const originalHome = process.env.HOME;
const originalNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;

describe.sequential('user config test isolation', () => {
  let fixtureRoot: string;
  let plantedHome: string;
  let overrideDir: string | undefined;
  let priorOverrideConfig: Buffer | undefined;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'user-config-isolation-project-'));
    plantedHome = await mkdtemp(join(tmpdir(), 'user-config-isolation-home-'));
    overrideDir = process.env[USER_CONFIG_DIR_ENV];
    if (overrideDir) {
      try {
        priorOverrideConfig = await readFile(join(overrideDir, 'config.yml'));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }

    await mkdir(join(fixtureRoot, '.ai-conductor'), { recursive: true });
    await writeFile(join(fixtureRoot, '.ai-conductor', 'config.yml'), '{}\n', 'utf8');
    await mkdir(join(plantedHome, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(plantedHome, '.ai-conductor', 'config.yml'),
      'conductor:\n  update_channel: main\notel:\n  exporter: otlp\n  endpoint: http://127.0.0.1:1\n',
      'utf8',
    );
    process.env.HOME = plantedHome;
  });

  afterEach(async () => {
    if (overrideDir) {
      const configPath = join(overrideDir, 'config.yml');
      if (priorOverrideConfig === undefined) await rm(configPath, { force: true });
      else await writeFile(configPath, priorOverrideConfig);
    }
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalNoRealExec === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    else process.env.AI_CONDUCTOR_NO_REAL_EXEC = originalNoRealExec;
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(plantedHome, { recursive: true, force: true }),
    ]);
  });

  async function seedRunUserConfig(updateChannel = 'tagged'): Promise<string> {
    const configDir = process.env[USER_CONFIG_DIR_ENV];
    if (!configDir) throw new Error(`${USER_CONFIG_DIR_ENV} must be assigned by test/setup.ts`);
    await mkdir(configDir, { recursive: true });
    await writeFile(configDir + '/config.yml', `conductor:\n  update_channel: ${updateChannel}\n`, 'utf8');
    return configDir;
  }

  async function mergedConfig() {
    const result = await loadMergedConfig(fixtureRoot);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    return result.config;
  }

  it('assigns a run-root-bounded user-config directory', () => {
    const configDir = process.env[USER_CONFIG_DIR_ENV];
    const runRoot = process.env[RUN_TMP_ROOT_ENV];

    expect(configDir).toBeTruthy();
    expect(runRoot).toBeTruthy();
    expect(relative(runRoot!, configDir!)).not.toMatch(/^\.\.(?:[/\\]|$)/);
  });

  it('does not inherit the planted home otlp exporter', async () => {
    await seedRunUserConfig();

    const config = await mergedConfig();

    expect(config.conductor?.update_channel).toBe('tagged');
    expect(resolveOtelConfig(config, join(fixtureRoot, '.pipeline')).enabled).toBe(false);
  });

  it('keeps user-config isolation when real execution is enabled', async () => {
    await seedRunUserConfig();
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

    const config = await mergedConfig();

    expect(config.conductor?.update_channel).toBe('tagged');
    expect(resolveOtelConfig(config, join(fixtureRoot, '.pipeline')).enabled).toBe(false);
  });

  it('passes the isolated user config to inherited child environments', async () => {
    await seedRunUserConfig();
    const configModule = join(process.cwd(), 'src', 'engine', 'config.ts');
    const script = [
      `import { loadMergedConfig } from ${JSON.stringify(configModule)};`,
      'const result = await loadMergedConfig(process.cwd());',
      'if (!result.ok) throw new Error(result.error.message);',
      'console.log(JSON.stringify(result.config));',
    ].join(' ');

    const { stdout } = await execFile(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: fixtureRoot, env: process.env },
    );
    const config = JSON.parse(stdout) as { conductor?: { update_channel?: string }; otel?: unknown };

    expect(config.conductor?.update_channel).toBe('tagged');
    expect(config.otel).toBeUndefined();
  });

  it('merges the run-scoped user config below the fixture project config', async () => {
    await seedRunUserConfig();
    await writeFile(
      join(fixtureRoot, '.ai-conductor', 'config.yml'),
      'markdown_viewer:\n  command: less\n  args: ["{file}"]\n  mode: inline\n',
      'utf8',
    );

    const config = await mergedConfig();

    expect(config.markdown_viewer?.command).toBe('less');
  });
});
