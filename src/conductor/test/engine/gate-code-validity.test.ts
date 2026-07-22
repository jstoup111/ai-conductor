/**
 * Task 2 (gate-step-completion-validates-against-code-state-, #817): unit
 * tests for `gateVerdictStillValid`, the shared re-dispatch decision helper.
 *
 * Proves the task's own verify slice of the full truth table (Task 9 adds
 * the rest): reachable+miss→preserve, reachable+hit→rerun, orphan→rerun,
 * uncomputable→rerun, no-stamp→rerun. Uses a real scratch git repo (not a
 * fake GitRunner) so ancestry/diff computation is exercised for real,
 * mirroring `rebase-autostash.test.ts`'s convention.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { gateVerdictStillValid } from '../../src/engine/gate-code-validity.js';

interface Scratch {
  repo: string;
  git: ReturnType<typeof makeGitRunner>;
}

async function makeRepo(): Promise<Scratch> {
  const repo = await mkdtemp(join(tmpdir(), 'gate-code-validity-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.com']);
  await git(['config', 'user.name', 'T']);
  await git(['config', 'commit.gpgsign', 'false']);
  return { repo, git };
}

async function commit(
  { repo, git }: Scratch,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(repo, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await git(['add', '.']);
  await git(['commit', '-q', '-m', message]);
  const r = await git(['rev-parse', 'HEAD']);
  return r.stdout.trim();
}

const scratches: string[] = [];
afterEach(async () => {
  while (scratches.length) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

describe('gateVerdictStillValid', () => {
  it('returns rerun when codeStamp is absent', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      undefined,
    );
    expect(result).toBe('rerun');
  });

  it('returns rerun when codeStamp is null', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      null,
    );
    expect(result).toBe('rerun');
  });

  it('returns preserve when the baseline is reachable and the delta since it is empty (surface miss)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('preserve');
  });

  it('returns rerun when the baseline is reachable but the delta touches the surface (surface hit)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      baseline,
    );
    expect(result).toBe('rerun');
  });

  it('returns rerun when the stamped baseline is orphaned (unreachable in current history)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    const orphaned = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await s.git(['commit', '--amend', '-q', '-m', 'init (amended)']);
    const isAncestor = await s.git(['merge-base', '--is-ancestor', orphaned, 'HEAD']);
    expect(isAncestor.exitCode).not.toBe(0); // sanity: fixture really orphaned it

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      orphaned,
    );
    expect(result).toBe('rerun');
  });

  it('returns rerun when the delta from the stamped baseline is uncomputable (bogus sha)', async () => {
    const s = await makeRepo();
    scratches.push(s.repo);
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');

    const result = await gateVerdictStillValid(
      { projectRoot: s.repo, git: s.git },
      'build_review',
      '0'.repeat(40),
    );
    expect(result).toBe('rerun');
  });
});
