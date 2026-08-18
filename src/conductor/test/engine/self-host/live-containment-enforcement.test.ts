import { mkdtemp, rm } from 'node:fs/promises';
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
});
