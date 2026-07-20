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
});
