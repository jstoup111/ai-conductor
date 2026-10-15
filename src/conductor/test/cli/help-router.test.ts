import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram, renderDaemonHelp } from '../../src/cli.js';
import { renderCanonicalFullHelp } from '../../src/index.js';
import { detectUpdateCommand, dispatchUpdateCommand } from '../../src/engine/update-cli.js';
import {
  PRE_DISPATCH_COMMANDS,
  routeSubcommandHelp,
} from '../../src/cli-pre-dispatch.js';

const REPO_ROOT = join(process.cwd(), '..', '..');
const AI_CONDUCTOR = join(REPO_ROOT, 'bin', 'ai-conductor');
const CLI_ENTRY = join(process.cwd(), 'src', 'index.ts');

function runCli(args: readonly string[]) {
  return execa(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW: '1' },
    reject: false,
    stripFinalNewline: false,
  });
}

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
  it('routes help wherever it appears before an option terminator and ignores positionals', () => {
    const expected = commandHelp(['register']);

    expect(routeSubcommandHelp(['node', 'bin', 'register', '--help'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'register', '-h'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'register', '/tmp', '--help'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'register', '--help', '/tmp'])).toBe(expected);
    expect(routeSubcommandHelp(['node', 'bin', 'create', 'demo', '--help']))
      .toBe(commandHelp(['create']));
    expect(routeSubcommandHelp(['node', 'bin', 'create', '-h']))
      .toBe(commandHelp(['create']));
    expect(routeSubcommandHelp(['node', 'bin', 'brain', 'start', '--help']))
      .toBe(commandHelp(['brain', 'start']));
    expect(routeSubcommandHelp(['node', 'bin', 'config', 'init', '-h']))
      .toBe(commandHelp(['config', 'init']));
    expect(routeSubcommandHelp(['node', 'bin', 'memory', '--help']))
      .toBe(commandHelp(['memory']));
    expect(routeSubcommandHelp(['node', 'bin', 'memory', 'setup', '-h']))
      .toBe(commandHelp(['memory', 'setup']));
    expect(routeSubcommandHelp(['node', 'bin', 'register', '--', '--help'])).toBeNull();
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
  it('prints help through the CLI entry before create or brain dispatches', async () => {
    const [create, brain] = await Promise.all([
      runCli(['create', 'demo', '--help']),
      runCli(['brain', 'start', '--help']),
    ]);

    expect(create).toMatchObject({ exitCode: 0, stderr: '' });
    expect(create.stdout).toBe(commandHelp(['create']));
    expect(brain).toMatchObject({ exitCode: 0, stderr: '' });
    expect(brain.stdout).toBe(commandHelp(['brain', 'start']));
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

  // Covers: task:6
  it('leaves self-owned, pass-through, and unknown command help out of the router', () => {
    for (const args of [
      ['compose', 'land', '--help'],
      ['engineer', 'land', '--help'],
      ['daemon', 'logs', '--help'],
      ['halt-issues', 'sweep', '--help'],
      ['update', '--help'],
      ['no-such-command', '--help'],
    ]) {
      expect(routeSubcommandHelp(['node', 'bin', ...args])).toBeNull();
    }
  });

  // Covers: task:6
  it('preserves self-owned help at the CLI entry', async () => {
    const [compose, daemon, haltIssues] = await Promise.all([
      runCli(['compose', 'land', '--help']),
      runCli(['daemon', 'logs', '--help']),
      runCli(['halt-issues', 'sweep', '--help']),
    ]);

    expect(compose).toMatchObject({ exitCode: 0, stderr: '' });
    expect(compose.stdout).toContain('compose land');
    expect(compose.stdout).toContain('authored .docs/ set');

    expect(daemon).toMatchObject({ exitCode: 0, stderr: '' });
    expect(daemon.stdout).toBe(renderDaemonHelp());

    expect(haltIssues).toMatchObject({ exitCode: 0, stderr: '' });
    expect(haltIssues.stdout).toContain('Usage: ai-conductor halt-issues sweep');
    expect(haltIssues.stdout).toContain('--dry-run');
  }, 30_000);

  // Covers: task:6
  it('passes update help through to its resolved updater unchanged', async () => {
    const harnessRoot = join(scratch, 'harness');
    const updaterPath = join(harnessRoot, 'bin', 'update');
    const runner = vi.fn(async () => 0);
    await mkdir(join(harnessRoot, 'bin'), { recursive: true });
    await mkdir(join(harnessRoot, '.git'));
    await writeFile(updaterPath, '#!/usr/bin/env bash\n');

    await expect(dispatchUpdateCommand(
      detectUpdateCommand(['node', 'bin', 'update', '--help'])!,
      { harnessRoot, runner },
    )).resolves.toBe(0);
    expect(runner).toHaveBeenCalledWith(updaterPath, ['--help']);
  });

  // Covers: task:6
  it('keeps unknown command help on the canonical full-help path', async () => {
    const result = await runCli(['no-such-command', '--help']);

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(result.stdout).toBe(renderCanonicalFullHelp());
  }, 30_000);
});
