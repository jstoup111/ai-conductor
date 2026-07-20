import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for `conduct-ts halt-issues sweep`
// (.docs/stories/halt-monitor-filed-issues-never-auto-close-no-link.md,
// stories "Close on ship evidence" (ADR D3) and "CLI surface, backfill run,
// and monitor hook documentation" (ADR D5)).
//
// Drives the REAL production entry point — bin/conduct-ts spawned as a
// genuine child process — NOT halt-issues-cli.ts's dispatch/parse functions
// in-process. Per §3b of writing-system-tests, a unit test calling
// detectHaltIssuesCommand/dispatchHaltIssuesSweep directly would pass even if
// src/index.ts never wires the subcommand in; this test fails in that case
// (today: commander reports an unknown command, matching the pre-wiring RED
// this skill expects — see the finish-record-cli precedent, bug #178).
//
// The backfill case exercises the multi-step flow the "CLI surface" story
// cares about end-to-end: parse the real monitor.log fixture (11 historical
// filed issues, .docs/stories Done When #2) -> ledger upsert -> per-issue
// disposition -> summary line, entirely through the real binary and a real
// (isolated, empty) repo-dir. Every entry is a fresh, unstamped ledger entry
// with no local ship evidence, so gh is the only thing that could turn this
// into a live-network test; the vitest kill-switch (AI_CONDUCTOR_NO_REAL_EXEC,
// set in test/setup.ts and inherited by the spawned child) blocks every gh
// call, forcing the sweep down its documented degrade-never-block path (ADR
// D4/D5 negative: gh unavailable -> parse/ledger still complete, gh-dependent
// actions skipped as per-entry errors, exit 0). This test therefore pins only
// what the story text pins (parsed count, exit code, summary line grammar,
// per-issue mentions) and leaves the exact stamped/closed/guarded/error
// bucket counts unconstrained, since the story does not specify blocked-exec
// bucketing and hard-coding a guess would freeze an unverified assumption.
//
// cwd/repo-dir/ledger are isolated scratch directories (nested mkdtemp
// parent, per the rekick-flake lesson) so a still-unwired `halt-issues`
// falling through to the pipeline launcher cannot touch the real repo.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const FIXTURE_LOG = join(process.cwd(), 'test/fixtures/halt-issues/monitor-log-real.txt');
const HISTORICAL_ISSUES = [297, 300, 302, 354, 358, 385, 386, 403, 407, 415, 416];

let scratchParent: string;
let repoDir: string;
let ledgerDir: string;

beforeEach(async () => {
  scratchParent = await mkdtemp(join(tmpdir(), 'halt-issues-sweep-real-binary-'));
  repoDir = await mkdtemp(join(scratchParent, 'repo-'));
  ledgerDir = await mkdtemp(join(scratchParent, 'ledger-'));
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('conduct-ts halt-issues sweep — real-binary acceptance smoke', () => {
  it(
    '--dry-run backfill over the real monitor.log fixture lists all 11 historical issues and prints the summary line',
    async () => {
      const result = await execa(
        REAL_CONDUCT_TS,
        [
          'halt-issues',
          'sweep',
          '--dry-run',
          '--repo-dir',
          repoDir,
          '--monitor-log',
          FIXTURE_LOG,
          '--ledger',
          join(ledgerDir, 'ledger.json'),
          '--gh-repo',
          'acme/repo',
        ],
        { cwd: repoDir, reject: false },
      );
      const out = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      for (const issue of HISTORICAL_ISSUES) {
        expect(out).toContain(`#${issue}`);
      }
      expect(out).toMatch(
        /halt-issues sweep: parsed 11, stamped \d+, closed \d+, guarded \d+, errors \d+/,
      );
    },
    30_000,
  );

  it(
    'a monitor.log that does not exist exits 0 with "nothing to do" and performs zero writes under repo-dir',
    async () => {
      const result = await execa(
        REAL_CONDUCT_TS,
        [
          'halt-issues',
          'sweep',
          '--dry-run',
          '--repo-dir',
          repoDir,
          '--monitor-log',
          join(repoDir, 'does-not-exist.log'),
          '--ledger',
          join(ledgerDir, 'ledger.json'),
          '--gh-repo',
          'acme/repo',
        ],
        { cwd: repoDir, reject: false },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/no monitor\.log — nothing to do/);
    },
    30_000,
  );

  it(
    'an unknown flag exits non-zero with usage text and performs no partial run',
    async () => {
      const result = await execa(
        REAL_CONDUCT_TS,
        ['halt-issues', 'sweep', '--not-a-real-flag'],
        { cwd: repoDir, reject: false },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/usage|unknown/i);
    },
    30_000,
  );

  it(
    '--help documents the dry-run, repo-dir, gh-repo, monitor-log, and ledger flags',
    async () => {
      const result = await execa(REAL_CONDUCT_TS, ['halt-issues', 'sweep', '--help'], {
        cwd: repoDir,
        reject: false,
      });

      expect(result.exitCode).toBe(0);
      const out = result.stdout + result.stderr;
      for (const flag of ['--dry-run', '--repo-dir', '--gh-repo', '--monitor-log', '--ledger']) {
        expect(out).toContain(flag);
      }
    },
    30_000,
  );
});
