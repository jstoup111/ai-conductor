import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';
import {
  PRE_DISPATCH_COMMANDS,
  routeSubcommandHelp,
} from '../../src/cli-pre-dispatch.js';

const REPO_ROOT = join(process.cwd(), '..', '..');
const AI_CONDUCTOR = join(REPO_ROOT, 'bin', 'ai-conductor');

function commandHelp(path: readonly string[]): string {
  let command = createProgram();
  for (const name of path) {
    const next = command.commands.find((candidate) => candidate.name() === name);
    expect(next, `missing command declaration: ${path.join(' ')}`).toBeDefined();
    command = next!;
  }
  return command.helpInformation();
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'help-router-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('per-command help router', () => {
  // Covers: task:5
  it('returns Commander help for register, create, and memory setup, with -h as an alias', () => {
    const expected = commandHelp(['register']);

    expect(routeSubcommandHelp(['node', 'bin', 'register', '--help'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'register', '-h'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'create', '-h']))
      .toBe(commandHelp(['create']));
    expect(routeSubcommandHelp(['node', 'bin', 'memory', 'setup', '-h']))
      .toBe(commandHelp(['memory', 'setup']));
  });

  // Covers: task:5
  it('returns each declared command path\'s own help, including nested and hidden commands', () => {
    expect(routeSubcommandHelp(['node', 'bin', 'create', '--help']))
      .toBe(commandHelp(['create']));
    expect(routeSubcommandHelp(['node', 'bin', 'memory', 'setup', '--help']))
      .toBe(commandHelp(['memory', 'setup']));
    expect(routeSubcommandHelp(['node', 'bin', 'finish-record', '--help']))
      .toBe(commandHelp(['finish-record']));
  });

  // Covers: task:5
  it('uses only the pre-dispatch registry to select command paths', () => {
    const withoutRegister = PRE_DISPATCH_COMMANDS.filter(
      ({ commandPath }) => commandPath[0] !== 'register',
    );

    expect(routeSubcommandHelp(
      ['node', 'bin', 'register', '--help'],
      withoutRegister,
    )).toBeNull();
  });

  // Covers: task:5
  it('prints register help without touching registry state outside a git repository', async () => {
    const cwd = await mkdtemp(join(scratch, 'non-git-'));
    const home = await mkdtemp(join(scratch, 'home-'));
    const registry = join(home, '.ai-conductor', 'registry.json');

    const result = await execa(AI_CONDUCTOR, ['register', '--help'], {
      cwd,
      env: { ...process.env, HOME: home },
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: ai-conductor register');
    expect(result.stdout).not.toContain('not a git repository');
    await expect(stat(registry)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  // Covers: task:5
  it('prints create help without creating a directory', async () => {
    const cwd = await mkdtemp(join(scratch, 'create-cwd-'));
    const target = join(cwd, 'new-project');

    const result = await execa(AI_CONDUCTOR, ['create', '--help'], {
      cwd,
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith('Usage: ai-conductor create')).toBe(true);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  // Covers: task:5
  it('prints hidden finish-record help through the CLI entry without dispatching its handler', async () => {
    const result = await execa(AI_CONDUCTOR, ['finish-record', '--help'], {
      cwd: scratch,
      reject: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith('Usage: ai-conductor finish-record')).toBe(true);
    expect(result.stderr).toBe('');
  }, 30_000);
});
