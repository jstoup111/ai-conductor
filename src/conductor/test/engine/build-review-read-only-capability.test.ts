// Covers: task:11
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  buildCodexReadOnlyProducerRootPolicyArgs,
  probeManagedObservationDestination,
  probeReadOnlyReviewCapability,
} from '../../src/engine/build-review-read-only-capability.js';
import { materializePiHarnessExtension } from '../../src/execution/pi-harness-extension.js';
import { PiProvider } from '../../src/execution/pi-provider.js';

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

  describe('pi', () => {
    const PI_HELP = [
      'Options:',
      '  --tools <list>          Comma-separated tool allowlist',
      '  --no-extensions, -ne    Disable extension discovery',
      '  --extension, -e <path>  Load an extension file',
      '  --no-approve, -na       Ignore project-local resources',
    ].join('\n');
    const helpRunner = (stdout: string, exitCode = 0, stderr = '') => vi.fn(async () => ({ exitCode, stdout, stderr }));
    const materialized = vi.fn(async () => join(tempRoot, 'asset.ts'));
    const piInvoke = vi.spyOn(PiProvider.prototype, 'invoke');

    const probePi = (runProcess: ReturnType<typeof helpRunner> | ReturnType<typeof vi.fn>, materializePiExtension = materialized) =>
      probeReadOnlyReviewCapability({ provider: 'pi', platform: 'linux', runProcess: runProcess as never, scratchDir, materializePiExtension });

    const expectOnlyHelp = (runProcess: ReturnType<typeof vi.fn>) => {
      for (const call of runProcess.mock.calls) expect(call[1]).toEqual(['--help']);
      expect(piInvoke).not.toHaveBeenCalled();
    };

    it('is available when help lists every flag and the asset materializes', async () => {
      const runProcess = helpRunner(PI_HELP);

      await expect(probePi(runProcess)).resolves.toEqual({ provider: 'pi', platform: 'linux', status: 'available' });
      expect(runProcess).toHaveBeenCalledWith('pi', ['--help']);
      expect(materialized).toHaveBeenCalled();
      expectOnlyHelp(runProcess);
    });

    it('reports a missing --no-approve', async () => {
      const runProcess = helpRunner(PI_HELP.split('\n').filter((line) => !line.includes('--no-approve')).join('\n'));

      await expect(probePi(runProcess)).resolves.toEqual({
        provider: 'pi', platform: 'linux', status: 'unavailable', reason: 'Pi help does not list --no-approve',
      });
      expectOnlyHelp(runProcess);
    });

    it('does not let --no-extensions stand in for a missing --extension', async () => {
      const runProcess = helpRunner(PI_HELP.split('\n').filter((line) => !line.includes('--extension,')).join('\n'));

      await expect(probePi(runProcess)).resolves.toEqual({
        provider: 'pi', platform: 'linux', status: 'unavailable', reason: 'Pi help does not list --extension',
      });
    });

    it.each([
      ['--extension', '--extension-preview', 'Pi help does not list --extension'],
      ['--no-approve', '--no-approve-preview', 'Pi help does not list --no-approve'],
    ])('does not treat a longer Pi help token as %s', async (missingFlag, deceptiveFlag, reason) => {
      const runProcess = helpRunner(
        PI_HELP
          .split('\n')
          .filter((line) => !line.includes(`${missingFlag},`))
          .concat(`  ${deceptiveFlag} <value>  Deceptive option`)
          .join('\n'),
      );
      const materializePiExtension = vi.fn(async () => join(tempRoot, 'unexpected-asset.ts'));

      await expect(probePi(runProcess, materializePiExtension)).resolves.toEqual({
        provider: 'pi', platform: 'linux', status: 'unavailable', reason,
      });
      expect(materializePiExtension).not.toHaveBeenCalled();
      expectOnlyHelp(runProcess);
    });

    it('names the unavailable executable when pi is not found, without throwing', async () => {
      const runProcess = vi.fn(async () => { throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }); });

      await expect(probePi(runProcess)).resolves.toEqual({
        provider: 'pi', platform: 'linux', status: 'unavailable', reason: 'Pi executable pi is unavailable',
      });
      expectOnlyHelp(runProcess);
    });

    it('carries the exit code and stderr when help exits non-zero', async () => {
      const runProcess = helpRunner('', 2, 'boom');

      await expect(probePi(runProcess)).resolves.toEqual({
        provider: 'pi', platform: 'linux', status: 'unavailable', reason: 'pi help exited 2: boom',
      });
      expectOnlyHelp(runProcess);
    });

    it.skipIf(process.getuid?.() === 0)('names the asset path when its directory is not writable', async () => {
      const home = join(tempRoot, 'locked-home');
      const assetDir = join(home, '.ai-conductor', 'pi');
      mkdirSync(assetDir, { recursive: true });
      chmodSync(assetDir, 0o500);
      const runProcess = helpRunner(PI_HELP);
      try {
        const result = await probePi(runProcess, vi.fn(() => materializePiHarnessExtension({ homeDir: home })));

        expect(result).toMatchObject({ provider: 'pi', platform: 'linux', status: 'unavailable' });
        expect(result.status === 'unavailable' && result.reason).toMatch(new RegExp(`${assetDir}/harness-extension-[0-9a-f]{16}\\.ts`));
        expectOnlyHelp(runProcess);
      } finally {
        chmodSync(assetDir, 0o700);
      }
    });
  });
});

describe('probeManagedObservationDestination', () => {
  const producerRoot = join(tempRoot, 'worktree', '.pipeline', 'session-events', 'dispatch-1');
  const protectedPaths = [
    join(tempRoot, 'worktree'),
    join(tempRoot, 'worktree', '.pipeline', 'sealed'),
    join(tempRoot, 'worktree', '.pipeline', 'unrelated'),
    join(tempRoot, '.codex'),
  ];

  it('proves the selected Codex executable with the exact producer-root policy it launches', async () => {
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'producer-write-allowed\nprotected-writes-refused\n',
      stderr: '',
    }));

    await expect(probeManagedObservationDestination({
      provider: 'codex', producerRoot, protectedPaths, executable: '/isolated/codex', runProcess,
    })).resolves.toEqual({ producerWrite: 'allowed', protectedWrites: 'refused' });
    expect(runProcess).toHaveBeenCalledWith('/isolated/codex', [
      'sandbox', ...buildCodexReadOnlyProducerRootPolicyArgs(producerRoot, 'sandbox'), '--',
      '/bin/bash', '-c', expect.any(String), 'managed-observation-policy',
      producerRoot,
    ]);
  });

  it.each([
    ['allows a protected path', 'producer-write-allowed\nprotected-write-succeeded\n'],
    ['cannot establish the producer exception', 'producer-write-refused\nprotected-writes-refused\n'],
    ['cannot establish every protected parent', 'probe-parent-missing\n'],
    ['returns malformed proof', 'producer-write-allowed\n'],
  ])('refuses an unprovable native policy when it %s', async (_case, stdout) => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stdout, stderr: '' }));

    await expect(probeManagedObservationDestination({
      provider: 'codex', producerRoot, protectedPaths, runProcess,
    })).resolves.toEqual(expect.objectContaining({ producerWrite: expect.not.stringMatching(/^allowed$/) }));
  });

  it('does not invent a policy proof for providers without an exact native policy', async () => {
    const runProcess = vi.fn();
    await expect(probeManagedObservationDestination({
      provider: 'claude', producerRoot, protectedPaths, runProcess,
    })).resolves.toEqual({ producerWrite: 'unproven', protectedWrites: 'unproven' });
    expect(runProcess).not.toHaveBeenCalled();
  });
});
