// Covers: task:16, task:rem-prd-audit-R3, task:rem-prd-audit-R3-2
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunOptions } from '../../src/engine/conductor.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { writeState } from '../../src/engine/state.js';
import type { GithubMutationExecutionContext, GhRunner } from '../../src/engine/tracker-client.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;
const repository = 'acme/demo';

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8')),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface PullRequest {
  readonly number: number;
  readonly branch: string;
  readonly url: string;
  base: string;
  draft: boolean;
  body: string;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'conductor-finish-stacked-'));
  roots.push(root);
  const git = makeGitRunner(root);
  const origin = join(root, 'origin.git');
  const run = (args: string[], options?: Parameters<GitRunner>[1]) => git(args, options);
  const commit = async (message: string, path: string, contents: string) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
    await run(['add', path]);
    await run(['commit', '-qm', message]);
    return (await run(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'finish@example.invalid']);
  await run(['config', 'user.name', 'FINISH fixture']);
  await commit('fixture', '.docs/intake/demo.md', 'Owner: alice\n');
  await commit('plan', '.docs/plans/demo.md', '# demo\n');
  await commit('story', '.docs/stories/demo.md', '## Story S1: One\n\n## Story S3: Three\n');

  await run(['checkout', '-qb', 'feat/c1/demo']);
  const c1Tip = await commit('child one', 'src/one.ts', 'export const one = 1;\n');
  await run(['update-ref', 'refs/conductor/demo/closed/c1', c1Tip]);
  await run(['checkout', '-qb', 'feat/c3/demo']);
  const c3Tip = await commit('child three', 'src/three.ts', 'export const three = 3;\n');
  await run(['update-ref', 'refs/conductor/demo/closed/c3', c3Tip]);
  await run(['checkout', '-qb', 'feat/daemon-demo']);
  const leafTip = await commit('leaf', 'src/leaf.ts', 'export const leaf = 5;\n');
  await run(['init', '--bare', '-b', 'main', '-q', origin]);
  await run(['remote', 'add', 'origin', origin]);
  // FINISH-time publication uses a lease because rebase may have rewritten a
  // branch it already published. Seed that lease baseline as the real daemon
  // does before this FINISH dispatch.
  await run(['push', '-u', 'origin', 'HEAD:refs/heads/feat/daemon-demo']);
  await run(['update-ref', 'refs/conductor/demo/pushed/feat/daemon-demo', leafTip]);

  const positions = await run(['hash-object', '-w', '--stdin'], { input: JSON.stringify([c1, c3, c5]) });
  await run(['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
  await writeCoverageBindingEnvelope(root, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { one: c1, three: c3, leaf: c5 }, titles: ['One', 'Three', 'Leaf'] },
    storyOwnership: { S1: c1, S3: c3, S5: c5 },
  }, envelopeFilesystem);

  const pipeline = join(root, '.pipeline');
  const statePath = join(pipeline, 'conduct-state.json');
  const state: ConductState = {
    feature_desc: 'demo', worktree_branch: 'feat/daemon-demo',
    build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
  };
  await writeState(statePath, state);

  return { root, origin, git: run, state, statePath, tips: new Map([
    ['feat/c1/demo', c1Tip], ['feat/c3/demo', c3Tip], ['feat/daemon-demo', leafTip],
  ]) };
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository, defaultBranch: 'main', specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/intake/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/intake/demo.md', content: 'Owner: alice\n' }],
      },
    },
  };
}

describe('conductor FINISH dispatch for a three-member stack', () => {
  it('advances establish_pr through record_outcome with target-bound mutation policy runners', async () => {
    const subject = await fixture();
    const ghArgv: string[][] = [];
    const gitArgv: string[][] = [];
    const pushes: string[][] = [];
    const prs = new Map<string, PullRequest>();
    let nativeStack: { number: number; pull_requests: { number: number; head: { sha: string } }[] } | undefined;

    const gh: GhRunner = async (args) => {
      ghArgv.push([...args]);
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '' };
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
      if (args[0] === 'pr' && args[1] === 'list') {
        const branch = args[args.indexOf('--head') + 1]!;
        const pr = prs.get(branch);
        return { stdout: JSON.stringify(pr === undefined ? [] : [{
          number: pr.number, isDraft: pr.draft, state: 'OPEN', baseRefName: pr.base,
        }]) };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        const branch = args[args.indexOf('--head') + 1]!;
        const base = args[args.indexOf('--base') + 1]!;
        const number = branch === 'feat/c1/demo' ? 101 : branch === 'feat/c3/demo' ? 103 : 500;
        const url = `https://github.com/${repository}/pull/${number}`;
        prs.set(branch, { number, branch, url, base, draft: true, body: 'Reader-facing summary.' });
        return { stdout: branch === 'feat/daemon-demo' ? `${url}\n` : '' };
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        const selector = args[2]!;
        const pr = [...prs.values()].find((candidate) => candidate.url === selector || candidate.branch === selector || String(candidate.number) === selector);
        if (!pr) throw new Error(`PR is not available: ${args.join(' ')}`);
        const head = subject.tips.get(pr.branch)!;
        return { stdout: JSON.stringify({
          url: pr.url, state: 'OPEN', title: 'feat: demo', body: pr.body, isDraft: pr.draft, labels: [],
          baseRefName: pr.base, headRefOid: head,
        }) };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        const pr = [...prs.values()].find((candidate) => candidate.number === Number(args[2]));
        if (!pr) throw new Error(`unknown ready target: ${args.join(' ')}`);
        pr.draft = args.includes('--undo');
        return { stdout: '' };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const pr = [...prs.values()].find((candidate) => candidate.number === Number(args[2]));
        if (!pr) throw new Error(`unknown edit target: ${args.join(' ')}`);
        const base = args.indexOf('--base');
        const body = args.indexOf('--body');
        if (base >= 0) pr.base = args[base + 1]!;
        if (body >= 0) pr.body = args[body + 1]!;
        return { stdout: '' };
      }
      if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
        return { stdout: JSON.stringify(nativeStack === undefined ? [] : [nativeStack]) };
      }
      if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST' && args[3] === `repos/${repository}/stacks`) {
        const numbers = args.filter((value) => value.startsWith('pull_requests[]=')).map((value) => Number(value.slice('pull_requests[]='.length)));
        nativeStack = { number: 44, pull_requests: numbers.map((number) => {
          const pr = [...prs.values()].find((candidate) => candidate.number === number)!;
          return { number, head: { sha: subject.tips.get(pr.branch)! } };
        }) };
        return { stdout: JSON.stringify(nativeStack) };
      }
      throw new Error(`unexpected gh argv: ${args.join(' ')}`);
    };

    const git: GitRunner = async (args, options) => {
      gitArgv.push([...args]);
      // The real bare origin supplies local Git semantics; FINISH's guarded
      // GitHub policy needs the canonical repository identity that production
      // obtains from an HTTPS origin URL.
      if (args.join(' ') === 'config --get remote.origin.url') {
        return { stdout: `https://github.com/${repository}.git\n`, stderr: '', exitCode: 0 };
      }
      return subject.git(args, options);
    };
    const remoteGit = async (args: readonly string[], _options: Parameters<NonNullable<Parameters<typeof createProductionFinishPublicationCoordinator>[0]['remoteGit']>>[1]) => {
      pushes.push([...args]);
      await subject.git([...args]);
      const ref = args.find((value) => value.includes(':refs/heads/'))!.split(':').at(-1)!;
      const branch = ref.slice('refs/heads/'.length);
      const source = args.find((value) => value.includes(':refs/heads/'))!.split(':')[0]!;
      const tip = source === 'HEAD' ? (await subject.git(['rev-parse', 'HEAD'])).stdout.trim() : source;
      await subject.git(['update-ref', `refs/conductor/demo/pushed/${branch}`, tip]);
      return {
        kind: 'executed' as const,
        targets: [{ operation: 'remote-ref.push' as const, repository, kind: 'remote-ref' as const, ref, endpoint: 'https' as const }],
      };
    };

    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: subject.root,
      stateFilePath: subject.statePath,
      baseBranch: 'main',
      git,
      gh,
      remoteMutation: mutation(),
      remoteGit,
      observeReleaseReadiness: async () => 'present',
      writeShippedRecord: async () => {
        await mkdir(join(subject.root, '.docs', 'shipped'), { recursive: true });
        await writeFile(join(subject.root, '.docs', 'shipped', 'demo.md'), '---\nslug: demo\n---\n');
        return 0;
      },
      recordFinish: async () => {
        await writeFile(join(subject.root, '.pipeline', 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const runner = { run: vi.fn(async () => ({ success: true, publicationDisposition: { kind: 'accepted' } })) };
    const events = new ConductorEventEmitter();
    const started: string[] = [];
    events.on('finish_publication_transition', ((event: { phase: string; transition: string }) => {
      if (event.phase === 'started') started.push(event.transition);
    }) as never);
    const conductor = new Conductor({
      stateFilePath: subject.statePath, projectRoot: subject.root, daemon: true, mode: 'auto',
      stepRunner: runner, finishPublication: coordinator, events,
    });
    const dispatch = conductor as unknown as {
      runFinishPublication(state: ConductState, options: StepRunOptions): Promise<{ success: boolean; publicationDisposition?: { kind: string; transition?: string } }>;
    };

    let completed = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await dispatch.runFinishPublication(subject.state, { attempt, retryReason: undefined, escalate: false });
      if (result.success) {
        completed = true;
        break;
      }
    }

    expect(completed).toBe(true);
    expect(started).toEqual([
      'establish_pr', 'establish_child_prs', 'judge_pr_prose', 'write_shipped_record',
      'assemble_stack', 'judge_pr_prose', 'ready_pr', 'record_outcome',
    ]);
    expect(pushes.map((args) => args.find((value) => value.includes(':refs/heads/')))).toEqual([
      expect.stringMatching(/HEAD:refs\/heads\/feat\/daemon-demo$/),
      expect.stringMatching(/:refs\/heads\/feat\/c1\/demo$/),
      expect.stringMatching(/:refs\/heads\/feat\/c3\/demo$/),
    ]);
    expect(ghArgv.filter((args) => args[0] === 'pr' && args[1] === 'create').map((args) => [
      args[args.indexOf('--head') + 1], args[args.indexOf('--base') + 1],
    ])).toEqual([
      ['feat/daemon-demo', 'main'], ['feat/c1/demo', 'main'], ['feat/c3/demo', 'feat/c1/demo'],
    ]);
    expect(ghArgv.filter((args) => args[0] === 'pr' && args[1] === 'edit' && args.includes('--base')))
      .toHaveLength(1);
    expect(ghArgv.find((args) => args[0] === 'api' && args[3] === `repos/${repository}/stacks`))
      .toEqual(expect.arrayContaining(['pull_requests[]=101', 'pull_requests[]=103', 'pull_requests[]=500']));
    expect(ghArgv.filter((args) => args[0] === 'pr' && args[1] === 'ready' && !args.includes('--undo')).map((args) => args[2]))
      .toEqual(['500', '103', '101']);
    for (const args of ghArgv) {
      expect(args.join(' ')).not.toMatch(/\bmerge(?:-async)?\b|auto-merge|ruleset/);
    }
    for (const args of [...gitArgv, ...pushes]) {
      if (args.includes('--force')) expect(args.join(' ')).toMatch(/--force-with-lease=refs\/heads\/[^:]+:[0-9a-f]{40}/);
    }
  });
});
