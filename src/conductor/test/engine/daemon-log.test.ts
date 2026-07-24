import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import {
  openDaemonLog,
  tailDaemonLog,
  followDaemonLog,
  daemonLogPath,
  formatDaemonLogLine,
} from '../../src/engine/daemon-log.js';
import { renderDaemonEvent, stripAnsi } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/index.js';

/** Count of ref'd (event-loop-holding) timers; unref'd timers are excluded. */
function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

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

  describe('size-cap rotation preserves KICKBACK lines', () => {
    it('a KICKBACK line written just before rotation survives intact in daemon.log.1', async () => {
      await mkdir(join(dir, '.daemon'), { recursive: true });
      // Fill the log to just under the 1 MB rotation cap.
      const filler = 'x'.repeat(999_990) + '\n';
      const kickbackLine = formatDaemonLogLine(
        '[daemon] KICKBACK: prd_audit re-opened build (1)',
      );
      await writeFile(
        join(dir, '.daemon', 'daemon.log'),
        filler + kickbackLine + '\n',
        'utf8',
      );

      // Trigger rotation with a subsequent write (rotation happens on open,
      // since the file now exceeds the cap).
      const sink = await openDaemonLog(dir);
      sink.write('fresh after rotation');
      await sink.close();

      const rotated = await readFile(join(dir, '.daemon', 'daemon.log.1'), 'utf8');
      const rotatedLines = rotated.split('\n').filter((l) => l.length > 0);
      const kickbackLines = rotatedLines.filter((l) => l.includes('KICKBACK'));

      // The kickback line exists intact as a single, complete line.
      expect(kickbackLines).toHaveLength(1);
      expect(kickbackLines[0]).toBe(kickbackLine);
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

  describe('KICKBACK lines are ANSI-free and greppable (file-log parity)', () => {
    let priorLevel: number;

    beforeEach(() => {
      // Force chalk on, as if run from an attached TTY, so the real rendering
      // path emits ANSI SGR codes for renderDaemonEvent to strip.
      priorLevel = chalk.level;
      chalk.level = 1;
    });

    afterEach(() => {
      chalk.level = priorLevel;
    });

    it('a kickback event, pushed through the real sink composition, lands as a timestamped, ANSI-free KICKBACK line in daemon.log', async () => {
      const sink = await openDaemonLog(dir);
      // Mirror runDaemonMode's real tee: renderDaemonEvent -> strip-ANSI -> timestamp -> file.
      const tee = (msg: string) => sink.write(formatDaemonLogLine(`[daemon] ${stripAnsi(msg)}`));
      const event: ConductorEvent = {
        type: 'kickback',
        from: 'prd_audit',
        to: 'build',
        count: 1,
      };
      renderDaemonEvent(event, tee);
      await sink.close();

      const res = await tailDaemonLog(dir, 0);
      if (res.status !== 'ok') throw new Error('expected ok');
      expect(res.lines).toHaveLength(1);
      const line = res.lines[0];

      // Timestamped: leading field parses as a valid instant.
      const stamp = line.split(' ', 1)[0];
      expect(Number.isNaN(new Date(stamp).getTime())).toBe(false);

      // Greppable anchor text, nested bold+yellow styles stripped clean.
      expect(line).toContain('KICKBACK: prd_audit re-opened build');

      // Zero ANSI bytes (ESC \x1b) anywhere in the persisted line.
      // eslint-disable-next-line no-control-regex -- asserting absence of ESC
      expect(/\x1b/.test(line)).toBe(false);
    });

    it('only the kickback line contains the KICKBACK anchor across every rendered event variant', async () => {
      const events: ConductorEvent[] = [
        { type: 'step_started', step: 'build', index: 0 },
        { type: 'step_completed', step: 'build', status: 'done' },
        { type: 'step_failed', step: 'build', error: 'boom', retryCount: 1 },
        { type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry' },
        { type: 'gate_verdict', step: 'build', satisfied: false, reason: 'unsatisfied' },
        { type: 'kickback', from: 'prd_audit', to: 'build', count: 1 },
        { type: 'loop_halt', reason: 'stuck' },
        { type: 'loop_converged' },
        { type: 'rate_limit', waitSeconds: 30 },
        { type: 'session_reset', reason: 'context refresh' },
      ];

      const sink = await openDaemonLog(dir);
      const tee = (msg: string) => sink.write(formatDaemonLogLine(`[daemon] ${stripAnsi(msg)}`));
      for (const event of events) {
        renderDaemonEvent(event, tee);
      }
      await sink.close();

      const res = await tailDaemonLog(dir, 0);
      if (res.status !== 'ok') throw new Error('expected ok');
      const kickbackLines = res.lines.filter((l) => l.includes('KICKBACK'));
      expect(kickbackLines).toHaveLength(1);
      expect(kickbackLines[0]).toContain('KICKBACK: prd_audit re-opened build');
    });
  });

  describe('formatDaemonLogLine (timestamps)', () => {
    it('prefixes an ISO-8601 UTC timestamp before the [daemon] line', () => {
      const at = new Date('2026-07-01T14:23:05.123Z');
      expect(formatDaemonLogLine('[daemon] holding lock', at)).toBe(
        '2026-07-01T14:23:05.123Z [daemon] holding lock',
      );
    });

    it('produces a leading, sortable, greppable timestamp field', () => {
      const line = formatDaemonLogLine('[daemon] shipped', new Date(0));
      // First whitespace-delimited field parses back to the same instant.
      const stamp = line.split(' ', 1)[0];
      expect(new Date(stamp).getTime()).toBe(0);
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

    // A `tail -f` that does not hold the event loop open is not a tail: the CLI
    // printed its snapshot and exited immediately because the poll timer was
    // unconditionally unref'd and a SIGINT listener does NOT keep node alive.
    it('unref: false keeps the poll timer holding the event loop open', () => {
      const before = activeTimeouts();
      const handle = followDaemonLog(dir, () => {}, { intervalMs: 50, unref: false });
      expect(activeTimeouts()).toBe(before + 1);
      handle.stop();
      expect(activeTimeouts()).toBe(before);
    });

    it('defaults to an unref’d timer so embedders are never pinned alive', () => {
      const before = activeTimeouts();
      const handle = followDaemonLog(dir, () => {}, { intervalMs: 50 });
      expect(activeTimeouts()).toBe(before);
      handle.stop();
    });
  });
});
