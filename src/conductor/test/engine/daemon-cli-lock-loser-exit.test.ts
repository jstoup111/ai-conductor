// ─────────────────────────────────────────────────────────────────────────────
// Task 14: Lock-loser explicit refusal exit (RED phase — new contract)
//
// NEW CONTRACT: when runDaemonMode loses the lock (holdLock resolves null),
// it must read the on-disk pidfile record (via readPidRecord — no mocking of
// that function; the real file is written by the test) and:
//   1. Exit with a NONZERO code (LOCK_HELD_EXIT_CODE = 3), never 0.
//   2. Log the holder's pid when the record is readable: "another daemon is
//      already running (pid <P>)".
//   3. Additionally mention "engineDir <value>" when the record has one.
//   4. For a legacy record (no engineDir), omit the engineDir mention but
//      still show "(pid <P>)".
//   5. For an unreadable/corrupt record, fall back to a GENERIC message with
//      NO specific pid number, while still exiting nonzero.
//
// This supersedes the OLD contract (generic message + exitProcess(0)).
// RED PHASE: these tests must FAIL against the current, unmodified
// src/daemon-cli.ts, which still calls exitProcess(0) with a generic message
// and never reads the pidfile record.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DaemonModeOptions } from '../../src/daemon-cli.js';
import { getPidfilePath } from '../../src/engine/daemon-lock.js';
import type { PidRecord } from '../../src/engine/daemon-lock.js';

describe('Task 14 — Lock-loser explicit refusal exit (RED phase — new contract)', () => {
  let projectRoot: string;
  let logs: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-cli-lock-loser-'));
    logs = [];
    originalConsoleLog = console.log;
    console.log = vi.fn((...args: any[]) => {
      logs.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
    await rm(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writePidfile(record: unknown): Promise<void> {
    const pidfilePath = getPidfilePath(projectRoot);
    await mkdir(join(projectRoot, '.daemon'), { recursive: true });
    await writeFile(
      pidfilePath,
      typeof record === 'string' ? record : JSON.stringify(record),
      'utf8',
    );
  }

  function makeOpts(): { opts: DaemonModeOptions; getExitCode: () => number | undefined } {
    let exitProcessCode: number | undefined;
    const fakeExitProcess = (code: number) => {
      exitProcessCode = code;
    };
    const opts: DaemonModeOptions = {
      projectRoot,
      concurrency: 1,
      ensureFresh: async () => {},
      exitProcess: fakeExitProcess,
    };
    return { opts, getExitCode: () => exitProcessCode };
  }

  it('exits nonzero (3) and logs "(pid P)" + "engineDir <value>" when the holder record has an engineDir', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    const holderPid = process.pid;
    const record: PidRecord = {
      pid: holderPid,
      uuid: 'test-uuid-with-enginedir',
      startedAt: new Date().toISOString(),
      engineDir: '/some/engine/dist-versions/v1',
    };
    await writePidfile(record);

    const { opts, getExitCode } = makeOpts();
    await runDaemonMode(opts);

    expect(getExitCode()).toBe(3);
    expect(getExitCode()).not.toBe(0);

    const logText = logs.join('\n');
    expect(logText).toContain(`another daemon is already running (pid ${holderPid})`);
    expect(logText).toContain(`engineDir ${record.engineDir}`);
  });

  it('exits nonzero and logs "(pid P)" WITHOUT engineDir for a legacy record missing engineDir', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    const holderPid = process.pid;
    // Legacy record: no engineDir field at all.
    const record = {
      pid: holderPid,
      uuid: 'test-uuid-legacy',
      startedAt: new Date().toISOString(),
    };
    await writePidfile(record);

    const { opts, getExitCode } = makeOpts();
    await runDaemonMode(opts);

    expect(getExitCode()).not.toBe(0);
    expect(typeof getExitCode()).toBe('number');

    const logText = logs.join('\n');
    expect(logText).toContain(`another daemon is already running (pid ${holderPid})`);
    expect(logText).not.toContain('engineDir');
  });

  it('exits nonzero and logs a generic message with NO specific pid when the holder record is corrupt/unreadable', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    // Corrupt JSON — readPidRecord will fail to parse and return null.
    await writePidfile('{ this is not valid json ');

    const { opts, getExitCode } = makeOpts();
    await runDaemonMode(opts);

    expect(getExitCode()).not.toBe(0);
    expect(typeof getExitCode()).toBe('number');

    const logText = logs.join('\n');
    expect(logText).toContain('another daemon is already running');
    expect(logText).not.toMatch(/pid \d+/);
  });

  it('exits nonzero and logs a generic message with NO specific pid when the pidfile is entirely absent', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    // Do NOT write any pidfile — readPidRecord will see ENOENT and return null.

    const { opts, getExitCode } = makeOpts();
    await runDaemonMode(opts);

    expect(getExitCode()).not.toBe(0);
    expect(typeof getExitCode()).toBe('number');

    const logText = logs.join('\n');
    expect(logText).toContain('another daemon is already running');
    expect(logText).not.toMatch(/pid \d+/);
  });
});
