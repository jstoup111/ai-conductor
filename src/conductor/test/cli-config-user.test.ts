import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram, userConfigReadCommand } from '../src/cli.js';

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
    expect(help).toMatch(/init.*project-scoped|project-scoped.*init/is);
  });
});
