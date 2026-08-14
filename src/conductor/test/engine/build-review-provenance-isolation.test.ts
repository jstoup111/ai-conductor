import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { BaseAdvance } from '../../src/engine/test-suite-remediation.js';

// Provenance classification reads the base-advance history; Task 25 requires
// that a failure inside that classification never fails grader-input assembly.
// The real reader tolerates every corrupt-file shape (Task 8), so the throw
// has to be injected at the module boundary.
let historyImpl: (projectRoot: string) => Promise<BaseAdvance[]>;

vi.mock('../../src/engine/test-suite-remediation.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/engine/test-suite-remediation.js')>();
  return {
    ...actual,
    readBaseAdvanceHistory: (projectRoot: string) => historyImpl(projectRoot),
  };
});

const execFileAsync = promisify(execFile);

const currentBuildReviewProof = {
  inspectTestSuite: async () => ({
    status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
  } as never),
};

describe('engine/build-review-inputs — provenance isolation (Task 25)', () => {
  let dir: string;
  let planPath: string;

  const git = (...args: string[]) => execFileAsync('git', ['-C', dir, ...args]);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-provenance-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    planPath = join(dir, '.docs/plans/fixture.md');
    await writeFile(planPath, '# Plan body\n\nFixture plan.\n', 'utf-8');

    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'base.txt'), 'base\n');
    await git('add', '.');
    await git('commit', '-m', 'initial commit on base');
    await git('remote', 'add', 'origin', dir);
    await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'feature.txt'), 'feature change\n');
    await git('add', '.');
    await git('commit', '-m', 'add feature change');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function realGit() {
    return async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
        return { exitCode: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      }
    };
  }

  it('a provenance classification failure still produces grader inputs, while classification itself stays live', async () => {
    const { assembleBuildReviewInputs } = await import('../../src/engine/build-review-inputs.js');
    const { buildGraderPrompt } = await import('../../src/engine/build-review-prompt.js');

    // Failure half: history read throws mid-classification. Assembly must
    // resolve anyway, leaving the grading unattributed — and the prompt must
    // still render the repair block's explicit empty state rather than
    // borrowing another evidence block.
    historyImpl = async () => {
      throw new Error('simulated provenance read failure');
    };
    const degraded = await assembleBuildReviewInputs(realGit(), planPath, currentBuildReviewProof);
    expect(degraded.repairProvenance).toBeUndefined();
    expect(degraded.repairContext).toEqual([]);
    const prompt = buildGraderPrompt(degraded);
    const repairBlock =
      prompt.match(
        /## Engine-recorded rebase repair context\n([\s\S]*?)\n## Engine-accepted scope widenings/,
      )?.[1] ?? '';
    expect(repairBlock.trim()).toBe('(none)');

    // Live half (discriminates against a build without the provenance field):
    // the same assembly with a readable history and no joined repair classifies
    // as no_join instead of staying silent.
    historyImpl = async () => [{ paths: ['src/base.ts'], ts: new Date(100).toISOString() }];
    const attributed = await assembleBuildReviewInputs(realGit(), planPath, currentBuildReviewProof);
    expect(attributed.repairProvenance).toEqual({ disposition: 'no_join' });
  });
});
