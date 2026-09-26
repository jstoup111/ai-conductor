import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { probeReadOnlyReviewCapability } from '../../src/engine/build-review-read-only-capability.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'read-only-capability-'));
const scratchDir = join(tempRoot, '.pipeline', 'read-only-capability');
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));
const execFileAsync = promisify(execFile);

/** Runs only the probe's inner /bin/sh command, standing in for the Codex sandbox boundary. */
async function runInnerProbeScript(_executable: string, args: readonly string[]) {
  const inner = args.slice(args.indexOf('--') + 1);
  const { stdout, stderr } = await execFileAsync(inner[0]!, inner.slice(1));
  return { exitCode: 0, stdout, stderr };
}

describe('probeReadOnlyReviewCapability', () => {
  it('proves Codex is available only when its read-only sandbox starts and refuses the probe write', async () => {
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'sandbox-started\nprobe-write-refused\n',
      stderr: '',
    }));

    await expect(probeReadOnlyReviewCapability({
      provider: 'codex', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({ provider: 'codex', platform: 'linux', status: 'available' });
    expect(runProcess).toHaveBeenCalledWith('codex', [
      'sandbox', '-P', ':read-only', '--', '/bin/sh', '-c', expect.any(String), 'read-only-review-probe',
      `${scratchDir}/write-probe`, scratchDir,
    ]);
  });

  it.each([
    ['cannot start', new Error('sandbox helper could not start'), 'sandbox helper could not start'],
    ['is absent', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }), 'codex sandbox helper is unavailable'],
  ])('reports Codex unavailable when its sandbox helper %s', async (_case, error, reason) => {
    const runProcess = vi.fn(async () => { throw error; });

    await expect(probeReadOnlyReviewCapability({
      provider: 'codex', platform: 'darwin', runProcess, scratchDir,
    })).resolves.toEqual({ provider: 'codex', platform: 'darwin', status: 'unavailable', reason });
  });

  it.each([
    ['allows the probe write', 'sandbox-started\nprobe-write-succeeded\n', 'probe write was not refused'],
    ['emits unrecognized output', 'sandbox-started\nunexpected\n', 'probe produced unrecognized output'],
  ])('reports Codex unavailable when its sandbox %s', async (_case, stdout, reason) => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stdout, stderr: '' }));

    await expect(probeReadOnlyReviewCapability({
      provider: 'codex', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({ provider: 'codex', platform: 'linux', status: 'unavailable', reason });
  });

  it('creates the probe parent directory before the sandbox runs', async () => {
    rmSync(scratchDir, { recursive: true, force: true });
    let parentExisted = false;
    const runProcess = vi.fn(async () => {
      parentExisted = existsSync(scratchDir);
      return { exitCode: 0, stdout: 'sandbox-started\nprobe-write-refused\n', stderr: '' };
    });

    await expect(probeReadOnlyReviewCapability({
      provider: 'codex', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({ provider: 'codex', platform: 'linux', status: 'available' });
    expect(runProcess).toHaveBeenCalledOnce();
    expect(parentExisted).toBe(true);
  });

  it('does not treat a write that failed only for a missing parent as a sandbox refusal', async () => {
    const missingParent = join(tempRoot, 'removed-before-write');
    const runProcess = vi.fn(async (executable: string, args: readonly string[]) => {
      rmSync(missingParent, { recursive: true, force: true });
      return runInnerProbeScript(executable, args);
    });

    await expect(probeReadOnlyReviewCapability({
      provider: 'codex', platform: 'linux', runProcess, scratchDir: missingParent,
    })).resolves.toEqual({
      provider: 'codex', platform: 'linux', status: 'unavailable', reason: 'probe directory does not exist',
    });
    expect(runProcess).toHaveBeenCalledOnce();
  });

  it('proves Claude is available from help listing every read-only review flag without a model call', async () => {
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: '--restricted\n--tools <tools>\n--allowedTools <rules>\n--strict-mcp-config\n',
      stderr: '',
    }));

    await expect(probeReadOnlyReviewCapability({
      provider: 'claude', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({ provider: 'claude', platform: 'linux', status: 'available' });
    expect(runProcess).toHaveBeenCalledWith('claude', ['--help']);
  });

  it('reports the missing Claude read-only flag', async () => {
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: '--restricted\n--tools <tools>\n--allowedTools <rules>\n',
      stderr: '',
    }));

    await expect(probeReadOnlyReviewCapability({
      provider: 'claude', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({
      provider: 'claude', platform: 'linux', status: 'unavailable', reason: 'Claude help does not list --strict-mcp-config',
    });
  });

  it('does not spawn for a provider with no read-only review mode', async () => {
    const runProcess = vi.fn();

    await expect(probeReadOnlyReviewCapability({
      provider: 'other', platform: 'linux', runProcess, scratchDir,
    })).resolves.toEqual({
      provider: 'other', platform: 'linux', status: 'unavailable', reason: 'provider has no read-only review mode',
    });
    expect(runProcess).not.toHaveBeenCalled();
  });
});
