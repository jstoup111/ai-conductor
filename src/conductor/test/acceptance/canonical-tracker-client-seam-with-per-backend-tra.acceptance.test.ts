/**
 * Acceptance specs for .docs/stories/canonical-tracker-client-seam-with-per-backend-tra.md
 * (TR-1 negative path): the kill-switch (`assertRealExecAllowed`, reached through the
 * canonical `makeProductionGh`) must engage BEFORE spawning a process at every
 * production call site — including the two bypass holes the story names explicitly:
 * "paths reached from the engineer CLI and halt-issues CLI composition roots".
 *
 * Per /writing-system-tests §3d, a unit test of `assertRealExecAllowed`/the canonical
 * `makeProductionGh` in isolation (test/tracker-client.test.ts, written during /tdd)
 * proves the guard works — it does NOT prove the guard is wired into these two real
 * production call sites. Today it is not:
 *   - engineer-cli.ts's local `makeProductionGh` (used by `dispatchEngineer`'s
 *     poll/claim/... paths) calls `execFileP('gh', ...)` directly, no guard.
 *   - halt-issues-cli.ts's local `makeProductionGh` (used by `dispatchHaltIssuesSweep`)
 *     calls `execa('gh', ...)` directly, no guard.
 * This file drives the REAL composition roots (`dispatchEngineer`,
 * `dispatchHaltIssuesSweep`) with no fake runner injected — exactly like a live CLI
 * invocation — under the suite's global `AI_CONDUCTOR_NO_REAL_EXEC=1` (test/setup.ts),
 * and asserts the observable guarantee: no real child process is ever spawned. It fails
 * today for the WRONG reason (the process spy observes a real `gh` invocation attempt)
 * until the migration (plan Tasks 1, 10, 13) routes both composition roots through the
 * canonical guarded factory.
 *
 * Argv-parity, per-operation unit behavior, and halt-issues call-count parity are
 * unit-level and already covered by test/tracker-client.test.ts (written during
 * /pipeline) and the existing test/engine/halt-issues/sweep.test.ts (call-count
 * invariants asserted directly against `sweep()` with an injected fake) — this file
 * only covers the cross-module "does the real CLI entry point actually reach the
 * guard" gap, which no existing test exercises (existing halt-issues-cli.test.ts only
 * drives the 'help'/'guide' kinds of `dispatchHaltIssuesSweep`, never 'sweep').
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

import { execFile as execFileSpy } from 'node:child_process';
import { execa as execaSpy } from 'execa';
import { dispatchEngineer, type DispatchEngineerOpts } from '../../src/engine/engineer-cli.js';
import { dispatchHaltIssuesSweep } from '../../src/engine/halt-issues/halt-issues-cli.js';

describe('acceptance: canonical tracker-client seam — kill-switch at real composition roots', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'tracker-seam-acceptance-'));
    vi.mocked(execFileSpy).mockClear();
    vi.mocked(execaSpy).mockClear();
    // Sanity: this suite's premise depends on the global kill-switch being armed
    // (test/setup.ts). If it isn't, the scenarios below prove nothing.
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe('engineer CLI: `engineer poll` via the real dispatchEngineer composition root', () => {
    it('never spawns a real gh process; the guard message surfaces on the CLI error stream', async () => {
      const registryPath = join(workDir, 'registry.json');
      const engineerDir = join(workDir, 'engineer');
      await mkdir(engineerDir, { recursive: true });
      await writeFile(
        registryPath,
        JSON.stringify(
          [
            {
              schemaVersion: 1,
              name: 'o/a',
              path: join(workDir, 'o_a'),
              status: 'registered',
              registeredAt: '2026-07-22T00:00:00.000Z',
            },
          ],
          null,
          2,
        ),
        'utf-8',
      );

      const errOut: string[] = [];
      const opts: DispatchEngineerOpts = {
        registryPath,
        engineerDir,
        print: () => {},
        printErr: (s) => errOut.push(s),
        // No `gh` injected — this is the real composition root's default
        // `makeProductionGh()`, exactly like a live `conduct-ts engineer poll`.
      };

      const code = await dispatchEngineer({ kind: 'poll' }, opts);

      // poll() isolates a failing repo advisorily (FR-27) rather than throwing —
      // the CLI still exits 0 with nothing enqueued for the blocked repo. What
      // must NOT happen, guard or no guard, is a real process spawn.
      expect(code).toBe(0);
      expect(execFileSpy).not.toHaveBeenCalled();
      expect(errOut.some((line) => /AI_CONDUCTOR_NO_REAL_EXEC|real .*(gh|exec).* blocked/i.test(line))).toBe(true);
    });
  });

  describe('halt-issues CLI: `sweep` via the real dispatchHaltIssuesSweep composition root', () => {
    it('never spawns a real gh process; the guard message is recorded as the entry\'s lastError', async () => {
      const monitorLog = join(workDir, 'monitor.log');
      const ledger = join(workDir, 'ledger.json');
      const repoDir = join(workDir, 'repo');
      await mkdir(repoDir, { recursive: true });
      await writeFile(
        monitorLog,
        '2026-07-04T11:59:37Z NEW HALT: 2026-07-04T11:58:38.984Z [daemon] halted\n' +
          'HALT daemon-lifecycle-controls -> filed #297\n',
        'utf-8',
      );

      const code = await dispatchHaltIssuesSweep(
        { kind: 'sweep', dryRun: false, repoDir, monitorLog, ledger, ghRepo: 'test/repo' },
        repoDir,
      );

      // sweep() isolates a per-entry gh failure into the entry's lastError rather
      // than throwing (existing "gh unavailable" contract, sweep.test.ts) — the CLI
      // still exits 0. What must NOT happen, guard or no guard, is a real spawn.
      expect(code).toBe(0);
      expect(execaSpy).not.toHaveBeenCalled();

      const ledgerContent = await readFile(ledger, 'utf-8');
      const ledgerJson = JSON.parse(ledgerContent) as { entries: Record<string, { lastError?: string }> };
      const entry = ledgerJson.entries['297'];
      expect(entry?.lastError ?? '').toMatch(/AI_CONDUCTOR_NO_REAL_EXEC|real .*(gh|exec).* blocked/i);
    });
  });
});
