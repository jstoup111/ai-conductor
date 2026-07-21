// overlap-scan.acceptance.test.ts — DECIDE-time unmerged-overlap scan (#523, Scope A).
//
// Covers: TR-1 (seam overlap named), TR-2 (open blocker surfaced), TR-3 (quiet clean
// path), TR-4 (advisory degradation on a REAL git failure), TR-5 (exact-intersection,
// no substring/prefix false match).
//
// This suite drives `runOverlapScan` + `renderReport` against a REAL git repo via the
// REAL `makeGitRunner` (no fake GitRunner) — the per-task TDD specs in
// `test/engine/overlap-scan.test.ts` exercise the pure helpers against fakes; this file
// proves the real git plumbing (branch enumeration, real diffs, real merge state)
// actually composes end to end. Only the blocker resolver — a third-party (GitHub)
// boundary — is faked here, per the "mock only external services" rule.
//
// Not covered here (owned by lower layers / other tasks):
//   - CLI flag parsing / dispatch wiring → test/engine/overlap-scan-cli.test.ts (Task 7)
//   - `/plan` and `/architecture-review` SKILL.md step wiring → harness-integrity grep (Tasks 8-9)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { runOverlapScan, renderReport } from '../../src/engine/overlap-scan.js';
import type { BlockerResolver, BlockerVerdict } from '../../src/engine/blocker-resolver.js';

const execFile = promisify(execFileCb);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'overlap-scan-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 't@t.t']);
  await git(['config', 'user.name', 't']);
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'conductor.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'README.md'), '# repo\n');
  await git(['add', '-A']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function git(args: string[]): Promise<void> {
  await execFile('git', args, { cwd: repo });
}

/** Create a branch off main, mutate a file, and commit — leaves HEAD back on main. */
async function makeSiblingBranch(
  branch: string,
  file: string,
  contents: string,
): Promise<void> {
  await git(['checkout', '-b', branch]);
  await mkdir(join(repo, file.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
  await writeFile(join(repo, file), contents);
  await git(['add', '-A']);
  await git(['commit', '-m', `edit ${file}`]);
  await git(['checkout', 'main']);
}

function fakeResolver(verdict: BlockerVerdict): BlockerResolver {
  return { resolve: async () => verdict };
}

const noSourceRefResolver = fakeResolver({ kind: 'unblocked' });

describe('overlap-scan acceptance — real git plumbing', () => {
  it('TR-1 happy: names the branch and file for a real unmerged overlap', async () => {
    await makeSiblingBranch('spec/other', 'src/conductor.ts', 'export const a = 2;\n');

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps).toContainEqual(
      expect.objectContaining({ branch: 'spec/other', files: ['src/conductor.ts'] }),
    );
    const rendered = renderReport(report);
    expect(rendered).toContain('spec/other');
    expect(rendered).toContain('src/conductor.ts');
  });

  it('TR-1 happy: two overlapping branches are both listed, each attributed to its own branch', async () => {
    await writeFile(join(repo, 'src', 'other.ts'), 'export const b = 1;\n');
    await git(['add', '-A']);
    await git(['commit', '-m', 'add other.ts']);

    await makeSiblingBranch('spec/first', 'src/conductor.ts', 'export const a = 2;\n');
    await makeSiblingBranch('spec/second', 'src/other.ts', 'export const b = 2;\n');

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts', 'src/other.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps).toContainEqual(
      expect.objectContaining({ branch: 'spec/first', files: ['src/conductor.ts'] }),
    );
    expect(report.seamOverlaps).toContainEqual(
      expect.objectContaining({ branch: 'spec/second', files: ['src/other.ts'] }),
    );
  });

  it('TR-1/TR-5 negative: a branch touching only non-candidate files is not reported', async () => {
    await writeFile(join(repo, 'src', 'unrelated.ts'), 'export const z = 1;\n');
    await git(['add', '-A']);
    await git(['commit', '-m', 'add unrelated.ts']);
    await makeSiblingBranch('spec/unrelated', 'src/unrelated.ts', 'export const z = 2;\n');

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps.find((o) => o.branch === 'spec/unrelated')).toBeUndefined();
  });

  it('TR-1 negative: a branch already merged into base is excluded from enumeration', async () => {
    await makeSiblingBranch('spec/merged', 'src/conductor.ts', 'export const a = 3;\n');
    await git(['merge', '--no-ff', '-m', 'merge spec/merged', 'spec/merged']);

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps.find((o) => o.branch === 'spec/merged')).toBeUndefined();
  });

  it('TR-5 negative: a sibling-prefix file name is not a false match (no substring/prefix overlap)', async () => {
    await mkdir(join(repo, 'src', 'foo'), { recursive: true });
    await writeFile(join(repo, 'src', 'foo', 'helper.ts'), 'export const h = 1;\n');
    await git(['add', '-A']);
    await git(['commit', '-m', 'add helper.ts']);
    await makeSiblingBranch('spec/helper', 'src/foo/helper.ts', 'export const h = 2;\n');

    const report = await runOverlapScan({
      candidateFiles: ['src/foo/helperx.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps.find((o) => o.branch === 'spec/helper')).toBeUndefined();
  });

  it('TR-3 happy: no overlap and no open blockers renders a single clean line, no prompt', async () => {
    await makeSiblingBranch('spec/unrelated-again', 'README.md', '# repo\nchanged\n');

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });

    expect(report.seamOverlaps).toEqual([]);
    expect(report.blockers).toEqual([]);
    const rendered = renderReport(report);
    expect(rendered.toLowerCase()).toContain('no overlap');
    expect(rendered.toLowerCase()).toContain('no open blocker');
  });

  it('TR-2 happy: an open blocker is surfaced alongside a clean seam-overlap result', async () => {
    const blockerVerdict: BlockerVerdict = {
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: 'A' }],
    };

    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: fakeResolver(blockerVerdict),
      sourceRef: 'owner/repo#B',
      localBase: 'main',
    });

    expect(report.seamOverlaps).toEqual([]);
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ repo: 'owner/repo', number: 'A' }),
    );
    const rendered = renderReport(report);
    expect(rendered).toContain('owner/repo#A');
  });

  it('TR-4 negative: a real git enumeration failure (unresolvable base) degrades to an advisory note, never throws', async () => {
    await expect(
      runOverlapScan({
        candidateFiles: ['src/conductor.ts'],
        git: makeGitRunner(repo),
        resolver: noSourceRefResolver,
        localBase: 'does-not-exist-branch',
      }),
    ).resolves.toMatchObject({
      skipNotes: expect.arrayContaining([expect.anything()]),
    });
  });

  it('renders the rename/name-only-diff limitation note in every report', async () => {
    const report = await runOverlapScan({
      candidateFiles: ['src/conductor.ts'],
      git: makeGitRunner(repo),
      resolver: noSourceRefResolver,
      localBase: 'main',
    });
    const rendered = renderReport(report);
    expect(rendered.toLowerCase()).toMatch(/rename/);
  });
});
