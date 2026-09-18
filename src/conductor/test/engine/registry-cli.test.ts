// Covers: task:1, task:2, task:3, task:4, task:17, task:19
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as loadYaml } from 'js-yaml';
import {
  loadConfig,
  UNBUDGETABLE_TEST_SUITE_DRIFT_CATEGORIES,
} from '../../src/engine/config.js';
import {
  detectRegistryCommand,
  dispatchRegistry,
} from '../../src/engine/registry-cli.js';

function nonCommentNonBlankLines(raw: string): string[] {
  return raw.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

function preChangeAutoModeRendering(template: string): string {
  return template.replace(
    '# CONFIG_INIT_TEST_SUITE_VERIFICATION',
    [
      '# Test-suite verification answer recorded by ai-conductor config init.',
      'test_suite:',
      '  command: npm test',
      '  verification:',
      '    mode: aggregate',
      '    drift_budget:',
      '      additional_inputs: none',
      '      source: none',
      '      test_infrastructure: none',
      '      tests: none',
    ].join('\n'),
  );
}

describe('conduct-ts config init verification flags', () => {
  let projectRoot: string;
  const repositoryRoot = join(process.cwd(), '..', '..');
  let originalPath: string | undefined;
  let originalGitCallLog: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'registry-cli-config-init-'));
    const fakeBin = join(projectRoot, 'fake-bin');
    await mkdir(fakeBin);
    await writeFile(
      join(fakeBin, 'git'),
      '#!/bin/sh\nif [ -n "$GIT_CALL_LOG" ]; then\n  printf "%s\\n" "$@" >> "$GIT_CALL_LOG"\nfi\nprintf "true\\n"\n',
      'utf8',
    );
    await chmod(join(fakeBin, 'git'), 0o755);
    originalPath = process.env.PATH;
    originalGitCallLog = process.env.GIT_CALL_LOG;
    process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(repositoryRoot);
    process.env.PATH = originalPath;
    if (originalGitCallLog === undefined) {
      delete process.env.GIT_CALL_LOG;
    } else {
      process.env.GIT_CALL_LOG = originalGitCallLog;
    }
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    ['separate flag value', ['--test-suite-command', 'pytest -q']],
    ['equals flag value', ['--test-suite-command=pytest -q']],
  ])('parses the test-suite command from a %s', (_form, flag) => {
    expect(
      detectRegistryCommand([
        'node',
        'conduct-ts',
        'config',
        'init',
        ...flag,
      ]),
    ).toEqual({
      kind: 'config-init',
      testSuiteCommand: 'pytest -q',
      hasVerificationFlags: true,
    });
  });

  it.each([
    ['separate flag value', ['--test-suite-scoped-command', 'npm test -- {selectors}']],
    ['equals flag value', ['--test-suite-scoped-command=npm test -- {selectors}']],
  ])('parses the scoped test-suite command from a %s', (_form, flag) => {
    expect(
      detectRegistryCommand([
        'node',
        'conduct-ts',
        'config',
        'init',
        '--test-suite-mode',
        'scoped',
        ...flag,
      ]),
    ).toEqual({
      kind: 'config-init',
      testSuiteMode: 'scoped',
      testSuiteScopedCommand: 'npm test -- {selectors}',
      hasVerificationFlags: true,
    });
  });

  it.each([
    [
      'strict',
      'aggregate',
      {
        mode: 'aggregate',
        drift_budget: {
          additional_inputs: 'none',
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
      ...(mode === 'scoped'
        ? ['--test-suite-scoped-command', 'npm test -- {selectors}']
        : []),
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const generatedConfig = await readFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'utf8',
    );
    for (const category of UNBUDGETABLE_TEST_SUITE_DRIFT_CATEGORIES) {
      expect(generatedConfig).not.toContain(`      ${category}:`);
    }

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.test_suite?.verification).toMatchObject(verification);
  });

  it('writes the supplied test command under the rendered test_suite block', async () => {
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      'aggregate',
      '--test-suite-drift-budget',
      'strict',
      '--test-suite-command',
      'pytest -q',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const generatedConfig = await readFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'utf8',
    );
    expect(generatedConfig).toMatch(/test_suite:\n  command: pytest -q\n/);
    expect(generatedConfig).not.toMatch(/^  command: npm test$/m);
    expect(generatedConfig).not.toMatch(/^  scoped_command:/m);
  });

  it('quotes and round-trips a YAML-sensitive scoped command only in scoped mode', async () => {
    const scopedCommand = 'make test # {selectors}';
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      'scoped',
      '--test-suite-scoped-command',
      scopedCommand,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const generatedConfig = await readFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'utf8',
    );
    expect(generatedConfig).toContain(`  scoped_command: ${JSON.stringify(scopedCommand)}\n`);

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.test_suite?.scoped_command).toBe(scopedCommand);
  });

  it('quotes a scalar-looking test command so loadConfig reads it back as a string', async () => {
    const testSuiteCommand = 'true';
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-command',
      testSuiteCommand,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const generatedConfig = await readFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'utf8',
    );
    expect(generatedConfig).toMatch(/^  command: "true"$/m);

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.test_suite?.command).toBe(testSuiteCommand);
  });

  it('stores a metacharacter-bearing test command as one YAML scalar', async () => {
    const testSuiteCommand = 'make test && echo done';
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-command',
      testSuiteCommand,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.test_suite?.command).toBe(testSuiteCommand);
  });

  it('records the supplied command without executing it during config init', async () => {
    const executionMarker = join(projectRoot, 'test-suite-command-was-executed');
    const gitCallLog = join(projectRoot, 'git-calls');
    process.env.GIT_CALL_LOG = gitCallLog;
    const testSuiteCommand = `touch ${executionMarker}`;
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-command',
      testSuiteCommand,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    expect(await readFile(gitCallLog, 'utf8')).toBe(
      `-C\n${projectRoot}\nrev-parse\n--is-inside-work-tree\n`,
    );
    expect(existsSync(executionMarker)).toBe(false);

    const generatedConfig = await readFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'utf8',
    );
    expect(generatedConfig).toContain(`command: ${testSuiteCommand}`);
  });

  it('keeps flagless config-init effective settings identical to the pre-change template', async () => {
    const command = detectRegistryCommand(['node', 'conduct-ts', 'config', 'init']);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const config = await readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8');
    const fixture = await readFile(
      join(repositoryRoot, 'src', 'conductor', 'test', 'fixtures', 'config-init-defaults.yml'),
      'utf8',
    );
    expect(loadYaml(config)).toEqual(loadYaml(fixture));
    expect(nonCommentNonBlankLines(config)).toEqual(nonCommentNonBlankLines(fixture));
  });

  it('keeps auto-mode config-init effective settings identical to the pre-change template rendering', async () => {
    const command = detectRegistryCommand([
      'node', 'conduct-ts', 'config', 'init',
      '--test-suite-mode', 'aggregate',
      '--test-suite-drift-budget', 'strict',
    ]);
    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);

    const [config, fixture] = await Promise.all([
      readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8'),
      readFile(join(repositoryRoot, 'src', 'conductor', 'test', 'fixtures', 'config-init-defaults.yml'), 'utf8'),
    ]);
    const preChangeRendering = preChangeAutoModeRendering(fixture);
    expect(loadYaml(config)).toEqual(loadYaml(preChangeRendering));
    expect(nonCommentNonBlankLines(config)).toEqual(nonCommentNonBlankLines(preChangeRendering));
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

  it.each([
    ['empty', ''],
    ['multi-line', 'a\nb'],
  ])('rejects a %s test-suite command without creating a config', async (_shape, commandValue) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-command',
      commandValue,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--test-suite-command'));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/non-empty.*single line/i));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it('refuses scoped verification without its scoped command before creating a config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node', 'conduct-ts', 'config', 'init', '--test-suite-mode', 'scoped',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--test-suite-scoped-command'));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it('refuses a scoped command outside scoped verification before creating a config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      'aggregate',
      '--test-suite-scoped-command',
      'npm test -- {selectors}',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--test-suite-scoped-command'));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it.each([
    ['empty', ''],
    ['multi-line', 'npm test\n-- {selectors}'],
  ])('refuses a %s scoped command before creating a config', async (_shape, scopedCommand) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      'scoped',
      '--test-suite-scoped-command',
      scopedCommand,
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--test-suite-scoped-command'));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/non-empty.*single line/i));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it('refuses a scoped command without {selectors} before creating a config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--test-suite-mode',
      'scoped',
      '--test-suite-scoped-command',
      'npm test',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--test-suite-scoped-command'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('{selectors}'));
    await expect(readFile(join(projectRoot, '.ai-conductor', 'config.yml'))).rejects.toThrow();
  });

  it('rejects an unknown config-init flag without creating a config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = detectRegistryCommand([
      'node',
      'conduct-ts',
      'config',
      'init',
      '--frobnicate',
      'x',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('unsupported flag --frobnicate'),
    );
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
      '--test-suite-scoped-command=npm test -- {selectors}',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it('preserves a hand-edited config when a test command is supplied', async () => {
    const configPath = join(projectRoot, '.ai-conductor', 'config.yml');
    const original = 'test_suite:\n  command: make check\n';
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(configPath, original, 'utf8');
    const command = detectRegistryCommand([
      'node', 'conduct-ts', 'config', 'init', '--test-suite-command', 'pytest',
    ]);

    expect(command).not.toBeNull();
    expect(await dispatchRegistry(command!)).toBe(0);
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });
});
