/**
 * END-TO-END acceptance specs for the auto-resolve-open-pr-conflicts pipeline
 * (.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md,
 * .docs/plans/auto-resolve-open-pr-conflicts.md).
 *
 * Covers: FR-3, FR-4, FR-6, FR-7, FR-10, FR-12, FR-13, FR-16
 *
 * These drive the REAL orchestrator this feature introduces —
 * `resolveConflictingPr` in the not-yet-existing `src/engine/autoresolve.ts` —
 * over a REAL git repo + REAL bare origin (no mocked git), following the exact
 * pattern of test/integration/rebase-loop.test.ts: git is exercised for real,
 * and ONLY true external services are injected — the `gh` runner (labels +
 * comments), the suite-command runner, and the Tier-2 `/rebase` resolver.
 *
 * This is the single full-pipeline acceptance spec judged necessary beyond the
 * per-story specs (autoresolve-guards / autoresolve-worktree-lifecycle /
 * autoresolve-lease-publish): it is the only place that proves detect(-ish) →
 * Tier1 → Tier2 → guards → suite → push/escalate compose correctly end to end,
 * analogous to what rebase-loop.test.ts proves for the finish-time path. Pure
 * eligibility gating (FR-1, FR-2, FR-14, FR-15 — cooldown/sticky/attempt-cap
 * bookkeeping) and the sweep-tick wiring itself are single-module/component
 * concerns better covered by `/tdd`'s extension of
 * test/engine/mergeable-sweep.test.ts and a new test/engine/autoresolve.test.ts
 * — see the FR-coverage table for the disposition of every FR.
 *
 * `autoresolve.ts` does not exist yet, so every test imports it dynamically
 * inside the `it()` body — a missing module fails per-test (RED), not as a
 * suite-level collection error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const PR_URL = 'https://github.com/acme/repo/pull/42';

describe('integration/autoresolve-loop — sweep-resolution pipeline', () => {
  let origin: string;
  let dir: string; // the primary checkout the orchestrator operates from (entry.repoCwd)

  const gDir = (args: string[]) => execFile('git', args, { cwd: dir });

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), 'autoresolve-loop-origin-'));
    await execFile('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });

    dir = await mkdtemp(join(tmpdir(), 'autoresolve-loop-work-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await gDir(['config', 'user.email', 't@t.com']);
    await gDir(['config', 'user.name', 'T']);
    await gDir(['config', 'commit.gpgsign', 'false']);
  });

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });

  function fakeGhFor(labelCalls: string[][], commentBodies: string[]) {
    return async (args: string[]) => {
      if (args[0] === 'api' && args.includes('--method')) {
        labelCalls.push(args);
        return { stdout: '{}' };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        commentBodies.push(args[args.indexOf('--body') + 1]);
        return { stdout: '' };
      }
      return { stdout: '' };
    };
  }

  it('a CHANGELOG-only conflict resolves deterministically, at zero dispatch cost, and publishes with the label restored (FR-3/FR-4/FR-6 happy)', async () => {
    // Base (origin/main) and the feature branch both append DIFFERENT entries
    // under [Unreleased] → a rebase conflict confined to CHANGELOG.md.
    await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n');
    await gDir(['add', '.']);
    await gDir(['commit', '-q', '-m', 'changelog scaffold']);
    await gDir(['remote', 'add', 'origin', origin]);
    await gDir(['push', 'origin', 'main']);

    await gDir(['checkout', '-q', '-b', 'feat/widget']);
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature widget entry\n',
    );
    await gDir(['commit', '-q', '-am', 'feature changelog']);
    await gDir(['push', 'origin', 'feat/widget']);

    await gDir(['checkout', '-q', 'main']);
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Sibling bar entry\n',
    );
    await gDir(['commit', '-q', '-am', 'sibling changelog']);
    await gDir(['push', 'origin', 'main']);
    await gDir(['checkout', '-q', 'feat/widget']);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const labelCalls: string[][] = [];
    const commentBodies: string[] = [];
    const logLines: string[] = [];
    let resolverCalls = 0;
    let suiteCalls = 0;

    const outcome = await autoresolve.resolveConflictingPr(
      { prUrl: PR_URL, slug: 'widget', repoCwd: dir },
      'feat/widget',
      { enabled: true, suiteCommand: 'true', cooldownMinutes: 60, attemptCap: 3 },
      {
        runGh: fakeGhFor(labelCalls, commentBodies),
        runSuite: async () => {
          suiteCalls++;
          return { exitCode: 0, durationMs: 5 };
        },
        resolver: async () => {
          resolverCalls++;
          return { resolved: true };
        },
        log: (msg: string) => logLines.push(msg),
      },
    );

    expect(outcome.kind).toBe('refreshed');
    // FR-6: zero assistant-session cost on the fully-deterministic path.
    expect(resolverCalls).toBe(0);
    expect(suiteCalls).toBe(1);

    // FR-3/FR-4: origin now carries BOTH entries exactly once, no markers.
    await execFile('git', ['fetch', 'origin', 'feat/widget'], { cwd: dir });
    const { stdout: changelog } = await execFile(
      'git',
      ['show', 'origin/feat/widget:CHANGELOG.md'],
      { cwd: dir },
    );
    expect(changelog).toContain('- Feature widget entry');
    expect(changelog).toContain('- Sibling bar entry');
    expect(changelog).not.toContain('<<<<<<<');

    // FR-16: the outcome is logged, identifying the PR.
    expect(logLines.some((l) => l.includes(PR_URL) && /refreshed/i.test(l))).toBe(true);
  });

  it('a genuinely semantic conflict short-circuits Tier 2 after one dispatch and escalates with the reason (FR-7/FR-13)', async () => {
    // Both sides edit the SAME line of a source file differently → real conflict,
    // outside every known-safe class.
    await writeFile(join(dir, 'src.ts'), 'export const v = 0;\n');
    await gDir(['add', '.']);
    await gDir(['commit', '-q', '-m', 'init source']);
    await gDir(['remote', 'add', 'origin', origin]);
    await gDir(['push', 'origin', 'main']);

    await gDir(['checkout', '-q', '-b', 'feat/widget']);
    await writeFile(join(dir, 'src.ts'), 'export const v = 1; // feature\n');
    await gDir(['commit', '-q', '-am', 'feature edits src']);
    await gDir(['push', 'origin', 'feat/widget']);

    await gDir(['checkout', '-q', 'main']);
    await writeFile(join(dir, 'src.ts'), 'export const v = 2; // base\n');
    await gDir(['commit', '-q', '-am', 'base edits src']);
    await gDir(['push', 'origin', 'main']);
    await gDir(['checkout', '-q', 'feat/widget']);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const labelCalls: string[][] = [];
    const commentBodies: string[] = [];
    const logLines: string[] = [];
    let resolverCalls = 0;

    const outcome = await autoresolve.resolveConflictingPr(
      { prUrl: PR_URL, slug: 'widget', repoCwd: dir },
      'feat/widget',
      { enabled: true, suiteCommand: 'true', cooldownMinutes: 60, attemptCap: 1 },
      {
        runGh: fakeGhFor(labelCalls, commentBodies),
        runSuite: async () => ({ exitCode: 0, durationMs: 1 }),
        resolver: async () => {
          resolverCalls++;
          return { resolved: false, reason: 'cannot resolve: genuinely ambiguous' };
        },
        log: (msg: string) => logLines.push(msg),
      },
    );

    expect(outcome.kind).toBe('escalated');
    // FR-7: the resolver was dispatched (cap threading — cap=1 → exactly 1 call,
    // then short-circuit, no further attempts).
    expect(resolverCalls).toBe(1);

    // FR-13: REST label ops (never `gh pr edit`) + a reason comment.
    const removedMergeable = labelCalls.some((c) => c.join(' ').includes('DELETE'));
    const addedNeedsRemediation = labelCalls.some(
      (c) => c.join(' ').includes('POST') && c.some((tok) => tok.includes('needs-remediation')),
    );
    expect(removedMergeable || addedNeedsRemediation).toBe(true);
    expect(commentBodies.some((b) => /cannot resolve|ambiguous/i.test(b))).toBe(true);

    // FR-12: the failed attempt published NOTHING — origin untouched.
    await execFile('git', ['fetch', 'origin', 'feat/widget'], { cwd: dir });
    const { stdout: remoteContent } = await execFile(
      'git',
      ['show', 'origin/feat/widget:src.ts'],
      { cwd: dir },
    );
    expect(remoteContent).toBe('export const v = 1; // feature\n');

    expect(logLines.some((l) => l.includes(PR_URL) && /escalat/i.test(l))).toBe(true);
  });

  it('a red suite aborts the attempt before publishing and escalates with the suite failure as the reason (FR-10/FR-12 negative)', async () => {
    // A CHANGELOG-only conflict — Tier 1 resolves cleanly — but the suite is red.
    await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n');
    await gDir(['add', '.']);
    await gDir(['commit', '-q', '-m', 'changelog scaffold']);
    await gDir(['remote', 'add', 'origin', origin]);
    await gDir(['push', 'origin', 'main']);

    await gDir(['checkout', '-q', '-b', 'feat/widget']);
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature widget entry\n',
    );
    await gDir(['commit', '-q', '-am', 'feature changelog']);
    await gDir(['push', 'origin', 'feat/widget']);

    await gDir(['checkout', '-q', 'main']);
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Sibling bar entry\n',
    );
    await gDir(['commit', '-q', '-am', 'sibling changelog']);
    await gDir(['push', 'origin', 'main']);
    await gDir(['checkout', '-q', 'feat/widget']);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const labelCalls: string[][] = [];
    const commentBodies: string[] = [];
    const logLines: string[] = [];

    const outcome = await autoresolve.resolveConflictingPr(
      { prUrl: PR_URL, slug: 'widget', repoCwd: dir },
      'feat/widget',
      { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 60, attemptCap: 3 },
      {
        runGh: fakeGhFor(labelCalls, commentBodies),
        runSuite: async () => ({ exitCode: 1, durationMs: 42 }),
        resolver: async () => ({ resolved: true }),
        log: (msg: string) => logLines.push(msg),
      },
    );

    expect(outcome.kind).toBe('escalated');
    expect(commentBodies.some((b) => /suite/i.test(b))).toBe(true);

    // Nothing published — origin/feat/widget was never touched by this attempt.
    await execFile('git', ['fetch', 'origin', 'feat/widget'], { cwd: dir });
    const { stdout: remoteContent } = await execFile(
      'git',
      ['show', 'origin/feat/widget:CHANGELOG.md'],
      { cwd: dir },
    );
    expect(remoteContent).not.toContain('- Sibling bar entry');
    expect(remoteContent).toContain('- Feature widget entry');

    expect(logLines.some((l) => l.includes(PR_URL) && /escalat/i.test(l))).toBe(true);
  });
});
