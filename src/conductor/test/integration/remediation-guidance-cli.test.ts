// Covers: task:3
// Covers: task:4
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertAcceptedByCli } from '../remediation-commands.test.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONDUCTOR_DIR = join(__dirname, '..', '..');
const DIST_ENTRY = join(CONDUCTOR_DIR, 'dist', 'index.js');
const BARE_FORM = /ai-conductor (--reset|--status|--fresh|")/;

interface CliResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, input?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [DIST_ENTRY, ...args], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.stdin.end(input);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true, stdout, stderr });
    }, 4_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, stdout, stderr });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, stdout, stderr });
    });
  });
}

async function orphanedRootFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-guidance-cli-'));
  await execFileAsync('git', ['init', '-q', '-b', 'main', root]);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Test']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(
    join(root, '.pipeline', 'conduct-state.json'),
    JSON.stringify({ feature_desc: 'orph', worktree: 'done', last_step: 'worktree' }),
  );
  return root;
}

async function shipEvidenceGapFixture(featureDesc = 'shipx'): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-guidance-cli-'));
  await execFileAsync('git', ['init', '-q', '-b', 'main', root]);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Test']);
  const worktree = join(root, '.worktrees', featureDesc);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(
    join(worktree, '.pipeline', 'conduct-state.json'),
    JSON.stringify({ feature_desc: featureDesc, feature_status: 'complete' }),
  );
  return { root, worktree };
}

function printedCommands(stderr: string): string[] {
  return stderr.match(/ai-conductor inline --reset/g) ?? [];
}

function allPrintedCommands(output: string): string[] {
  return output.match(/ai-conductor inline(?: --(?:fresh|reset|status)(?: "[^"]*")?| "[^"]*")?/g) ?? [];
}

function expectAcceptedGuidance(output: string, expected: readonly string[]): void {
  const commands = allPrintedCommands(output);
  expect(commands, output).toEqual(expect.arrayContaining(expected));
  expect(commands).not.toHaveLength(0);
  expect(output).not.toMatch(BARE_FORM);
  expect(output).not.toContain('""');
  for (const command of commands) {
    expect(() => assertAcceptedByCli(command)).not.toThrow();
  }
}

async function expectAcceptedResetGuidance(stderr: string, root: string): Promise<void> {
  const commands = printedCommands(stderr);
  expect(commands).toContain('ai-conductor inline --reset');
  expect(stderr).not.toMatch(BARE_FORM);
  for (const command of commands) {
    expect(() => assertAcceptedByCli(command)).not.toThrow();
    const reset = await runCli(command.split(' ').slice(1), root);
    expect(reset.timedOut).toBe(false);
    expect(reset.code).toBe(0);
    expect(reset.stderr).not.toContain('the inline SDLC pipeline now runs under the');
  }
}

let fixtureRoots: string[] = [];

beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: CONDUCTOR_DIR });
}, 60_000);

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
  fixtureRoots = [];
});

describe('orphaned-state remediation guidance through the real CLI', () => {
  it('prints an accepted inline reset command for --diagnose', async () => {
    const root = await orphanedRootFixture();
    fixtureRoots.push(root);

    const result = await runCli(['inline', '--diagnose', 'orph'], root);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    await expectAcceptedResetGuidance(result.stderr, root);
  });

  it('prints option 2 as an accepted inline reset command for auto-resume', async () => {
    const root = await orphanedRootFixture();
    fixtureRoots.push(root);

    const result = await runCli(['inline', 'orph'], root);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('2) Run ai-conductor inline --reset');
    await expectAcceptedResetGuidance(result.stderr, root);
  });
});

describe('SHIP-evidence remediation guidance through the real CLI', () => {
  it('prints accepted named SHIP-gap commands for --diagnose', async () => {
    const { root } = await shipEvidenceGapFixture();
    fixtureRoots.push(root);

    const result = await runCli(['inline', '--diagnose', 'shipx'], root);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expectAcceptedGuidance(result.stderr, [
      'ai-conductor inline "shipx"',
      'ai-conductor inline --status',
    ]);
  });

  it('prints an accepted no-feature SHIP-gap command for --diagnose in the worktree', async () => {
    const { root, worktree } = await shipEvidenceGapFixture();
    fixtureRoots.push(root);

    const result = await runCli(['inline', '--diagnose'], worktree);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expectAcceptedGuidance(result.stderr, [
      'ai-conductor inline',
      'ai-conductor inline --status',
    ]);
  });

  it('prints accepted named recovery-declined commands', async () => {
    const { root } = await shipEvidenceGapFixture();
    fixtureRoots.push(root);

    const result = await runCli(['inline', 'shipx'], root, 'n\n');

    expect(result.timedOut).toBe(false);
    expectAcceptedGuidance(result.stdout, [
      'ai-conductor inline --status',
      'ai-conductor inline --fresh "shipx"',
    ]);
  });
});
