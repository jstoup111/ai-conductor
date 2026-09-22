// Covers: task:12
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { materializeBuildReviewLap } from '../../src/engine/build-review-materialization.js';
import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout;
}

describe('engine/build-review-materialization', () => {
  it('attaches one shared source materialization during custom-lap input preparation', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-input-preparation-'));
    let lap: Awaited<ReturnType<typeof materializeBuildReviewLap>>;
    try {
      await git(projectRoot, 'init', '-b', 'main');
      await git(projectRoot, 'config', 'user.email', 'test@example.com');
      await git(projectRoot, 'config', 'user.name', 'Test');
      await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
      const planPath = join(projectRoot, '.docs', 'plans', 'review.md');
      await writeFile(planPath, '### Task 12: materialize source\n');
      await writeFile(join(projectRoot, 'reviewed.txt'), 'baseline\n');
      await git(projectRoot, 'add', '.');
      await git(projectRoot, 'commit', '-m', 'baseline');
      await git(projectRoot, 'checkout', '-b', 'feature');
      await writeFile(join(projectRoot, 'reviewed.txt'), 'reviewed head\n');
      await git(projectRoot, 'commit', '-am', 'head');

      const inputs = await assembleBuildReviewInputs(makeGitRunner(projectRoot), planPath, {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'unrelated-proof-head', outcome: 'PASS' },
        } as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>),
        lapMembers: [{ id: 'testQuality', kind: 'builtin' }, { id: 'style', kind: 'custom' }],
        materialization: { projectRoot },
      });
      lap = inputs.sourceMaterialization;

      expect(lap?.contextFor('testQuality').source).toBe(lap?.contextFor('style').source);
      expect(lap?.source.identity).toMatchObject({
        snapshotDigest: inputs.sourceSnapshot.digest,
        mergeBase: inputs.sourceSnapshot.mergeBase,
        headSha: inputs.sourceSnapshot.headSha,
      });
      expect(await readFile(join(lap!.contextFor('style').source.headPath, 'reviewed.txt'), 'utf8')).toBe('reviewed head\n');
    } finally {
      await lap?.settle('style');
      await lap?.settle('testQuality');
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('gives every custom-lap member one captured baseline/head view until all outcomes settle', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-materialization-'));
    let lap: Awaited<ReturnType<typeof materializeBuildReviewLap>>;
    try {
      await git(projectRoot, 'init');
      await git(projectRoot, 'config', 'user.email', 'test@example.com');
      await git(projectRoot, 'config', 'user.name', 'Test');
      const source = join(projectRoot, 'reviewed.txt');
      await writeFile(source, 'baseline\n');
      await git(projectRoot, 'add', 'reviewed.txt');
      await git(projectRoot, 'commit', '-m', 'baseline');
      const baseline = (await git(projectRoot, 'rev-parse', 'HEAD')).trim();
      await writeFile(source, 'reviewed head\n');
      await git(projectRoot, 'commit', '-am', 'head');
      const head = (await git(projectRoot, 'rev-parse', 'HEAD')).trim();

      lap = await materializeBuildReviewLap(makeGitRunner(projectRoot), {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: baseline, headSha: head,
      } as Parameters<typeof materializeBuildReviewLap>[1], [
        { id: 'testQuality', kind: 'builtin' }, { id: 'style', kind: 'custom' },
      ], { projectRoot });

      expect(lap).toBeDefined();
      const builtin = lap!.contextFor('testQuality');
      const custom = lap!.contextFor('style');
      expect(custom.source).toBe(builtin.source);
      expect(custom.source.identity).toEqual({
        snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: baseline, headSha: head,
      });
      expect(await readFile(join(builtin.source.baselinePath, 'reviewed.txt'), 'utf8')).toBe('baseline\n');
      expect(await readFile(join(custom.source.headPath, 'reviewed.txt'), 'utf8')).toBe('reviewed head\n');

      await writeFile(source, 'mutated original checkout\n');
      expect(await readFile(join(custom.source.headPath, 'reviewed.txt'), 'utf8')).toBe('reviewed head\n');
      await lap!.settle('style');
      await expect(access(custom.source.headPath)).resolves.toBeUndefined();
      await lap!.settle('testQuality');
      await expect(access(custom.source.headPath)).rejects.toThrow();
    } finally {
      if (lap) {
        await lap.settle('style');
        await lap.settle('testQuality');
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses an invalid baseline before creating a private worktree', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-materialization-invalid-'));
    const calls: string[][] = [];
    try {
      const gitRunner = async (args: string[]) => {
        calls.push(args);
        return { exitCode: 1, stdout: '', stderr: 'not a valid object' };
      };
      await expect(materializeBuildReviewLap(gitRunner, {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'a'.repeat(40), headSha: 'b'.repeat(40),
      } as Parameters<typeof materializeBuildReviewLap>[1], [{ id: 'style', kind: 'custom' }], { projectRoot })).rejects.toThrow(/baseline/i);
      expect(calls).toEqual([['cat-file', '-e', `${'a'.repeat(40)}^{commit}`]]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
