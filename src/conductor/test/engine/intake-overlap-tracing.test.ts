// Covers: task:5
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { buildSuggestions } from '../../src/engine/engineer/intake/overlap-suggestions.js';
import { collectInFlightOverlaps } from '../../src/engine/engineer/intake/overlap-sources.js';

const fixtureRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function commitBranch(
  repo: string,
  branch: string,
  sourceRef: string | null,
): Promise<void> {
  git(repo, 'switch', '-q', '-C', branch, 'main');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', `${branch.replaceAll('/', '-')}.ts`), 'export const changed = true;\n');
  if (sourceRef !== null) {
    const slug = branch.slice('feat/daemon-'.length);
    await mkdir(join(repo, '.docs', 'intake'), { recursive: true });
    await writeFile(join(repo, '.docs', 'intake', `${slug}.md`), `# ${slug}\n\nSource-Ref: ${sourceRef}\n`);
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', branch);
}

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'intake-overlap-tracing-'));
  fixtureRoots.push(root);
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test User');
  await writeFile(join(repo, 'README.md'), '# fixture\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');

  await commitBranch(repo, 'feat/daemon-open', 'owner/repo#1477');
  await commitBranch(repo, 'feat/daemon-no-marker', null);
  await commitBranch(repo, 'feat/daemon-unparseable', 'not-an-issue');
  await commitBranch(repo, 'feat/daemon-closed', 'owner/repo#1478');
  await commitBranch(repo, 'feat/daemon-other-repository', 'other/repo#1479');
  git(repo, 'switch', '-q', 'main');
  return repo;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engineer/intake/overlap-sources — branch issue tracing (Task 5)', () => {
  it('traces only same-target open GitHub issues and leaves every other branch advisory', async () => {
    const repo = await createFixture();
    const readIssueState = async (issue: string): Promise<'OPEN' | 'CLOSED'> => (
      issue === '1477' ? 'OPEN' : 'CLOSED'
    );

    const result = await collectInFlightOverlaps({
      git: makeGitRunner(repo),
      baseRef: 'main',
      citedPaths: [
        'src/feat-daemon-open.ts',
        'src/feat-daemon-no-marker.ts',
        'src/feat-daemon-unparseable.ts',
        'src/feat-daemon-closed.ts',
        'src/feat-daemon-other-repository.ts',
      ],
      repository: 'owner/repo',
      readIssueState,
    });

    expect(result.overlaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ branch: 'feat/daemon-open', issue: 'owner/repo#1477' }),
      expect.objectContaining({ branch: 'feat/daemon-no-marker', issue: null }),
      expect.objectContaining({ branch: 'feat/daemon-unparseable', issue: null }),
      expect.objectContaining({ branch: 'feat/daemon-closed', issue: null }),
      expect.objectContaining({ branch: 'feat/daemon-other-repository', issue: null }),
    ]));

    const suggestions = buildSuggestions({
      issueOverlaps: [],
      branchOverlaps: result.overlaps,
      alreadyNamed: [],
    });
    expect(suggestions.shown).toEqual([
      expect.objectContaining({ issue: 'owner/repo#1477', sharedPaths: ['src/feat-daemon-open.ts'] }),
    ]);
    expect(suggestions.advisory).toEqual(expect.arrayContaining([
      expect.objectContaining({ branch: 'feat/daemon-no-marker', sharedPaths: ['src/feat-daemon-no-marker.ts'] }),
      expect.objectContaining({ branch: 'feat/daemon-unparseable', sharedPaths: ['src/feat-daemon-unparseable.ts'] }),
      expect.objectContaining({ branch: 'feat/daemon-closed', sharedPaths: ['src/feat-daemon-closed.ts'] }),
      expect.objectContaining({ branch: 'feat/daemon-other-repository', sharedPaths: ['src/feat-daemon-other-repository.ts'] }),
    ]));
  });
});
