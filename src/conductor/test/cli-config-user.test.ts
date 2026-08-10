import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { execa } from 'execa';
import {
  createProgram,
  userConfigReadCommand,
  userConfigSetCommand,
  userConfigWriteCommand,
  detectUserConfigSetCommand,
  detectUserConfigWriteCommand,
} from '../src/cli.js';

let home: string | undefined;
let projectRoot: string | undefined;
const originalHome = process.env.HOME;
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
  if (home) {
    await rm(home, { recursive: true, force: true });
    home = undefined;
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('conduct config read', () => {
  it('prints a configured user-scoped markdown viewer command and exits zero', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    await mkdir(configDir);
    await writeFile(
      join(configDir, 'config.yml'),
      'markdown_viewer:\n  command: glow\n',
      'utf8',
    );
    process.env.HOME = home;
    let stdout = '';
    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'markdown_viewer.command' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: 'glow\n' });
  });

  it('describes effective read and scoped write/init behavior in config help', async () => {
    const config = createProgram().commands.find((command) => command.name() === 'config');
    const help = config?.helpInformation() ?? '';

    expect(help).toMatch(/read.*effective configuration.*project-over-user.*user configuration|effective configuration.*project-over-user.*user configuration.*read/is);
    expect(help).toMatch(/write.*user-scoped|user-scoped.*write/is);
    expect(help).toMatch(/init.*project-scoped|project-scoped.*init/is);
  });

  it('prefers a project conflict-check ADR corpus over the user configuration', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-project-config-'));
    await mkdir(join(home, '.ai-conductor'));
    await mkdir(join(projectRoot, '.ai-conductor'));
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'conflict_check:\n  adr_corpus: /user/adrs\n',
      'utf8',
    );
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'conflict_check:\n  adr_corpus: /project/adrs\n',
      'utf8',
    );
    process.env.HOME = home;
    process.chdir(projectRoot);
    let stdout = '';

    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'conflict_check.adr_corpus' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: '/project/adrs\n' });
  });

  it('reads a user conflict-check ADR corpus when the project has no configuration file', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-project-config-'));
    await mkdir(join(home, '.ai-conductor'));
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'conflict_check:\n  adr_corpus: /user/adrs\n',
      'utf8',
    );
    process.env.HOME = home;
    process.chdir(projectRoot);
    let stdout = '';

    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'conflict_check.adr_corpus' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: '/user/adrs\n' });
  });

  it('falls back to the user conflict-check ADR corpus when the project has no value', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-project-config-'));
    await mkdir(join(home, '.ai-conductor'));
    await mkdir(join(projectRoot, '.ai-conductor'));
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'conflict_check:\n  adr_corpus: /user/adrs\n',
      'utf8',
    );
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'conductor: {}\n', 'utf8');
    process.env.HOME = home;
    process.chdir(projectRoot);
    let stdout = '';

    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'conflict_check.adr_corpus' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: '/user/adrs\n' });
  });

  it('falls back to the user conflict-check ADR corpus when the project config is empty', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-project-config-'));
    await mkdir(join(home, '.ai-conductor'));
    await mkdir(join(projectRoot, '.ai-conductor'));
    await writeFile(
      join(home, '.ai-conductor', 'config.yml'),
      'conflict_check:\n  adr_corpus: /user/adrs\n',
      'utf8',
    );
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), '', 'utf8');
    process.env.HOME = home;
    process.chdir(projectRoot);
    let stdout = '';

    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'conflict_check.adr_corpus' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: '/user/adrs\n' });
  });

  it('prints an empty conflict-check ADR corpus when neither scope provides one', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-project-config-'));
    await mkdir(join(home, '.ai-conductor'));
    await mkdir(join(projectRoot, '.ai-conductor'));
    await writeFile(join(home, '.ai-conductor', 'config.yml'), 'conductor: {}\n', 'utf8');
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'conductor: {}\n', 'utf8');
    process.env.HOME = home;
    process.chdir(projectRoot);
    let stdout = '';

    const code = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'conflict_check.adr_corpus' },
      (output) => (stdout += output),
    );

    expect({ code, stdout }).toEqual({ code: 0, stdout: '\n' });
  });
});

describe('conduct config write', () => {
  it('writes a user-scoped markdown viewer configuration', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    process.env.HOME = home;

    const code = await userConfigWriteCommand({
      kind: 'user-config-write',
      section: 'markdown_viewer',
      preset: 'glow',
      command: 'glow',
      args: ['-p', '{file}'],
      mode: 'inline',
    });

    const content = await readFile(join(home, '.ai-conductor', 'config.yml'), 'utf8');
    expect({ code, config: loadYaml(content) }).toEqual({
      code: 0,
      config: {
        markdown_viewer: {
          preset: 'glow',
          command: 'glow',
          args: ['-p', '{file}'],
          mode: 'inline',
        },
      },
    });
  });

  it('preserves unrelated top-level YAML keys when writing a user-scoped renderer', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    await mkdir(configDir);
    await writeFile(join(configDir, 'config.yml'), 'conductor:\n  update_channel: main\n');
    process.env.HOME = home;

    await userConfigWriteCommand({
      kind: 'user-config-write',
      section: 'mermaid_renderer',
      preset: 'mmdc',
      command: 'mmdc',
      args: ['-i', '{file}'],
      mode: 'external',
    });

    const content = await readFile(join(configDir, 'config.yml'), 'utf8');
    expect(loadYaml(content)).toEqual({
      conductor: { update_channel: 'main' },
      mermaid_renderer: {
        preset: 'mmdc',
        command: 'mmdc',
        args: ['-i', '{file}'],
        mode: 'external',
      },
    });
  });
});

describe('conduct config set', () => {
  it('dispatches config set through the real argv entry point', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    await mkdir(configDir);
    await writeFile(configPath, 'conductor:\n  update_channel: tagged\n', 'utf8');

    const result = await execa(
      'node',
      ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'config', 'set', 'conductor.update_channel', 'main'],
      { env: { ...process.env, HOME: home }, reject: false },
    );

    expect({ exitCode: result.exitCode, config: loadYaml(await readFile(configPath, 'utf8')) }).toEqual({
      exitCode: 0,
      config: { conductor: { update_channel: 'main' } },
    });
  });

  it('detects a dotted scalar config set command', () => {
    expect(
      detectUserConfigSetCommand([
        'node',
        'conduct-ts',
        'config',
        'set',
        'conductor.update_channel',
        'main',
      ]),
    ).toEqual({
      kind: 'user-config-set',
      path: 'conductor.update_channel',
      value: 'main',
    });
  });

  it('does not detect config set without both a path and value', () => {
    expect([
      detectUserConfigSetCommand(['node', 'conduct-ts', 'config', 'set']),
      detectUserConfigSetCommand(['node', 'conduct-ts', 'config', 'set', 'conductor.auto_check']),
    ]).toEqual([null, null]);
  });

  it('leaves the existing config write grammar to its own detector', () => {
    const argv = [
      'node',
      'conduct-ts',
      'config',
      'write',
      'markdown_viewer',
      'glow',
      'glow',
      '-p {file}',
      'inline',
    ];

    expect({
      set: detectUserConfigSetCommand(argv),
      write: detectUserConfigWriteCommand(argv),
    }).toEqual({
      set: null,
      write: {
        kind: 'user-config-write',
        section: 'markdown_viewer',
        preset: 'glow',
        command: 'glow',
        args: ['-p', '{file}'],
        mode: 'inline',
      },
    });
  });

  it('persists a valid update channel without replacing unrelated top-level keys', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    await mkdir(configDir);
    await writeFile(
      configPath,
      'markdown_viewer:\n  command: glow\nconductor:\n  update_channel: tagged\n',
      'utf8',
    );
    process.env.HOME = home;

    const code = await userConfigSetCommand({
      kind: 'user-config-set',
      path: 'conductor.update_channel',
      value: 'main',
    });

    expect({ code, config: loadYaml(await readFile(configPath, 'utf8')) }).toEqual({
      code: 0,
      config: {
        markdown_viewer: { command: 'glow' },
        conductor: { update_channel: 'main' },
      },
    });
  });

  it('coerces auto check strings to YAML booleans and creates a missing conductor block', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configPath = join(home, '.ai-conductor', 'config.yml');
    process.env.HOME = home;

    const code = await userConfigSetCommand({
      kind: 'user-config-set',
      path: 'conductor.auto_check',
      value: 'true',
    });

    expect({ code, config: loadYaml(await readFile(configPath, 'utf8')) }).toEqual({
      code: 0,
      config: { conductor: { auto_check: true } },
    });
  });

  it('rejects an invalid update channel without modifying user config', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    const original = 'conductor:\n  update_channel: tagged\n';
    await mkdir(configDir);
    await writeFile(configPath, original, 'utf8');
    process.env.HOME = home;
    let output = '';

    const code = await userConfigSetCommand(
      { kind: 'user-config-set', path: 'conductor.update_channel', value: 'nightly' },
      (message) => (output += message),
    );

    expect({ code, output, content: await readFile(configPath, 'utf8') }).toEqual({
      code: 1,
      output: expect.stringContaining('update_channel'),
      content: original,
    });
  });

  it('rejects a non-boolean auto check without modifying user config', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    const original = 'conductor:\n  auto_check: true\n';
    await mkdir(configDir);
    await writeFile(configPath, original, 'utf8');
    process.env.HOME = home;
    let output = '';

    const code = await userConfigSetCommand(
      { kind: 'user-config-set', path: 'conductor.auto_check', value: 'sometimes' },
      (message) => (output += message),
    );

    expect({ code, output, content: await readFile(configPath, 'utf8') }).toEqual({
      code: 1,
      output: expect.stringContaining('auto_check'),
      content: original,
    });
  });

  it('rejects an unknown conductor key without modifying user config', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    const original = 'conductor:\n  update_channel: tagged\n';
    await mkdir(configDir);
    await writeFile(configPath, original, 'utf8');
    process.env.HOME = home;
    let output = '';

    const code = await userConfigSetCommand(
      { kind: 'user-config-set', path: 'conductor.unknown', value: 'value' },
      (message) => (output += message),
    );

    expect({ code, output, content: await readFile(configPath, 'utf8') }).toEqual({
      code: 1,
      output: expect.stringContaining('Unknown key'),
      content: original,
    });
  });

  it('does not overwrite an unparseable user config', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    const original = 'conductor: [';
    await mkdir(configDir);
    await writeFile(configPath, original, 'utf8');
    process.env.HOME = home;
    let output = '';

    const code = await userConfigSetCommand(
      { kind: 'user-config-set', path: 'conductor.update_channel', value: 'main' },
      (message) => (output += message),
    );

    expect({ code, output, content: await readFile(configPath, 'utf8') }).toEqual({
      code: 1,
      output: expect.stringContaining(configPath),
      content: original,
    });
  });

  it('does not modify user config when its directory is unwritable', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    const original = 'conductor:\n  update_channel: tagged\n';
    await mkdir(configDir);
    await writeFile(configPath, original, 'utf8');
    process.env.HOME = home;
    let output = '';

    await chmod(configDir, 0o500);
    let code: number;
    try {
      code = await userConfigSetCommand(
        { kind: 'user-config-set', path: 'conductor.update_channel', value: 'main' },
        (message) => (output += message),
      );
    } finally {
      await chmod(configDir, 0o700);
    }

    expect({ code: code!, output, content: await readFile(configPath, 'utf8') }).toEqual({
      code: 1,
      output: expect.stringContaining(configPath),
      content: original,
    });
  });
});

describe('conduct config failure modes', () => {
  it('distinguishes malformed, absent, and unwritable user config', async () => {
    home = await mkdtemp(join(tmpdir(), 'conduct-user-config-'));
    const configDir = join(home, '.ai-conductor');
    const configPath = join(configDir, 'config.yml');
    await mkdir(configDir);
    process.env.HOME = home;

    await writeFile(configPath, 'markdown_viewer: [', 'utf8');
    let malformedOutput = '';
    const malformedCode = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'markdown_viewer.command' },
      (output) => (malformedOutput += output),
    );

    await writeFile(configPath, 'conductor:\n  update_channel: main\n', 'utf8');
    let absentOutput = '';
    const absentCode = await userConfigReadCommand(
      { kind: 'user-config-read', path: 'markdown_viewer.command' },
      (output) => (absentOutput += output),
    );

    await chmod(configDir, 0o500);
    let unwritableOutput = '';
    const unwritableCode = await userConfigWriteCommand(
      {
        kind: 'user-config-write',
        section: 'markdown_viewer',
        preset: 'glow',
        command: 'glow',
        args: [],
        mode: 'inline',
      },
      (output) => (unwritableOutput += output),
    );
    await chmod(configDir, 0o700);

    expect({ malformedCode, malformedOutput }).toMatchObject({
      malformedCode: 1,
      malformedOutput: expect.stringContaining(configPath),
    });
    expect({ absentCode, absentOutput }).toEqual({ absentCode: 0, absentOutput: '\n' });
    expect({ unwritableCode, unwritableOutput }).toMatchObject({
      unwritableCode: 1,
      unwritableOutput: expect.stringContaining(configPath),
    });
    expect(await readFile(configPath, 'utf8')).toBe('conductor:\n  update_channel: main\n');
  });
});
