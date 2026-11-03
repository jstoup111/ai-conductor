// Covers: task:24
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { isProcessed } from '../../src/engine/daemon-deps.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { makeRunFeature } from '../../src/engine/daemon-runner.js';
import { postRoutedComments, refreshPublishedStackMembers } from '../../src/engine/finish-publication-production.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { refreshLedgerRefFor } from '../../src/engine/stack-refresh-ledger.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from './slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const childOne = parseChildId(1)!;
const childTwo = parseChildId(2)!;
const slug = 'published-landing';
const prUrl = 'https://github.com/acme/demo/pull/102';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function commit(
  repo: string,
  message: string,
  path: string,
  contents: string,
  options: { daemonSession?: boolean } = {},
): Promise<string> {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), contents);
  await git(repo, 'add', path);
  if (options.daemonSession) {
    await execFile('git', ['commit', '-qm', message], {
      cwd: repo,
      env: { ...process.env, [DAEMON_SESSION_MARKER]: '1' },
    });
  } else {
    await git(repo, 'commit', '-qm', message);
  }
  return git(repo, 'rev-parse', 'HEAD');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'published-stack-landing-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  await mkdir(repo);
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.email', 'published-stack-landing@example.test');
  await git(repo, 'config', 'user.name', 'Published stack landing');
  await commit(repo, 'base', '.gitignore', '.pipeline/\n.daemon/\n');
  await commit(repo, 'routing enabled', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await writeSliceTopologyFixture(repo, {
    slug,
    materializeTopologyCommit: true,
    sliceMembership: { taskSlices: { one: 1, two: 2 }, titles: ['One', 'Leaf'] },
    storyOwnership: {},
  });
  await sealSliceTopologyPositions(repo, {
    slug,
    sliceMembership: { taskSlices: { one: 1, two: 2 }, titles: ['One', 'Leaf'] },
  });

  await git(repo, 'checkout', '-qb', `feat/c1/${slug}`);
  const closure = await commit(repo, 'closed child', 'one.txt', 'one\n');
  await git(repo, 'update-ref', closureRefFor(slug, childOne), closure);
  await commit(repo, 'reviewer landing', 'review.txt', 'review\n');
  await git(repo, 'checkout', '-qb', `feat/daemon-${slug}`, closure);
  await commit(repo, 'leaf', 'leaf.txt', 'leaf\n');
  await git(repo, 'checkout', '-q', `feat/c1/${slug}`);

  await git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  await git(repo, 'remote', 'add', 'origin', origin);
  for (const branch of [`feat/c1/${slug}`, `feat/daemon-${slug}`]) {
    await git(repo, 'push', '-q', 'origin', `${branch}:${branch}`);
  }

  const runner = makeGitRunner(repo);
  await writePublicationRecord(repo, slug, undefined, {
    version: 1,
    members: [
      { position: childOne, branch: `feat/c1/${slug}`, pr: 101 },
      { position: childTwo, branch: `feat/daemon-${slug}`, pr: 102 },
    ],
  }, { git: runner });
  for (const branch of [`feat/c1/${slug}`, `feat/daemon-${slug}`]) {
    await runner(['update-ref', pushedTipRef(slug, branch), (await runner(['rev-parse', branch])).stdout.trim()]);
  }
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));

  const output: string[] = [];
  const opened = await dispatchStackLandCommand({ kind: 'stack-land', slug, child: '1', carry: [], reason: 'reviewer update' }, {
    cwd: repo,
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    resolveOperator: async () => 'operator@example.test',
    print: (line) => output.push(line),
  });
  if (opened !== 0) throw new Error(output.join('\n'));
  await expect(dispatchStackLandCommand({ kind: 'stack-land-done', slug }, {
    cwd: repo,
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    print: (line) => output.push(line),
  })).resolves.toBe(0);
  expect(output.join('\n')).toContain('stack land: opened');
  expect(output.join('\n')).toContain('stack land: declared');
  return { root, repo, origin, runner };
}

function mutation() {
  return {
    provenance: {
      repository: 'acme/demo', defaultBranch: 'main', specBranch: `spec/${slug}`,
      featureMarker: `.docs/specs/${slug}.md`, publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'operator' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: `.docs/specs/${slug}.md`, content: 'Owner: operator\n' }] },
    },
  };
}

describe('published stack landing completion (real local Git)', () => {
  it('refreshes every published member at FINISH and posts the one routed host comment through the mocked operation boundary', async () => {
    const subject = await fixture();
    const hostComments: string[] = [];

    const publishedHostTip = await git(subject.repo, 'rev-parse', 'HEAD');
    const publishedLeafTip = await git(subject.repo, 'rev-parse', `feat/daemon-${slug}`);
    await commit(subject.repo, 'routed repair', 'review.txt', 'fixed\n', { daemonSession: true });
    const recordedHostTip = await git(subject.repo, 'rev-parse', 'HEAD');
    const ledger = {
      version: 1,
      members: {
        [`feat/c1/${slug}`]: { position: childOne, pr: 101, publishedTip: publishedHostTip, recordedTip: recordedHostTip },
        [`feat/daemon-${slug}`]: { position: childTwo, pr: 102, publishedTip: publishedLeafTip, recordedTip: publishedLeafTip },
      },
      rounds: [{ roundId: 'r1', kind: 'operator', host: childOne, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
      aboveOwed: [],
      posted: [],
    };
    await writeFile(join(subject.repo, '.pipeline', 'refresh-ledger.json'), JSON.stringify(ledger));
    await git(subject.repo, 'update-ref', refreshLedgerRefFor(slug), await git(subject.repo, 'hash-object', '-w', '.pipeline/refresh-ledger.json'));

    await refreshPublishedStackMembers({
      root: subject.repo,
      slug,
      mutation: mutation(),
      remoteGit: async (args) => {
        const refspec = args[2]!;
        const [source, destination] = refspec.split(':');
        const branch = destination!.replace('refs/heads/', '');
        await git(subject.repo, 'push', '-q', 'origin', refspec);
        await subject.runner(['update-ref', pushedTipRef(slug, branch), source!]);
        return { kind: 'executed', targets: [] } as never;
      },
      git: async (args, options) => {
        const result = await execa('git', args, { cwd: subject.repo, input: options?.input, reject: false });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 1 };
      },
    });
    // The provider/hosted-service boundaries are deliberately fake.  The
    // production comment adapter still reads the owed ledger receipt and
    // reaches the guarded operation seam exactly once.
    await postRoutedComments({
      root: subject.repo,
      slug,
      baseBranch: 'main',
      repository: 'acme/demo',
      git: async (args, options) => {
        const result = await execa('git', args, { cwd: subject.repo, input: options?.input, reject: false });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 1 };
      },
      gh: async () => ({ stdout: JSON.stringify({ comments: [] }) }),
      operations: {
        run: async (request) => {
          hostComments.push(`${request.operation}:${request.target.kind === 'pull-request' ? request.target.number : 'unknown'}`);
          return {};
        },
      },
      routedCommentTargets: async () => ({
        kind: 'targets',
        targets: [{ kind: 'host', pr: 101, roundId: 'r1' as never, rebaseOnly: [] }],
      }),
      renderHostComment: async () => ({ kind: 'body', body: '<!-- conductor:routed-fix:r1:101 -->\nReviewer update.' }),
    });

    expect(hostComments).toEqual(['pull-request.comment.create:101']);
    expect(await git(subject.origin, 'rev-parse', `refs/heads/feat/c1/${slug}`)).toBe(recordedHostTip);
    expect(await git(subject.origin, 'rev-parse', `refs/heads/feat/daemon-${slug}`))
      .toBe(await git(subject.repo, 'rev-parse', `feat/daemon-${slug}`));
  });

  it('marks the reopened completion processed, enrolls its watch, and keeps it out of the next backlog scan', async () => {
    const subject = await fixture();
    const runFeature = makeRunFeature({
      createWorktree: async () => ({ path: subject.repo, branch: `feat/daemon-${slug}`, wasExisting: true }),
      runConductor: async () => undefined,
      readOutcome: async () => ({ done: true, halted: false, finishChoice: 'pr' as const, prUrl }),
      shipmentEvidence: async () => ({ kind: 'valid' as const, slug, pr: prUrl, recordPath: `.docs/shipped/${slug}.md`, hash: 'test', commit: 'test' }),
      teardownWorktree: async () => undefined,
      markProcessed: async (processedSlug, processedPr) => {
        await mkdir(join(subject.repo, '.daemon', 'processed'), { recursive: true });
        await writeFile(join(subject.repo, '.daemon', 'processed', processedSlug), `${JSON.stringify({ status: 'shipped', prUrl: processedPr ?? null })}\n`);
      },
      daemon: true,
      project: 'demo',
      projectRoot: subject.repo,
      sweepMergeableLabels: async () => undefined,
    });

    await expect(runFeature({ slug })).resolves.toMatchObject({ status: 'done', prUrl });
    await expect(readFile(join(subject.repo, '.daemon', 'processed', slug), 'utf8'))
      .resolves.toContain(prUrl);
    await expect(readFile(join(subject.repo, '.daemon', 'mergeable-watch.jsonl'), 'utf8'))
      .resolves.toContain(`\"slug\":\"${slug}\"`);

    const scan = await discoverBacklog(subject.repo, (candidate) => isProcessed(subject.repo, candidate), undefined, {
      treeSource: {
        listPlanFiles: async () => [`${slug}.md`],
        listShippedFiles: async () => [],
        listAdrFiles: async () => [],
        readFile: async (path) => {
          if (path === `.docs/plans/${slug}.md`) return `# Plan\n**Stories:** .docs/stories/${slug}.md\n### Task 1\n**Dependencies:** none\n`;
          if (path === `.docs/stories/${slug}.md`) return '# Stories\n**Status:** Accepted\n';
          if (path === `.docs/coherence/${slug}.md`) return '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n|---|---|---|---|---|\n| story | S1 | Task 1 | covered | fixture |\n';
          return null;
        },
      },
      isPublishedFeatureReopened: async () => false,
    });
    expect(scan.items).toEqual([]);
  });
});
