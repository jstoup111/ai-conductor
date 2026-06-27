import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { KillProbe } from '../../src/engine/daemon-lock.js';
import { openDaemonLog } from '../../src/engine/daemon-log.js';
import {
  computeStatusRow,
  runDaemonStatus,
  runDaemonLogs,
  detectDaemonObserveCommand,
} from '../../src/engine/daemon-observe-cli.js';

// Liveness probes: ALIVE = no throw; DEAD = throw ESRCH.
const ALIVE: KillProbe = () => {};
const DEAD: KillProbe = () => {
  const e = new Error('no such process') as NodeJS.ErrnoException;
  e.code = 'ESRCH';
  throw e;
};

// Tests live under test/ (outside src/), so they may write the pidfile literal
// directly — the boundary test only scans src/.
async function writePidfile(
  repo: string,
  rec: { pid: number; uuid?: string; startedAt?: string } | string,
): Promise<void> {
  await mkdir(join(repo, '.daemon'), { recursive: true });
  const body =
    typeof rec === 'string'
      ? rec
      : JSON.stringify({
          pid: rec.pid,
          uuid: rec.uuid ?? 'u-1',
          startedAt: rec.startedAt ?? '2026-06-27T00:00:00.000Z',
        });
  await writeFile(join(repo, '.daemon', 'daemon.pid'), body, 'utf8');
}

describe('engine/daemon-observe-cli', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-observe-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function record(name: string, path: string) {
    return {
      schemaVersion: 1,
      name,
      path,
      status: 'registered' as const,
      registeredAt: '2026-06-27T00:00:00.000Z',
    };
  }

  describe('computeStatusRow', () => {
    it('classifies running when the pidfile owner is alive', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 4242 });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.liveness).toBe('running');
      expect(row.pid).toBe(4242);
      expect(row.startedAt).toBe('2026-06-27T00:00:00.000Z');
    });

    it('classifies stale when the pidfile owner is dead', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 4242 });
      const row = await computeStatusRow(record('repo', repo), DEAD);
      expect(row.liveness).toBe('stale');
      expect(row.pid).toBe(4242);
    });

    it('classifies stopped when there is no pidfile', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.liveness).toBe('stopped');
      expect(row.pid).toBeUndefined();
    });

    it('treats a corrupt pidfile as stopped (no crash)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, '{ not json');
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.liveness).toBe('stopped');
    });

    it('marks a registered path that no longer exists as path-missing', async () => {
      const row = await computeStatusRow(record('gone', join(root, 'gone')), ALIVE);
      expect(row.liveness).toBe('path-missing');
    });

    it('surfaces the last log line as activity', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      const sink = await openDaemonLog(repo);
      sink.write('[daemon] · ✓ gate loop converged');
      await sink.close();
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.lastActivity).toBe('[daemon] · ✓ gate loop converged');
      expect(row.lastActivityAt).toBeDefined();
    });
  });

  describe('runDaemonStatus', () => {
    async function registry(records: unknown[]): Promise<string> {
      const p = join(root, 'registry.json');
      await writeFile(p, JSON.stringify(records), 'utf8');
      return p;
    }

    it('reports each repo and keeps going past a stale/missing one', async () => {
      const live = join(root, 'live');
      const dead = join(root, 'dead');
      await mkdir(live, { recursive: true });
      await mkdir(dead, { recursive: true });
      await writePidfile(live, { pid: 11 });
      await writePidfile(dead, { pid: 22 });
      const registryPath = await registry([
        record('live', live),
        record('dead', dead),
        record('gone', join(root, 'gone')),
      ]);

      const out: string[] = [];
      // One probe can't say both alive and dead; classify per-repo via pid value.
      const kill: KillProbe = (pid) => {
        if (pid === 22) {
          const e = new Error('dead') as NodeJS.ErrnoException;
          e.code = 'ESRCH';
          throw e;
        }
      };
      const { code, rows } = await runDaemonStatus({
        registryPath,
        kill,
        out: (l) => out.push(l),
      });
      expect(code).toBe(0);
      expect(rows.map((r) => r.liveness)).toEqual(['running', 'stale', 'path-missing']);
      expect(out.length).toBe(3);
    });

    it('prints a friendly message for an empty registry', async () => {
      const registryPath = await registry([]);
      const out: string[] = [];
      const { code, rows } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });
      expect(code).toBe(0);
      expect(rows).toEqual([]);
      expect(out.join('\n')).toMatch(/No projects registered/);
    });
  });

  describe('runDaemonLogs', () => {
    it('prints the tail for a single repo (default cwd via --repo)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const sink = await openDaemonLog(repo);
      sink.write('[daemon] alpha');
      sink.write('[daemon] beta');
      await sink.close();

      const out: string[] = [];
      const code = await runDaemonLogs(
        { repo, follow: false, all: false },
        { out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(out).toContain('[daemon] alpha');
      expect(out).toContain('[daemon] beta');
    });

    it('prints a friendly message when the log is missing', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const out: string[] = [];
      const code = await runDaemonLogs(
        { repo, follow: false, all: false },
        { out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(out.join('\n')).toMatch(/no daemon log yet/);
    });

    it('--all iterates the registry', async () => {
      const a = join(root, 'a');
      const b = join(root, 'b');
      await mkdir(a, { recursive: true });
      await mkdir(b, { recursive: true });
      const sa = await openDaemonLog(a);
      sa.write('[daemon] from-a');
      await sa.close();
      const sb = await openDaemonLog(b);
      sb.write('[daemon] from-b');
      await sb.close();
      const registryPath = join(root, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify([record('a', a), record('b', b)]),
        'utf8',
      );

      const out: string[] = [];
      const code = await runDaemonLogs(
        { follow: false, all: true },
        { registryPath, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      const joined = out.join('\n');
      expect(joined).toContain('from-a');
      expect(joined).toContain('from-b');
    });
  });

  describe('detectDaemonObserveCommand', () => {
    const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

    it('detects `daemon status`', () => {
      expect(detectDaemonObserveCommand(argv('daemon', 'status'))).toEqual({ kind: 'status' });
    });

    it('detects `daemon logs` with flags', () => {
      expect(
        detectDaemonObserveCommand(argv('daemon', 'logs', '--repo', '/x', '--follow', '--all')),
      ).toEqual({ kind: 'logs', repo: '/x', follow: true, all: true });
    });

    it('supports --repo=<p> form', () => {
      expect(detectDaemonObserveCommand(argv('daemon', 'logs', '--repo=/y'))).toEqual({
        kind: 'logs',
        repo: '/y',
        follow: false,
        all: false,
      });
    });

    it('does NOT match the bare `daemon` run command (no status/logs subcommand)', () => {
      // `daemon` + run options is the runner's territory (detectDaemonCommand);
      // the observe detector must yield so it isn't dispatched as status/logs.
      expect(detectDaemonObserveCommand(argv('daemon', '--concurrency', '3'))).toBeNull();
      expect(detectDaemonObserveCommand(argv('daemon'))).toBeNull();
    });

    it('returns null for an unknown daemon subcommand', () => {
      expect(detectDaemonObserveCommand(argv('daemon', 'frobnicate'))).toBeNull();
    });
  });
});
