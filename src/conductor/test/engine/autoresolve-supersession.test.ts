import { describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — sweep supersession preservation mode', () => {
  it('treats an empty sweep declaration as judgement mode instead of accepting an undeclared upstream-equivalent drop', async () => {
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

      // A legacy (omitted) fourth guard argument would accept the equivalent
      // change via supersededByBase and run the suite. This stage-specific
      // escalation proves the sweep passed its empty declaration array.
      expect(outcome).toEqual({ kind: 'escalated' });
      expect(suiteRuns).toBe(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
