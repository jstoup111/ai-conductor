/**
 * Tests for `halt-issues sweep` CLI flag parsing and dispatch.
 *
 * Covers acceptance criteria (Story: CLI/backfill):
 * 1. Happy — flag parsing: --dry-run --repo-dir --gh-repo --monitor-log --ledger
 * 2. Happy — defaults: ledger at ~/.ai-conductor/halt-issues/ledger.json,
 *    monitor-log at ~/.ai-conductor/halt-monitor/monitor.log
 * 3. Happy — non-`halt-issues sweep` argv returns null (falls through to pipeline)
 * 4. Negative — unknown flag → guide (non-zero exit + usage message)
 * 5. Negative — missing required --gh-repo → guide (non-zero exit + usage message)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Spy on the real child_process.execFile so we can prove the production `gh`
// runner never reaches it under AI_CONDUCTOR_NO_REAL_EXEC — the guard in
// tracker-client.ts's `makeProductionGh` must throw before this is called.
const execFileSpy = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      execFileSpy(...args);
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import {
  detectHaltIssuesSweepCommand,
  dispatchHaltIssuesSweep,
} from '../../../src/engine/halt-issues/halt-issues-cli';

describe('detectHaltIssuesSweepCommand', () => {
  it('parses all flags: --dry-run --repo-dir --gh-repo --monitor-log --ledger', () => {
    const argv = [
      'node',
      'conduct-ts',
      'halt-issues',
      'sweep',
      '--dry-run',
      '--repo-dir',
      '/tmp/repo',
      '--gh-repo',
      'owner/name',
      '--monitor-log',
      '/tmp/monitor.log',
      '--ledger',
      '/tmp/ledger.json',
    ];
    const cmd = detectHaltIssuesSweepCommand(argv);
    expect(cmd).toEqual({
      kind: 'sweep',
      dryRun: true,
      repoDir: '/tmp/repo',
      ghRepo: 'owner/name',
      monitorLog: '/tmp/monitor.log',
      ledger: '/tmp/ledger.json',
    });
  });

  it('defaults ledger and monitor-log when omitted', () => {
    const argv = ['node', 'conduct-ts', 'halt-issues', 'sweep', '--repo-dir', '/tmp/repo', '--gh-repo', 'owner/name'];
    const cmd = detectHaltIssuesSweepCommand(argv);
    expect(cmd).toEqual({
      kind: 'sweep',
      dryRun: false,
      repoDir: '/tmp/repo',
      ghRepo: 'owner/name',
      monitorLog: join(homedir(), '.ai-conductor', 'halt-monitor', 'monitor.log'),
      ledger: join(homedir(), '.ai-conductor', 'halt-issues', 'ledger.json'),
    });
  });

  it('returns null for non-halt-issues-sweep argv (falls through to pipeline)', () => {
    expect(detectHaltIssuesSweepCommand(['node', 'conduct-ts', 'daemon'])).toBeNull();
    expect(detectHaltIssuesSweepCommand(['node', 'conduct-ts', 'halt-issues'])).toBeNull();
    expect(detectHaltIssuesSweepCommand(['node', 'conduct-ts', 'halt-issues', 'status'])).toBeNull();
  });

  it('returns help for --help / -h', () => {
    expect(detectHaltIssuesSweepCommand(['node', 'conduct-ts', 'halt-issues', 'sweep', '--help'])).toEqual({
      kind: 'help',
    });
    expect(detectHaltIssuesSweepCommand(['node', 'conduct-ts', 'halt-issues', 'sweep', '-h'])).toEqual({
      kind: 'help',
    });
  });

  it('negative: unknown flag returns guide', () => {
    const argv = [
      'node',
      'conduct-ts',
      'halt-issues',
      'sweep',
      '--repo-dir',
      '/tmp/repo',
      '--gh-repo',
      'owner/name',
      '--bogus-flag',
      'x',
    ];
    expect(detectHaltIssuesSweepCommand(argv)).toEqual({ kind: 'guide' });
  });

  it('negative: missing required --gh-repo returns guide', () => {
    const argv = ['node', 'conduct-ts', 'halt-issues', 'sweep', '--repo-dir', '/tmp/repo'];
    expect(detectHaltIssuesSweepCommand(argv)).toEqual({ kind: 'guide' });
  });
});

describe('dispatchHaltIssuesSweep', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('help prints usage and exits 0', async () => {
    const code = await dispatchHaltIssuesSweep({ kind: 'help' }, process.cwd());
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
  });

  it('guide prints usage to stderr and exits non-zero', async () => {
    const code = await dispatchHaltIssuesSweep({ kind: 'guide' }, process.cwd());
    expect(code).not.toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Kill-switch / guarded-factory-only pinning test (no bespoke client
  // construction may bypass the canonical tracker-client factory): this
  // drives a real sweep (real fs, real production TrackerClient wired the
  // same way as `conduct-ts halt-issues sweep`) against a fixture that
  // requires a `gh` call to stamp/close a filed issue, targeting a specific
  // cross-repo `--gh-repo` (parity with the old `GH_REPO` env injection).
  // Under the vitest-global AI_CONDUCTOR_NO_REAL_EXEC=1, that `gh` call must
  // be refused by the canonical guard rather than ever spawning a real `gh`
  // process — proving the CLI only ever constructs its client through the
  // guarded canonical factory, with no bespoke unguarded path.
  it('sweep dispatch guards real gh exec via canonical factory, honoring cross-repo --gh-repo targeting', async () => {
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();

    const { mkdtemp, writeFile: writeFileFs, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join: joinPath } = await import('node:path');

    const dir = await mkdtemp(joinPath(tmpdir(), 'halt-issues-cli-test-'));
    const monitorLog = joinPath(dir, 'monitor.log');
    const ledger = joinPath(dir, 'ledger.json');

    await writeFileFs(monitorLog, 'HALT some-slug -> filed #123\n', 'utf-8');

    const code = await dispatchHaltIssuesSweep(
      {
        kind: 'sweep',
        dryRun: false,
        repoDir: dir,
        monitorLog,
        ledger,
        ghRepo: 'owner/cross-repo-target',
      },
      process.cwd(),
    );

    // Sweep completes (exit 0 per the "gh failures recorded as external
    // closure, not fatal" contract) but the real point of this test: the
    // node:child_process.execFile used by the production `gh` runner must
    // never have been invoked — the guard in makeProductionGh() throws
    // before ever reaching it — proving the cross-repo `--gh-repo` target
    // ('owner/cross-repo-target') was routed through the guarded canonical
    // factory and never reached a real subprocess spawn.
    expect(code).toBe(0);
    expect(execFileSpy).not.toHaveBeenCalled();

    await rm(dir, { recursive: true, force: true });
  });
});
