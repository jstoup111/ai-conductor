import { describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  emitExcusedRebaseCitationResidue,
  resolveConflictingPr,
  runAcceptanceGuards,
} from '../../src/engine/autoresolve.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — sweep supersession preservation mode', () => {
  it('takes citation-residue reasons from the supplied guard result', async () => {
    const emitted: unknown[] = [];
    const excused = [{
      sha: 'a'.repeat(40),
      subject: 'test: supplied guard reason',
      reason: 'future-declared-reason',
      paths: ['supplied.test.ts'],
    }];

    await emitExcusedRebaseCitationResidue(
      { emit: async (event: Parameters<ConductorEventEmitter['emit']>[0]) => { emitted.push(event); } } as never,
      excused,
    );

    expect(emitted).toEqual([{
      type: 'rebase_citation_residue',
      residue: [{
        sha: 'a'.repeat(40),
        citingTaskIds: [],
        reason: 'future-declared-reason',
      }],
    }]);
  });

  it('keeps a bare strict-path resolution on the legacy no-declarations guard call', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'autoresolve-supersession-'));
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    try {
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      await git(['config', 'user.email', 't@example.test']);
      await git(['config', 'user.name', 'Test']);
      await writeFile(join(repo, 'test-only.test.ts'), 'initial\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'init']);

      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(repo, 'test-only.test.ts'), 'upstream-equivalent\n');
      await git(['commit', '-q', '-am', 'test: upstream-equivalent change']);

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'test-only.test.ts'), 'upstream-equivalent\n');
      await git(['commit', '-q', '-am', 'main: land equivalent change']);

      const gh: GhRunner = async (args) => ({
        stdout: args[0] === 'pr' && args[1] === 'view'
          ? JSON.stringify({ comments: [] })
          : '',
      });
      let suiteRuns = 0;
      const outcome = await resolveConflictingPr(
        { prUrl: 'https://github.com/example/repo/pull/42', slug: 'feature', repoCwd: repo },
        'feature',
        { enabled: true, suiteCommand: 'unused', cooldownMinutes: 0, attemptCap: 1 },
        {
          runGh: gh,
          runSuite: async () => {
            suiteRuns += 1;
            return { exitCode: 0, durationMs: 0, configured: true };
          },
          resolver: async () => ({ resolved: false, reason: 'not reached' }),
          log: () => undefined,
        },
      );

      // Strict paths now omit the fourth guard argument rather than turning an
      // unsolicited resolver result into a declaration. The legacy guard
      // therefore reaches suite verification before the fixture's no-remote
      // publish failure escalates it.
      expect(outcome).toEqual({ kind: 'escalated' });
      expect(suiteRuns).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it.each([
    { mode: 'strict', choice: 'superseded' as const, rationale: 'upstream already contains the resolved content', path: 'app.ts', guardArgumentCount: 3 },
    { mode: 'strict', choice: 'merged' as const, rationale: 'the strict resolver merged both edits', path: 'app.ts', guardArgumentCount: 3 },
    { mode: 'judgement', choice: 'source' as const, rationale: 'the test-only resolver retained the source edit', path: 'app.test.ts', guardArgumentCount: 4 },
  ])('$mode resolution handles a schema-valid $choice verdict with the correct guard mode', async ({
    mode,
    choice,
    rationale,
    path,
    guardArgumentCount,
  }) => {
    const repo = await mkdtemp(join(tmpdir(), 'autoresolve-strict-verdict-'));
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const prUrl = 'https://github.com/example/repo/pull/43';
    try {
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      const remote = join(repo, 'remote.git');
      await execFile('git', ['init', '--bare', '-q', remote]);
      await execFile('git', ['config', 'core.logAllRefUpdates', 'true'], { cwd: remote });
      await git(['config', 'user.email', 't@example.test']);
      await git(['config', 'user.name', 'Test']);
      await git(['remote', 'add', 'origin', remote]);
      await writeFile(join(repo, path), 'initial\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'init']);

      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(repo, path), 'feature change\n');
      await git(['commit', '-q', '-am', `feat: feature ${mode} change`]);

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, path), 'main change\n');
      await git(['commit', '-q', '-am', `main: conflicting ${mode} change`]);
      await git(['push', '-q', 'origin', 'main', 'feature']);

      const ghCalls: string[][] = [];
      const gh: GhRunner = async (args) => {
        ghCalls.push(args);
        return {
          stdout: args[0] === 'pr' && args[1] === 'view'
            ? JSON.stringify({ comments: [] })
            : '',
        };
      };
      const emitted: unknown[] = [];
      const logs: string[] = [];
      const guardCalls: Parameters<typeof runAcceptanceGuards>[] = [];
      const outcome = await resolveConflictingPr(
        { prUrl, slug: `feature-${choice}`, repoCwd: repo },
        'feature',
        { enabled: true, suiteCommand: 'unused', cooldownMinutes: 0, attemptCap: 1 },
        {
          runGh: gh,
          runSuite: async () => ({ exitCode: 0, durationMs: 0, configured: true }),
          resolver: async ({ projectRoot }) => {
            await writeFile(join(projectRoot, path), `resolved ${mode} path\n`);
            await execFile('git', ['add', path], { cwd: projectRoot });
            await execFile('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: projectRoot });
            return { resolved: true, verdict: { choice, rationale, superseded: [] } };
          },
          log: (message) => logs.push(message),
          events: { emit: async (event: Parameters<ConductorEventEmitter['emit']>[0]) => { emitted.push(event); } } as never,
          runAcceptanceGuards: async (...args) => {
            guardCalls.push(args);
            return runAcceptanceGuards(...args);
          },
        },
      );

      expect(outcome).toEqual({ kind: 'refreshed' });
      const reflog = await execFile('git', ['reflog', 'show', '--format=%H', 'refs/heads/feature'], { cwd: remote });
      expect(reflog.stdout.trim().split('\n')).toHaveLength(2);
      expect(guardCalls).toHaveLength(1);
      expect(guardCalls[0]).toHaveLength(guardArgumentCount);
      if (mode === 'strict') {
        expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'comment')).toBe(false);
        expect(emitted).toEqual([]);
        expect(logs.filter((message) => message.includes(prUrl) && message.includes('ignored'))).toHaveLength(1);
      } else {
        // Task 18: every test-only sweep resolution enters judgement mode,
        // even when the accepted verdict declares no superseded commits.
        expect(guardCalls[0][3]).toEqual([]);
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
