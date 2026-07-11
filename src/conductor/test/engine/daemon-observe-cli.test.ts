import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import cp from 'node:child_process';
import { acquire, readPidRecord, type KillProbe } from '../../src/engine/daemon-lock.js';
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
  rec: { pid: number; uuid?: string; startedAt?: string; engineDir?: string } | string,
): Promise<void> {
  await mkdir(join(repo, '.daemon'), { recursive: true });
  const body =
    typeof rec === 'string'
      ? rec
      : JSON.stringify({
          pid: rec.pid,
          uuid: rec.uuid ?? 'u-1',
          startedAt: rec.startedAt ?? '2026-06-27T00:00:00.000Z',
          ...(rec.engineDir !== undefined ? { engineDir: rec.engineDir } : {}),
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

  describe('daemon-lock pidfile — engineDir (FR-14)', () => {
    it('a pidfile written via acquire() (the real daemon-lock path) carries an engineDir field', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const result = await acquire(repo, ALIVE);
      expect(result.acquired).toBe(true);
      const rec = await readPidRecord(repo);
      expect(rec).not.toBeNull();
      expect(typeof rec?.engineDir).toBe('string');
      expect(rec?.engineDir?.length).toBeGreaterThan(0);
    });
  });

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

    it('renders "version:<id>" when the pidfile engineDir contains a dist-versions/<id> segment (FR-14)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, {
        pid: 4242,
        engineDir: '/opt/app/dist-versions/20260704T000000Z-abc123abc123',
      });
      const registryPath = join(root, 'registry.json');
      await writeFile(registryPath, JSON.stringify([record('repo', repo)]), 'utf8');

      const out: string[] = [];
      await runDaemonStatus({ registryPath, kill: ALIVE, out: (l) => out.push(l) });
      expect(out.join('\n')).toContain('version:20260704T000000Z-abc123abc123');
    });

    it('renders "version-unknown" when the pidfile has no engineDir (legacy record)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 4242 });
      const registryPath = join(root, 'registry.json');
      await writeFile(registryPath, JSON.stringify([record('repo', repo)]), 'utf8');

      const out: string[] = [];
      await runDaemonStatus({ registryPath, kill: ALIVE, out: (l) => out.push(l) });
      expect(out.join('\n')).toContain('version:version-unknown');
    });
  });

  describe('computeStatusRow — state enum (FR-5)', () => {
    async function writePauseMarker(
      repo: string,
      meta: { pausedAt?: string; pausedBy?: string } | string = {},
    ): Promise<void> {
      await mkdir(join(repo, '.daemon'), { recursive: true });
      const body =
        typeof meta === 'string'
          ? meta
          : JSON.stringify({ pausedAt: meta.pausedAt ?? '2026-07-04T00:00:00.000Z', ...meta });
      await writeFile(join(repo, '.daemon', 'PAUSED'), body, 'utf8');
    }

    it('is "running" when live and not paused', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.state).toBe('running');
    });

    it('is "stopped" when there is no pidfile and not paused', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.state).toBe('stopped');
    });

    it('is "stale" when the pidfile owner is dead and not paused', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      const row = await computeStatusRow(record('repo', repo), DEAD);
      expect(row.state).toBe('stale');
    });

    it('is "paused" when live and the pause marker is present, with pausedAt/by', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writePauseMarker(repo, { pausedAt: '2026-07-04T01:00:00.000Z', pausedBy: 'james' });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.state).toBe('paused');
      expect(row.pausedAt).toBe('2026-07-04T01:00:00.000Z');
      expect(row.pausedBy).toBe('james');
    });

    it('is "paused_dead" (composite) when paused and the pidfile owner is dead — shows both facts', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writePauseMarker(repo, { pausedAt: '2026-07-04T01:00:00.000Z' });
      const row = await computeStatusRow(record('repo', repo), DEAD);
      expect(row.state).toBe('paused_dead');
      expect(row.liveness).toBe('stale');
      expect(row.pausedAt).toBe('2026-07-04T01:00:00.000Z');
    });

    it('treats corrupt pause-marker metadata as paused, without throwing', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writePauseMarker(repo, '{ not json');
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.state).toBe('paused');
      expect(row.pausedAt).toBeUndefined();
    });

    it('a four-state fleet renders each state distinctly', async () => {
      const running = join(root, 'running');
      const paused = join(root, 'paused');
      const stopped = join(root, 'stopped');
      const stale = join(root, 'stale');
      await mkdir(running, { recursive: true });
      await mkdir(paused, { recursive: true });
      await mkdir(stopped, { recursive: true });
      await mkdir(stale, { recursive: true });
      await writePidfile(running, { pid: 1 });
      await writePidfile(paused, { pid: 2 });
      await writePauseMarker(paused);
      await writePidfile(stale, { pid: 3 });

      const kill: KillProbe = (pid) => {
        if (pid === 3) {
          const e = new Error('dead') as NodeJS.ErrnoException;
          e.code = 'ESRCH';
          throw e;
        }
      };

      const rows = await Promise.all([
        computeStatusRow(record('running', running), kill),
        computeStatusRow(record('paused', paused), kill),
        computeStatusRow(record('stopped', stopped), kill),
        computeStatusRow(record('stale', stale), kill),
      ]);
      expect(rows.map((r) => r.state)).toEqual(['running', 'paused', 'stopped', 'stale']);
      expect(new Set(rows.map((r) => r.state)).size).toBe(4);
    });
  });

  describe('computeStatusRow — restart-pending + two-layer liveness (FR-9/FR-12, T33)', () => {
    async function writeRestartMarker(
      repo: string,
      intent: { requestedAt?: string; requestedBy?: string; blockingSlug?: string } | string = {},
    ): Promise<void> {
      await mkdir(join(repo, '.daemon'), { recursive: true });
      const body =
        typeof intent === 'string'
          ? intent
          : JSON.stringify({ requestedAt: intent.requestedAt ?? '2026-07-04T00:00:00.000Z', ...intent });
      await writeFile(join(repo, '.daemon', 'RESTART-PENDING'), body, 'utf8');
    }

    it('reports "restart-pending" state and surfaces the blocking slug while the marker is present', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writeRestartMarker(repo, { blockingSlug: 'feat-widgets' });
      const row = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row.state).toBe('restart-pending');
      expect(row.restartPending?.blockingSlug).toBe('feat-widgets');
    });

    it('renders the literal "restart-pending (waiting on <slug>)" text via runDaemonStatus', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writeRestartMarker(repo, { blockingSlug: 'feat-widgets' });
      const registryPath = join(root, 'registry.json');
      await writeFile(registryPath, JSON.stringify([record('repo', repo)]), 'utf8');

      const out: string[] = [];
      await runDaemonStatus({ registryPath, kill: ALIVE, out: (l) => out.push(l) });
      expect(out.join('\n')).toContain('restart-pending (waiting on feat-widgets)');
    });

    it('does not consume the restart marker — it remains present across repeated status reads', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      await writeRestartMarker(repo, { blockingSlug: 'feat-widgets' });
      await computeStatusRow(record('repo', repo), ALIVE);
      const row2 = await computeStatusRow(record('repo', repo), ALIVE);
      expect(row2.state).toBe('restart-pending');
    });

    it('reports "dead-pane" when the tmux session is present but the pane has died', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      const row = await computeStatusRow(
        record('repo', repo),
        ALIVE,
        () => true, // session present
        () => true, // pane dead
      );
      expect(row.state).toBe('dead-pane');
      expect(row.sessionPresent).toBe(true);
      expect(row.paneDead).toBe(true);
    });

    it('distinguishes dead-pane from plain running (session present, pane alive)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writePidfile(repo, { pid: 1 });
      const row = await computeStatusRow(
        record('repo', repo),
        ALIVE,
        () => true, // session present
        () => false, // pane alive
      );
      expect(row.state).toBe('running');
      expect(row.paneDead).toBe(false);
    });

    it('distinguishes dead-pane from stopped (no pidfile, no session)', async () => {
      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      const row = await computeStatusRow(record('repo', repo), ALIVE, () => false, () => false);
      expect(row.state).toBe('stopped');
      expect(row.paneDead).toBe(false);
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
      // One status line per repo, plus a GATED section line for each repo whose
      // path exists (path-missing repos skip the snapshot read entirely).
      expect(out.length).toBe(5);
    });

    it('prints a friendly message for an empty registry', async () => {
      const registryPath = await registry([]);
      const out: string[] = [];
      const { code, rows } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });
      expect(code).toBe(0);
      expect(rows).toEqual([]);
      expect(out.join('\n')).toMatch(/No projects registered/);
    });

    describe('GATED section (Task 15, S5 HP-1/HP-2/NP-4/NP-5)', () => {
      async function writeGatedSnapshot(repo: string, body: unknown): Promise<void> {
        const daemonDir = join(repo, '.daemon');
        await mkdir(daemonDir, { recursive: true });
        await writeFile(
          join(daemonDir, 'gated.json'),
          typeof body === 'string' ? body : JSON.stringify(body),
          'utf8',
        );
      }

      it('renders slugs/reasons/remedies and an "as of Nm ago" freshness label using the injected clock', async () => {
        const repo = join(root, 'repo-ok');
        await mkdir(repo, { recursive: true });
        const writtenAt = new Date('2026-06-27T00:00:00.000Z').toISOString();
        const now = new Date('2026-06-27T00:05:00.000Z'); // 5 minutes later
        await writeGatedSnapshot(repo, {
          schemaVersion: 1,
          writtenAt,
          repoWarnings: [{ kind: 'repo', warning: 'no-cutover', remedy: 'run cutover' }],
          gated: [
            { kind: 'spec', slug: 'my-slug', reason: 'other-owner', otherOwner: 'bob', remedy: 'declare ownership' },
          ],
        });
        const registryPath = await registry([record('repo-ok', repo)]);

        const out: string[] = [];
        const { code } = await runDaemonStatus({
          registryPath,
          out: (l) => out.push(l),
          clock: () => now,
        });

        expect(code).toBe(0);
        const output = out.join('\n');
        expect(output).toContain('my-slug');
        expect(output).toContain('other-owner');
        expect(output).toContain('bob');
        expect(output).toContain('declare ownership');
        expect(output).toContain('no-cutover');
        expect(output).toContain('run cutover');
        expect(output.toLowerCase()).toMatch(/as of 5m ago/);
      });

      it('renders an explicit "no specs are gated" line for an empty snapshot', async () => {
        const repo = join(root, 'repo-empty');
        await mkdir(repo, { recursive: true });
        await writeGatedSnapshot(repo, {
          schemaVersion: 1,
          writtenAt: new Date().toISOString(),
          repoWarnings: [],
          gated: [],
        });
        const registryPath = await registry([record('repo-empty', repo)]);

        const out: string[] = [];
        await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(out.join('\n').toLowerCase()).toContain('no specs are gated');
      });

      it('renders "gated state unknown" verbatim wording for missing/unreadable/version-mismatch snapshots', async () => {
        const repoMissing = join(root, 'repo-missing-snapshot');
        const repoUnreadable = join(root, 'repo-unreadable-snapshot');
        const repoVersion = join(root, 'repo-version-mismatch');
        await mkdir(repoMissing, { recursive: true });
        await mkdir(repoUnreadable, { recursive: true });
        await mkdir(repoVersion, { recursive: true });
        await writeGatedSnapshot(repoUnreadable, '{"schemaVersion": 1, "writ');
        await writeGatedSnapshot(repoVersion, {
          schemaVersion: 999,
          writtenAt: new Date().toISOString(),
          repoWarnings: [],
          gated: [{ kind: 'spec', slug: 'future-shape', reason: 'other-owner', otherOwner: 'x', remedy: 'r' }],
        });
        const registryPath = await registry([
          record('repo-missing-snapshot', repoMissing),
          record('repo-unreadable-snapshot', repoUnreadable),
          record('repo-version-mismatch', repoVersion),
        ]);

        const out: string[] = [];
        const { code } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(code).toBe(0);
        const output = out.join('\n').toLowerCase();
        expect(output).toContain('gated state unknown');
        expect(output).not.toContain('future-shape');
      });

      it('skips the snapshot read entirely for a repo whose registered path is missing', async () => {
        const repoMissing = join(root, 'repo-path-missing-does-not-exist');
        const registryPath = await registry([record('repo-path-missing', repoMissing)]);

        const out: string[] = [];
        const { code, rows } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(code).toBe(0);
        expect(rows[0].liveness).toBe('path-missing');
        const output = out.join('\n').toLowerCase();
        expect(output).not.toContain('gated state unknown');
        expect(output).not.toContain('no specs are gated');
      });

      it('never spawns a git or gh child process while rendering the GATED section', async () => {
        const repo = join(root, 'repo-no-spawn');
        await mkdir(repo, { recursive: true });
        await writeGatedSnapshot(repo, {
          schemaVersion: 1,
          writtenAt: new Date().toISOString(),
          repoWarnings: [],
          gated: [{ kind: 'spec', slug: 'a-slug', reason: 'other-owner', otherOwner: 'z', remedy: 'r' }],
        });
        const registryPath = await registry([record('repo-no-spawn', repo)]);

        const execFileSpy = vi.spyOn(cp, 'execFile');
        const execSpy = vi.spyOn(cp, 'exec');

        const out: string[] = [];
        await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(execFileSpy).not.toHaveBeenCalled();
        expect(execSpy).not.toHaveBeenCalled();

        execFileSpy.mockRestore();
        execSpy.mockRestore();
      });
    });

    describe('attribution agreement rate (Task 18, Story 9)', () => {
      async function writeLedger(repo: string, lines: unknown[]): Promise<void> {
        const daemonDir = join(repo, '.daemon');
        await mkdir(daemonDir, { recursive: true });
        const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
        await writeFile(join(daemonDir, 'attribution-accuracy.jsonl'), body, 'utf8');
      }

      it('prints the rolling agreement rate and sample count when the ledger has entries', async () => {
        const repo = join(root, 'repo-ledger');
        await mkdir(repo, { recursive: true });
        await writeLedger(repo, [
          { ts: 1, feature: 'f', taskId: 't1', fastLaneForm: 'commit', fastLaneSha: 'a', auditVerdict: 'satisfied', agree: true },
          { ts: 2, feature: 'f', taskId: 't2', fastLaneForm: 'commit', fastLaneSha: 'b', auditVerdict: 'unsatisfied', agree: false },
          { ts: 3, feature: 'f', taskId: 't3', fastLaneForm: 'commit', fastLaneSha: 'c', auditVerdict: 'satisfied', agree: true },
        ]);
        const registryPath = await registry([record('repo-ledger', repo)]);

        const out: string[] = [];
        const { code } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(code).toBe(0);
        const output = out.join('\n');
        expect(output).toMatch(/agreement/i);
        // 2 of 3 agree => 66.7%
        expect(output).toMatch(/66\.7%/);
        expect(output).toMatch(/n=3/);
      });

      it('omits the agreement line when the ledger is absent (no fake 100%)', async () => {
        const repo = join(root, 'repo-no-ledger');
        await mkdir(repo, { recursive: true });
        const registryPath = await registry([record('repo-no-ledger', repo)]);

        const out: string[] = [];
        const { code } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(code).toBe(0);
        const output = out.join('\n');
        expect(output).not.toMatch(/agreement/i);
        expect(output).not.toContain('100%');
      });

      it('omits the agreement line when the ledger file exists but is empty', async () => {
        const repo = join(root, 'repo-empty-ledger');
        await mkdir(join(repo, '.daemon'), { recursive: true });
        await writeFile(join(repo, '.daemon', 'attribution-accuracy.jsonl'), '', 'utf8');
        const registryPath = await registry([record('repo-empty-ledger', repo)]);

        const out: string[] = [];
        const { code } = await runDaemonStatus({ registryPath, out: (l) => out.push(l) });

        expect(code).toBe(0);
        expect(out.join('\n')).not.toMatch(/agreement/i);
      });
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
