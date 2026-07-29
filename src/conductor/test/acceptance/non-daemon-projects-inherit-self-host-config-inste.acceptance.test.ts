import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../../src/engine/config.js';

const execFileAsync = promisify(execFile);
const conductorDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const repoRoot = join(conductorDir, '..', '..');
const distEntry = join(conductorDir, 'dist', 'index.js');
const projectTemplate = join(
  repoRoot,
  'templates',
  'project-config.yml.template',
);
const forbiddenSeedKeys = [
  'harness_self_host',
  'owner_gate_cutover',
  'auto_restart_on_stale_engine',
  'attribution_enforcement_cutover',
  'attribution_judge_cutover',
  'attribution_audit_sample_pct',
  'wiring:',
  'manual_test:',
];

let sandbox: string | undefined;

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('node', [distEntry, ...args], {
      cwd,
      env: {
        ...process.env,
        AI_CONDUCTOR_REGISTRY: join(cwd, '.registry.json'),
        CI: '1',
      },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function initGitRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFileAsync('git', ['init', '-q', '-b', 'main', path]);
}

beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: conductorDir });
  expect(existsSync(distEntry)).toBe(true);
}, 60_000);

afterEach(async () => {
  if (sandbox) {
    await rm(sandbox, { recursive: true, force: true });
    sandbox = undefined;
  }
});

describe('deterministic project-config scaffolding (#683)', () => {
  it('conduct create writes a loadable project config from the safe project template', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'project-config-create-'));

    const result = await runCli(['create', 'fresh-project'], sandbox);

    expect(result.code).toBe(0);
    const projectRoot = join(sandbox, 'fresh-project');
    const configPath = join(projectRoot, '.ai-conductor', 'config.yml');
    const [actual, expected] = await Promise.all([
      readFile(configPath, 'utf8'),
      readFile(projectTemplate, 'utf8'),
    ]);
    expect(actual).toBe(expected);
    for (const key of forbiddenSeedKeys) {
      expect(actual).not.toContain(key);
    }
    expect(await loadConfig(projectRoot)).toMatchObject({ ok: true });
  });

  it('conduct create refuses a non-empty target without creating project-config state', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'project-config-clobber-'));
    const target = join(sandbox, 'occupied');
    await mkdir(target);
    await writeFile(join(target, 'operator.txt'), 'keep me\n', 'utf8');

    const result = await runCli(['create', 'occupied'], sandbox);

    expect(result.code).not.toBe(0);
    expect(await readFile(join(target, 'operator.txt'), 'utf8')).toBe('keep me\n');
    expect(existsSync(join(target, '.ai-conductor'))).toBe(false);
  });

  it('config init seeds an existing git repo once and is idempotent', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'project-config-init-'));
    await initGitRepo(sandbox);

    const first = await runCli(['config', 'init'], sandbox);
    const configPath = join(sandbox, '.ai-conductor', 'config.yml');
    const firstBytes = await readFile(configPath, 'utf8');
    const second = await runCli(['config', 'init'], sandbox);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.stdout + second.stderr).toMatch(/already exists/i);
    expect(await readFile(configPath, 'utf8')).toBe(firstBytes);
    expect(firstBytes).toBe(await readFile(projectTemplate, 'utf8'));
  });

  it('config init preserves operator edits and rejects a non-git directory without writing', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'project-config-negative-'));
    const repo = join(sandbox, 'repo');
    const plain = join(sandbox, 'plain');
    await initGitRepo(repo);
    await mkdir(join(repo, '.ai-conductor'), { recursive: true });
    const editedConfig = 'harness_version: 2026-04-07\ncustom: operator-value\n';
    await writeFile(
      join(repo, '.ai-conductor', 'config.yml'),
      editedConfig,
      'utf8',
    );
    await mkdir(plain);

    const existing = await runCli(['config', 'init'], repo);
    const nonGit = await runCli(['config', 'init'], plain);

    expect(existing.code).toBe(0);
    expect(await readFile(join(repo, '.ai-conductor', 'config.yml'), 'utf8')).toBe(
      editedConfig,
    );
    expect(nonGit.code).not.toBe(0);
    expect(existsSync(join(plain, '.ai-conductor'))).toBe(false);
  });
});
