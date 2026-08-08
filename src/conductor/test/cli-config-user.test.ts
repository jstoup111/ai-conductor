import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import {
  createProgram,
  userConfigReadCommand,
  userConfigWriteCommand,
} from '../src/cli.js';

let home: string | undefined;
const originalHome = process.env.HOME;

afterEach(async () => {
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

  it('distinguishes user-scoped read from project-scoped init in config help', async () => {
    const config = createProgram().commands.find((command) => command.name() === 'config');
    const help = config?.helpInformation() ?? '';

    expect(help).toMatch(/read.*user-scoped|user-scoped.*read/is);
    expect(help).toMatch(/write.*user-scoped|user-scoped.*write/is);
    expect(help).toMatch(/init.*project-scoped|project-scoped.*init/is);
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
