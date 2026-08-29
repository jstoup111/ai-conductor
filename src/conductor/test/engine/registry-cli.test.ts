// Covers: task:19
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/engine/config.js';
import {
  detectRegistryCommand,
  dispatchRegistry,
} from '../../src/engine/registry-cli.js';

describe('conduct-ts config init verification flags', () => {
  let projectRoot: string;
  const repositoryRoot = join(process.cwd(), '..', '..');
  let originalPath: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'registry-cli-config-init-'));
    const fakeBin = join(projectRoot, 'fake-bin');
    await mkdir(fakeBin);
    await writeFile(
      join(fakeBin, 'git'),
      '#!/bin/sh\nprintf "true\\n"\n',
      'utf8',
    );
    await chmod(join(fakeBin, 'git'), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(repositoryRoot);
    process.env.PATH = originalPath;
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    [
      'strict',
      'aggregate',
      {
        mode: 'aggregate',
        drift_budget: {
          additional_inputs: 'none',
          dependencies: 'none',
          environment: 'none',
          migrations: 'none',
          project_config: 'none',
          source: 'none',
          test_infrastructure: 'none',
          tests: 'none',
        },
      },
    ],
    [
      'tolerant',
      'scoped',
      {
        mode: 'scoped',
        drift_budget: {
          additional_inputs: 'unlimited',
          dependencies: 'none',
          environment: 'none',
          migrations: 'none',
          project_config: 'none',
          source: 20,
          test_infrastructure: 'none',
          tests: 'none',
        },
      },
    ],
  ])('writes a loadable %s verification preset in %s mode', async (preset, mode, verification) => {
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      mode,
      '--test-suite-drift-budget',
      preset,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok && loaded.config.test_suite?.verification).toEqual(verification);
  });

  it('copies the bare template byte-for-byte without verification flags', async () => {
    const command = detectRegistryCommand(['node', 'conduct-ts', 'config', 'init']);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const config = await readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8');
    const template = await readFile(
      join(repositoryRoot, 'templates', 'project-config.yml.template'),
      'utf8',
    );
    expect(config).toBe(template);
  });

  it.each([
    ['--test-suite-mode', 'selective', 'aggregate, scoped'],
    ['--test-suite-drift-budget', 'lenient', 'strict, tolerant'],
  ])('rejects invalid %s values without creating a config', async (flag, value, allowed) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      flag,
      value,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).not.toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(new RegExp(allowed)));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it('preserves an existing config when verification flags are supplied', async () => {
    const configPath = join(projectRoot, '.ai-conductor', 'config.yml');
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(configPath, 'harness_version: ">=0.99.0"\n', 'utf8');
    const before = await readFile(configPath, 'utf8');
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode=scoped',
      '--test-suite-drift-budget=tolerant',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });
});
