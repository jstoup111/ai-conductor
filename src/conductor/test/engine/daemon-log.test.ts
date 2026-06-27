import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openDaemonLog,
  tailDaemonLog,
  followDaemonLog,
  daemonLogPath,
} from '../../src/engine/daemon-log.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';

describe('engine/daemon-log', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-log-'));
  });

  afterEach(async () => {
    // Restore perms in case a test chmod'd a dir to 000, else rm fails.
    await chmod(join(dir, '.daemon'), 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  describe('openDaemonLog + tailDaemonLog (happy path)', () => {
    it('writes appended lines that tailDaemonLog reads back in order', async () => {
      const sink = await openDaemonLog(dir);
      sink.write('[daemon] line one');
      sink.write('[daemon] line two');
      await sink.close();

      const res = await tailDaemonLog(dir, 0);
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') return;
      expect(res.lines).toEqual(['[daemon] line one', '[daemon] line two']);
    });

    it('writes the log under .daemon/daemon.log', async () => {
      const sink = await openDaemonLog(dir);
      sink.write('hello');
      await sink.close();
      expect(daemonLogPath(dir)).toBe(join(dir, '.daemon', 'daemon.log'));
      const raw = await readFile(join(dir, '.daemon', 'daemon.log'), 'utf8');
      expect(raw).toContain('hello');
    });

    it('tail with n returns only the last n lines', async () => {
      const sink = await openDaemonLog(dir);
      for (let i = 0; i < 5; i++) sink.write(`l${i}`);
      await sink.close();
      const res = await tailDaemonLog(dir, 2);
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') return;
      expect(res.lines).toEqual(['l3', 'l4']);
    });

    it('appends across reopen (does not truncate an existing log)', async () => {
      const first = await openDaemonLog(dir);
      first.write('a');
      await first.close();
      const second = await openDaemonLog(dir);
      second.write('b');
      await second.close();
      const res = await tailDaemonLog(dir, 0);
      if (res.status !== 'ok') throw new Error('expected ok');
      expect(res.lines).toEqual(['a', 'b']);
    });
  });

  describe('size-cap rotation', () => {
    it('moves an oversized log aside to daemon.log.1 on open', async () => {
      await mkdir(join(dir, '.daemon'), { recursive: true });
      // Seed an oversized (> ~1 MB) existing log.
      const big = 'x'.repeat(1_000_001) + '\n';
      await writeFile(join(dir, '.daemon', 'daemon.log'), big, 'utf8');

      const sink = await openDaemonLog(dir);
      sink.write('fresh');
      await sink.close();

      // Old content rotated out; the live log starts fresh.
      const rotated = await readFile(join(dir, '.daemon', 'daemon.log.1'), 'utf8');
      expect(rotated.length).toBeGreaterThan(1_000_000);
      const res = await tailDaemonLog(dir, 0);
      if (res.status !== 'ok') throw new Error('expected ok');
      expect(res.lines).toEqual(['fresh']);
    });
  });

  describe('renderDaemonEvent → log file (handoff requirement)', () => {
    it('a completed step produces a corresponding line in .daemon/daemon.log', async () => {
      const sink = await openDaemonLog(dir);
      // Mirror runDaemonMode's tee: renderDaemonEvent → log → console + file.
      const tee = (msg: string) => sink.write(`[daemon] ${msg}`);
      renderDaemonEvent({ type: 'step_started', step: 'build', index: 0 }, tee);
      renderDaemonEvent({ type: 'step_completed', step: 'build', status: 'done' }, tee);
      await sink.close();

      const res = await tailDaemonLog(dir, 0);
      if (res.status !== 'ok') throw new Error('expected ok');
      expect(res.lines).toContain('[daemon] · ▶ build');
      expect(res.lines).toContain('[daemon] ·   build ✓ done');
    });
  });

  describe('tailDaemonLog (negative paths)', () => {
    it('returns "missing" when the log file does not exist', async () => {
      const res = await tailDaemonLog(dir, 10);
      expect(res.status).toBe('missing');
    });

    it('returns "unreadable" when .daemon/ cannot be read', async () => {
      const sink = await openDaemonLog(dir);
      sink.write('seed');
      await sink.close();
      await chmod(join(dir, '.daemon'), 0o000);
      const res = await tailDaemonLog(dir, 10);
      // Root (CI) can bypass perms; accept ok OR unreadable, never a throw/missing.
      expect(['ok', 'unreadable']).toContain(res.status);
    });
  });

  describe('followDaemonLog', () => {
    it('emits only newly-appended lines from the start offset', async () => {
      const sink = await openDaemonLog(dir);
      sink.write('old');
      await sink.close();
      const startOffset = (await stat(daemonLogPath(dir))).size;

      const seen: string[] = [];
      const handle = followDaemonLog(dir, (l) => seen.push(l), {
        startOffset,
        auto: false,
      });

      const sink2 = await openDaemonLog(dir);
      sink2.write('new one');
      sink2.write('new two');
      await sink2.close();

      await handle.poll();
      handle.stop();
      expect(seen).toEqual(['new one', 'new two']);
    });

    it('a missing log on a tick is swallowed (no throw)', async () => {
      const seen: string[] = [];
      const handle = followDaemonLog(dir, (l) => seen.push(l), { auto: false });
      await expect(handle.poll()).resolves.toBeUndefined();
      handle.stop();
      expect(seen).toEqual([]);
    });
  });
});
