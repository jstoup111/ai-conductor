/**
 * Covers: Story 5, Task 22
 *
 * This keeps the local-Git/worktree/pipeline boundaries real while replacing
 * only provider and GitHub calls.  It is intentionally one N=2 scenario: the
 * assertions are about isolation between two concurrently live executors.
 */
import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { runDaemon, type BacklogItem } from '../../src/engine/daemon.js';
import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { makeRunFeature, terminateFeature } from '../../src/engine/daemon-runner.js';
import { writeAutoPark } from '../../src/engine/park-marker.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { acquireScratchHome, sweepFeatureWorktreeScratch } from '../../src/engine/self-host/provider-scratch.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function initRepo(): Promise<{ root: string; git: (...args: string[]) => Promise<string> }> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-concurrency-isolation-'));
  roots.push(root);
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd: root });
    return stdout.trim();
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'README.md'), 'tracked root content\n');
  await writeFile(join(root, '.gitignore'), '.daemon/\n.worktrees/\n.env\n');
  await git('add', 'README.md', '.gitignore');
  await git('commit', '-q', '-m', 'fixture');
  await writeFile(join(root, 'operator-note.txt'), 'untracked root content\n');
  return { root, git };
}

async function rootSnapshot(root: string, git: (...args: string[]) => Promise<string>): Promise<{
  readonly status: string;
  readonly tracked: string;
  readonly staged: string;
  readonly untracked: Readonly<Record<string, string>>;
}> {
  const untracked = (await git('ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean);
  return {
    status: await git('status', '--porcelain=v1', '--untracked-files=all'),
    tracked: await git('diff', '--binary'),
    staged: await git('diff', '--cached', '--binary'),
    untracked: Object.fromEntries(await Promise.all(untracked.map(async (path) => [path, await readFile(join(root, path), 'utf8')]))),
  };
}

async function writeFeaturePipeline(
  worktree: string,
  slug: string,
  events: ConductorEventEmitter,
  prUrl?: string,
): Promise<void> {
  const pipeline = join(worktree, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  await writeFile(join(pipeline, 'conduct-state.json'), `${JSON.stringify({ feature_desc: slug, ...(prUrl ? { pr_url: prUrl } : {}) })}\n`);
  await writeFile(join(pipeline, 'task-status.json'), `${JSON.stringify({ tasks: [{ id: slug, status: 'completed', files: [] }] })}\n`);
  await writeFile(join(pipeline, 'task-evidence.json'), `${JSON.stringify({ evidenceStamps: { [slug]: { sha: slug, form: 'fake-provider' } }, noEvidenceAttempts: 0, noEvidenceReasons: [], migrationGrandfather: [], lastResolvedCount: 1 })}\n`);
  await events.emit({ type: 'feature_complete', featureDesc: slug, ...(prUrl ? { prUrl } : {}) });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('daemon N=2 worktree isolation', () => {
  it('keeps pipeline state, root state, parks, HALTs, and live scratch leases feature-local', async () => {
    const { root, git } = await initRepo();
    const before = await rootSnapshot(root, git);
    const alpha = 'alpha-completes';
    const beta = 'beta-parks';
    const globalEvents = new ConductorEventEmitter();
    const bothProvidersLive = deferred<void>();
    const betaHalted = deferred<void>();
    let liveProviders = 0;
    let sweepRan = false;
    const scratchHomes = new Map<string, string>();

    // The provider is a faithful local fake: no provider process, network, or
    // credential boundary is reached by this integration proof.
    const fakeProvider: LLMProvider = {
      invoke: async () => ({ success: true, output: 'fake provider completed', exitCode: 0 }),
    };
    const deps = makeFeatureRunnerDeps({
      projectRoot: root,
      worktreeBase: join(root, '.worktrees'),
      baseBranch: 'main',
      provider: fakeProvider,
      beginFeatureRun: (worktree) => {
        const scope = startFeatureEventPersistence(worktree.path, globalEvents);
        return {
          ...scope,
          providerExecution: {} as ProviderExecutionContext,
          stop: scope.stop,
        };
      },
      runConductorInWorktree: async (worktree, item, _provider, events) => {
        if (!events) throw new Error('feature event scope was not created');
        await writeFeaturePipeline(
          worktree.path,
          item.slug,
          events,
          item.slug === alpha ? 'https://example.test/pull/alpha' : undefined,
        );
        const home = await acquireScratchHome({
          worktreeRoot: worktree.path,
          repository: 'owner/repository',
          featureSlug: item.slug,
          runId: 'N2',
          attempt: 1,
          provider: 'codex',
        });
        scratchHomes.set(item.slug, home);
        liveProviders += 1;
        if (liveProviders === 2) bothProvidersLive.resolve();
        await bothProvidersLive.promise;

        if (!sweepRan) {
          sweepRan = true;
          await sweepFeatureWorktreeScratch({
            worktreeBase: join(root, '.worktrees'),
            events: globalEvents,
            log: () => {},
          });
          await Promise.all([...scratchHomes.values()].map(async (path) => {
            expect(await exists(path)).toBe(true);
          }));
        }

        if (item.slug === beta) {
          await terminateFeature({
            worktreePath: worktree.path,
            projectRoot: root,
            slug: beta,
            park: true,
            reason: 'fake provider requested human intervention',
            events,
          });
          await writeAutoPark(root, beta, 'fake provider requested human intervention');
          betaHalted.resolve();
          return;
        }

        await betaHalted.promise;
        await writeFile(join(worktree.path, '.pipeline', 'finish-choice'), 'pr\n');
        await writeFile(join(worktree.path, '.pipeline', 'DONE'), 'done\n');
      },
    });
    const runFeature = makeRunFeature({
      ...deps,
      shipmentEvidence: async () => ({
        kind: 'valid', slug: alpha, pr: 'https://example.test/pull/alpha', recordPath: '.docs/shipped/alpha.md', hash: 'fake', commit: 'fake',
      }),
      cleanupHaltPresentation: async () => 'confirmed',
      enrollWatch: async () => {},
      sweepMergeableLabels: async () => {},
    });
    const backlog: BacklogItem[] = [{ slug: alpha, track: 'technical' }, { slug: beta, track: 'technical' }];

    const result = await runDaemon({
      discoverBacklog: async () => backlog,
      runFeature,
      sleep: async () => { await waitForImmediate(); },
    }, { concurrency: 2, once: true, idlePollMs: 0 });

    const alphaWorktree = join(root, '.worktrees', alpha);
    const betaWorktree = join(root, '.worktrees', beta);
    const alphaPipeline = await Promise.all([
      readFile(join(alphaWorktree, '.pipeline', 'task-status.json'), 'utf8'),
      readFile(join(alphaWorktree, '.pipeline', 'task-evidence.json'), 'utf8'),
      readFile(join(alphaWorktree, '.pipeline', 'events.jsonl'), 'utf8'),
    ]);
    const betaPipeline = await Promise.all([
      readFile(join(betaWorktree, '.pipeline', 'task-status.json'), 'utf8'),
      readFile(join(betaWorktree, '.pipeline', 'task-evidence.json'), 'utf8'),
      readFile(join(betaWorktree, '.pipeline', 'events.jsonl'), 'utf8'),
    ]);

    expect(result.processed.map((outcome) => ({ slug: outcome.slug, status: outcome.status })).sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: alpha, status: 'done' },
      { slug: beta, status: 'halted' },
    ]);
    expect(alphaPipeline.join('\n')).toContain(alpha);
    expect(alphaPipeline.join('\n')).not.toContain(beta);
    expect(betaPipeline.join('\n')).toContain(beta);
    expect(betaPipeline.join('\n')).not.toContain(alpha);
    expect(await rootSnapshot(root, git)).toEqual(before);
    expect(await readFile(join(root, '.daemon', 'parked', beta), 'utf8')).toMatch(/^auto-parked:/);
    expect(await exists(join(betaWorktree, '.daemon', 'parked', beta))).toBe(false);
    expect(await exists(join(betaWorktree, '.pipeline', 'HALT'))).toBe(true);
    expect(await exists(join(alphaWorktree, '.pipeline', 'HALT'))).toBe(false);
  });
});
