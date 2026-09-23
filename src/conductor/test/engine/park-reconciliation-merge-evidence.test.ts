import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  reconcileMergedPark,
  reconcileParkedFeatures,
} from '../../src/engine/park-reconciliation.js';
import { isOperatorParked, writeOperatorPark } from '../../src/engine/park-marker.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { GhCapabilityError } from '../../src/engine/tracker-client.js';

const execFile = promisify(execFileCb);

/**
 * Real local `git`, injected explicitly. The production runner is blocked
 * under `AI_CONDUCTOR_NO_REAL_EXEC`; git semantics are the subject here, so
 * this is a local-only runner over temp repositories, never a third party.
 */
const realGit: GitRunner = async (args, opts) => {
  const { stdout } = await execFile('git', args, { cwd: opts.cwd });
  return { stdout: String(stdout) };
};

/**
 * Merge evidence is a question about GIT semantics — what a ref prefix is,
 * what happens to a branch after a merge deletes it, what `merge-base
 * --is-ancestor` returns for a ref that does not exist — so these run against
 * a real local repository and a real local bare remote. No network: `origin`
 * is a bare repo in the same temp directory. The tracker boundary is faked.
 *
 * The regression under test: the sweep used to probe a hardcoded
 * `feature/<slug>` ref. This repository's branches carry `feat/`, `spec/`,
 * `fix/`, `chore/`, `docs/` and more, so that ref usually did not exist, git
 * exited 128 ("Not a valid object name"), and the catch clause — which only
 * recognized exit 1 — classified EVERY parked feature `unclassified`.
 */
describe('engine/park-reconciliation — merge evidence against real git', () => {
  let root: string;
  let repo: string;

  const git = async (args: string[], cwd = repo): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  };

  const commit = async (relPath: string, body: string, message: string): Promise<void> => {
    await mkdir(join(repo, relPath.slice(0, relPath.lastIndexOf('/'))), { recursive: true });
    await writeFile(join(repo, relPath), body);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', message]);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'park-merge-evidence-'));
    const remote = join(root, 'remote.git');
    repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });
    await execFile('git', ['init', '--bare', '-b', 'main', remote]);
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.invalid']);
    await git(['config', 'user.name', 'Park Reconciliation Test']);
    await git(['config', 'commit.gpgsign', 'false']);
    await commit('.docs/README.md', 'base\n', 'chore: base commit');
    await git(['remote', 'add', 'origin', remote]);
    await git(['push', '-q', '-u', 'origin', 'main']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('classifies a merged feature whose branch uses a non-`feature/` prefix as merged', async () => {
    const slug = 'first-class-codex-harness-parity-904';
    // Branch created at the pushed main tip: contained in origin/main, and
    // named with this repository's actual `spec/` prefix rather than `feature/`.
    await git(['branch', `spec/${slug}`, 'main']);
    await writeOperatorPark(repo, slug);

    const result = await reconcileParkedFeatures({ projectRoot: repo, runGit: realGit, autoCleanup: false });

    expect(result.entries).toEqual([
      { slug, classification: 'merged', annotation: 'merged-ready' },
    ]);
    expect(result.counts.skipped).toBe(0);
  });

  it('classifies a merged feature whose branch was deleted after the merge as merged, and reconciles it', async () => {
    const slug = 'branch-deleted-at-merge';
    // The shipped record is committed on origin/main under its DATED plan
    // stem, while the park marker is keyed by the undated slug — the shape
    // every genuinely shipped feature in this repository has.
    await commit(`.docs/shipped/2026-07-25-${slug}.md`, `slug: 2026-07-25-${slug}\n`, `ship: ${slug}`);
    await git(['push', '-q', 'origin', 'main']);
    await writeOperatorPark(repo, slug);

    const swept = await reconcileParkedFeatures({ projectRoot: repo, runGit: realGit, autoCleanup: false });
    expect(swept.entries).toEqual([{ slug, classification: 'merged', annotation: 'merged-ready' }]);

    const outcome = await reconcileMergedPark({ projectRoot: repo, slug, runGit: realGit });

    expect({ outcome, parked: await isOperatorParked(repo, slug) }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-absent', 'unparked'] },
      parked: false,
    });
  });

  it('does not classify a genuinely unmerged feature as merged and never deletes its branch', async () => {
    const slug = 'still-building';
    await git(['checkout', '-q', '-b', `feat/${slug}`]);
    await commit('src/wip.txt', 'unmerged work\n', 'feat: work in progress');
    const tip = await git(['rev-parse', `feat/${slug}`]);
    await git(['checkout', '-q', 'main']);
    await mkdir(join(repo, '.docs', 'intake'), { recursive: true });
    await writeFile(join(repo, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/app#42\n');
    await writeOperatorPark(repo, slug);

    const result = await reconcileParkedFeatures({
      projectRoot: repo,
      runGit: realGit,
      getIssueState: async () => 'OPEN',
    });
    const outcome = await reconcileMergedPark({ projectRoot: repo, slug, runGit: realGit });

    expect({
      entries: result.entries,
      outcome,
      branchStillThere: await git(['rev-parse', `feat/${slug}`]),
      parked: await isOperatorParked(repo, slug),
    }).toEqual({
      entries: [{ slug, classification: 'normal', annotation: undefined }],
      outcome: { slug, steps: [], refusal: 'no-merge-proof' },
      branchStillThere: tip,
      parked: true,
    });
  });

  it('classifies a real git failure as unclassified rather than guessing either way', async () => {
    const notARepo = join(root, 'not-a-repo');
    const slug = 'infra-down';
    await mkdir(notARepo, { recursive: true });
    await writeOperatorPark(notARepo, slug);
    const logs: string[] = [];

    const result = await reconcileParkedFeatures({
      projectRoot: notARepo,
      runGit: realGit,
      getIssueState: async () => 'CLOSED',
      log: (line) => logs.push(line),
    });
    const outcome = await reconcileMergedPark({ projectRoot: notARepo, slug, runGit: realGit });

    expect({ entries: result.entries, counts: result.counts, outcome, logs }).toEqual({
      entries: [{ slug, classification: 'unclassified', annotation: undefined }],
      counts: { reconciled: 0, deferred: 0, orphaned: 0, parked: 0, refused: 0, skipped: 1 },
      // Fail-closed: no ancestry answer means no cleanup, not "not merged".
      outcome: { slug, steps: [], refusal: 'ancestry-check-failed' },
      logs: ['[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=0 refused=0 skipped=1; next: 1 skipped retry when merge/issue evidence is available'],
    });
    expect(await isOperatorParked(notARepo, slug)).toBe(true);
  });
});

interface GitWorld {
  shipped?: readonly string[];
  branches?: readonly string[];
  merged?: readonly string[];
  mergedPrHeads?: readonly string[];
  tips?: Readonly<Record<string, string>>;
  unmergedLog?: readonly string[];
}

function gitFailure(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeGit(world: GitWorld): { run: ReturnType<typeof vi.fn<GitRunner>>; deleted: string[] } {
  const branches = world.branches ?? [];
  const deleted: string[] = [];
  const run = vi.fn<GitRunner>(async (args) => {
    switch (args[0]) {
      case 'ls-tree':
        return { stdout: `${(world.shipped ?? []).map((stem) => `${stem}.md`).join('\n')}\n` };
      case 'for-each-ref':
        return { stdout: `${branches.join('\n')}\n` };
      case 'merge-base': {
        const ref = args[2];
        if (args[3] !== undefined && world.mergedPrHeads?.includes(ref)) return { stdout: '' };
        if (world.merged?.includes(ref)) return { stdout: '' };
        throw gitFailure(1, 'not an ancestor');
      }
      case 'rev-parse':
        if (args[1] === '--verify') return { stdout: 'base\n' };
        if (world.tips?.[args[1]] === undefined) throw gitFailure(128, `missing ${args[1]}`);
        return { stdout: `${world.tips[args[1]]}\n` };
      case 'cat-file':
        return { stdout: '' };
      case 'log':
        return { stdout: `${(world.unmergedLog ?? []).join('\n')}\n` };
      // These fixtures model a clean, registered candidate.  The production
      // deletion guard now probes porcelain before any destructive command;
      // leaving that command unmodelled would correctly be treated as an
      // unreadable (and therefore dirty) worktree instead.
      case 'status':
        return { stdout: '' };
      case 'worktree':
        return { stdout: '' };
      case 'branch':
        deleted.push(args[2]);
        return { stdout: '' };
      default:
        throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    }
  });
  return { run, deleted };
}

describe('engine/park-reconciliation — listed branch merge evidence', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'park-listed-branch-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function parkedWorktree(slug: string): Promise<string> {
    const path = join(projectRoot, '.worktrees', slug);
    await mkdir(path, { recursive: true });
    await writeOperatorPark(projectRoot, slug);
    return path;
  }

  it('proves hotfix/x by ancestry corroborated by its merged PR head when it is the listed branch for hotfix-x', async () => {
    const slug = 'hotfix-x';
    const branch = 'hotfix/x';
    const tip = '3333333333333333333333333333333333333333';
    await parkedWorktree(slug);
    // A shipped record exists but is never consulted for a non-daemon branch
    // (adr-2026-08-01 D8): only the merged PR head corroborates its ancestry.
    const { run, deleted } = makeGit({ shipped: [slug], branches: [branch], merged: [branch], tips: { [branch]: tip } });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{"headRefOid":"${tip}"}]` });

    const outcome = await reconcileMergedPark({ projectRoot, slug, branch, runGit: run, runGh });

    expect({ outcome, deleted, ghCalls: runGh.mock.calls.length }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
      deleted: [branch],
      ghCalls: 1,
    });
  });

  it('proves a listed feat/daemon branch by its merged PR head identity', async () => {
    const slug = 'head-identity';
    const branch = `feat/daemon-${slug}`;
    const tip = '1111111111111111111111111111111111111111';
    await parkedWorktree(slug);
    const { run, deleted } = makeGit({ shipped: [slug], branches: [branch], tips: { [branch]: tip } });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{'headRefOid':'${tip}'}]`.replaceAll("'", '"') });

    const outcome = await reconcileMergedPark({ projectRoot, slug, branch, runGit: run, runGh });

    expect({ outcome, deleted, ghCalls: runGh.mock.calls }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
      deleted: [branch],
      ghCalls: [[
        ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'headRefOid', '--limit', '1'],
        { cwd: projectRoot },
      ]],
    });
  });

  it('deletes only the listed branch when another local branch has the slug final segment', async () => {
    const slug = 'shared-segment';
    const branch = `feat/daemon-${slug}`;
    const otherBranch = `spec/${slug}`;
    await parkedWorktree(slug);
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [branch, otherBranch],
      merged: [branch, otherBranch],
    });

    const outcome = await reconcileMergedPark({ projectRoot, slug, branch, runGit: run });

    expect({ outcome, deleted }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
      deleted: [branch],
    });
  });

  it.each([
    {
      name: 'no merged PR proves the listed branch',
      slug: 'no-merge-proof',
      branch: 'hotfix/no-merge-proof',
      world: { branches: ['hotfix/no-merge-proof'] },
      gh: async () => ({ stdout: '[]' }),
      expected: { refusal: 'no-merge-proof' },
    },
    {
      name: 'the listed branch has commits beyond its merged PR head',
      slug: 'unmerged-commits',
      branch: 'hotfix/unmerged-commits',
      world: {
        shipped: ['unmerged-commits'],
        branches: ['hotfix/unmerged-commits'],
        tips: { 'hotfix/unmerged-commits': '2222222222222222222222222222222222222222' },
        mergedPrHeads: ['1111111111111111111111111111111111111111'],
        unmergedLog: ['aaaaaaa retained commit'],
      },
      gh: async () => ({ stdout: '[{"headRefOid":"1111111111111111111111111111111111111111"}]' }),
      expected: {
        refusal: 'unmerged-commits',
        unmergedCommits: { commits: [{ sha: 'aaaaaaa', subject: 'retained commit' }], overflow: 0 },
      },
    },
    {
      name: 'the listed branch is absent and no record landed',
      slug: 'branch-missing',
      branch: 'hotfix/branch-missing',
      world: { branches: [] },
      gh: async () => ({ stdout: '[]' }),
      expected: { refusal: 'branch-missing' },
    },
    {
      name: 'gh capability is unavailable for the listed branch',
      slug: 'gh-unavailable',
      branch: 'hotfix/gh-unavailable',
      world: { branches: ['hotfix/gh-unavailable'] },
      gh: async () => { throw new GhCapabilityError('gh', 'not configured'); },
      expected: { refusal: 'no-merge-proof' },
    },
  ] as const)('leaves paths and branches untouched when $name', async ({ slug, branch, world, gh, expected }) => {
    const worktree = await parkedWorktree(slug);
    const { run, deleted } = makeGit(world);
    const runGh = vi.fn<GhRunner>(gh);

    const outcome = await reconcileMergedPark({ projectRoot, slug, branch, runGit: run, runGh });

    expect({
      outcome,
      deleted,
      worktreeStillExists: await access(worktree).then(() => true, () => false),
      parked: await isOperatorParked(projectRoot, slug),
    }).toEqual({
      outcome: { slug, steps: [], ...expected },
      deleted: [],
      worktreeStillExists: true,
      parked: true,
    });
  });
});
