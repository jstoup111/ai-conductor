import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { isProcessed, readWorktreeOutcome } from '../../src/engine/daemon-deps.js';

describe('engine/daemon-deps', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-deps-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readWorktreeOutcome', () => {
    it('reports done with pr_url from state', async () => {
      await writeFile(join(dir, '.pipeline/DONE'), 'converged\n');
      await writeFile(
        join(dir, '.pipeline/conduct-state.json'),
        JSON.stringify({ pr_url: 'https://github.com/x/y/pull/9' }),
      );
      const out = await readWorktreeOutcome(dir);
      expect(out.done).toBe(true);
      expect(out.halted).toBe(false);
      expect(out.prUrl).toBe('https://github.com/x/y/pull/9');
    });

    it('reports halted with the HALT reason', async () => {
      await writeFile(join(dir, '.pipeline/HALT'), 'kickback ping-pong on plan\n');
      const out = await readWorktreeOutcome(dir);
      expect(out.halted).toBe(true);
      expect(out.done).toBe(false);
      expect(out.reason).toMatch(/ping-pong/);
    });

    it('reports neither when no markers exist', async () => {
      const out = await readWorktreeOutcome(dir);
      expect(out).toMatchObject({ done: false, halted: false });
    });
  });

  describe('isProcessed', () => {
    it('is false until the marker exists, then true', async () => {
      expect(await isProcessed(dir, 'feat-x')).toBe(false);
      await mkdir(join(dir, '.daemon/processed'), { recursive: true });
      await writeFile(join(dir, '.daemon/processed/feat-x'), 'shipped\n');
      expect(await isProcessed(dir, 'feat-x')).toBe(true);
    });
  });
});
