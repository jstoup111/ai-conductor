// Covers: task:3
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
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [DIST_ENTRY, ...args], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true, stderr });
    }, 4_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, stderr });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, stderr });
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

function printedCommands(stderr: string): string[] {
  return stderr.match(/ai-conductor inline --reset/g) ?? [];
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
