// Covers: task:16
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { enumerateUnmergedBranches, runOverlapScan } from '../../src/engine/overlap-scan.js';
import { parseFeatureRef } from '../../src/engine/feature-branch-identity.js';
import type { BlockerResolver } from '../../src/engine/blocker-resolver.js';

const execFile = promisify(execFileCallback);
const unblocked: BlockerResolver = { resolve: async () => ({ kind: 'unblocked' }) };

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'overlap-scan-branch-set-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test User']);
  await writeFile(join(repo, 'evidence.ts'), 'export const evidence = 1;\n');
  await git(['add', 'evidence.ts']);
  await git(['commit', '-m', 'initial evidence']);
  await makeOverlappingBranch('spec/x', 2);
  await makeOverlappingBranch('feat/daemon-y', 3);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function git(args: string[]): Promise<void> {
  await execFile('git', args, { cwd: repo });
}

async function makeOverlappingBranch(branch: string, value: number): Promise<void> {
  await git(['checkout', '-b', branch]);
  await writeFile(join(repo, 'evidence.ts'), `export const evidence = ${value};\n`);
  await git(['add', 'evidence.ts']);
  await git(['commit', '-m', `change evidence on ${branch}`]);
  await git(['checkout', 'main']);
}

describe('engine/overlap-scan — DECIDE branch set (Task 16)', () => {
  it('keeps the default scan limited to overlapping spec branches', async () => {
    const gitRunner = makeGitRunner(repo);
    const branches = await enumerateUnmergedBranches(gitRunner, 'main');
    const report = await runOverlapScan({
      candidateFiles: ['evidence.ts'],
      git: gitRunner,
      resolver: unblocked,
      localBase: 'main',
    });

    expect({ branches, seamOverlaps: report.seamOverlaps }).toEqual({
      branches: ['spec/x'],
      seamOverlaps: [{ branch: 'spec/x', files: ['evidence.ts'] }],
    });
  });

  it('drops candidate refs rejected by acceptCandidate before any rev-list call', async () => {
    const recorded: string[][] = [];
    const gitRunner: GitRunner = async (args) => {
      recorded.push(args);
      if (args[0] === 'for-each-ref') {
        return { exitCode: 0, stdout: 'feat/c1/a/b\nfeat/c1/\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '1', stderr: '' };
    };

    const branches = await enumerateUnmergedBranches(
      gitRunner,
      'main',
      ['refs/heads/feat/c[1-9]/*', 'refs/remotes/*/feat/c[1-9]/*'],
      undefined,
      (ref) => parseFeatureRef(ref).kind !== 'unrecognized',
    );

    expect(branches).toEqual([]);
    // Both candidate refs were rejected by the predicate, so the rev-list
    // loop is never reached and no argv names either ref after enumeration.
    expect(recorded.filter((args) => args[0] === 'rev-list')).toEqual([]);
  });
});
