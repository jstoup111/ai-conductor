import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { deriveBindSet } from '../../../src/engine/self-host/live-containment.js';

async function canCreateBubblewrapSandbox(): Promise<boolean> {
  try {
    const result = await execa('bwrap', ['--dev-bind', '/', '/', '--', '/bin/true'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const bubblewrapAvailable = await canCreateBubblewrapSandbox();

describe('live containment enforcement', () => {
  it.skipIf(!bubblewrapAvailable)(
    'denies a write at the live checkout root with the derived bind set',
    async () => {
      const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-enforcement-'));
      const worktreeRoot = join(liveCheckout, '.worktrees', 'build');
      const deniedPath = join(liveCheckout, 'must-not-write');

      try {
        const result = await execa(
          'bwrap',
          [
            ...deriveBindSet(liveCheckout, worktreeRoot),
            '--',
            '/bin/sh',
            '-c',
            'if printf denied > "$1"; then exit 1; fi; printf "write denied: %s\\n" "$1" >&2',
            'live-containment-enforcement',
            deniedPath,
          ],
          { reject: false },
        );

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain(deniedPath);
      } finally {
        await rm(liveCheckout, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!bubblewrapAvailable)(
    'denies a live-checkout write through an outside process root in /proc',
    async () => {
      const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-enforcement-'));
      const worktreeRoot = join(liveCheckout, '.worktrees', 'build');
      const deniedPath = join(liveCheckout, 'must-not-write-through-proc');

      try {
        const result = await execa(
          'bwrap',
          [
            ...deriveBindSet(liveCheckout, worktreeRoot),
            '--',
            '/bin/sh',
            '-c',
            'if printf denied > "/proc/$1/root$2"; then exit 1; fi; printf "alternate write denied: /proc/%s/root%s\\n" "$1" "$2" >&2',
            'live-containment-enforcement',
            String(process.pid),
            deniedPath,
          ],
          { reject: false },
        );

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain(`/proc/${process.pid}/root${deniedPath}`);
        await expect(access(deniedPath)).rejects.toThrow();
      } finally {
        await rm(liveCheckout, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!bubblewrapAvailable)(
    'permits writes in the worktree, .git, and .pipeline carve-outs',
    async () => {
      const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-enforcement-'));
      const worktreeRoot = join(liveCheckout, '.worktrees', 'build');
      const gitPath = join(liveCheckout, '.git', 'write-allowed');
      const pipelinePath = join(liveCheckout, '.pipeline', 'write-allowed');
      const worktreePath = join(worktreeRoot, 'write-allowed');

      try {
        await Promise.all([
          mkdir(worktreeRoot, { recursive: true }),
          mkdir(join(liveCheckout, '.git'), { recursive: true }),
          mkdir(join(liveCheckout, '.pipeline'), { recursive: true }),
        ]);
        const result = await execa(
          'bwrap',
          [
            ...deriveBindSet(liveCheckout, worktreeRoot),
            '--',
            '/bin/sh',
            '-c',
            'printf allowed > "$1" && printf allowed > "$2" && printf allowed > "$3"',
            'live-containment-enforcement',
            worktreePath,
            gitPath,
            pipelinePath,
          ],
          { reject: false },
        );

        expect(result.exitCode).toBe(0);
      } finally {
        await rm(liveCheckout, { recursive: true, force: true });
      }
    },
  );
});
