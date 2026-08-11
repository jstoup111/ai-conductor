/**
 * Acceptance specs for jstoup111/ai-conductor#1229.
 *
 * Stories: `.docs/stories/manual-rebase-strands-protected-artifact-seal.md`
 * Plan:    `.docs/plans/manual-rebase-strands-protected-artifact-seal.md`
 *
 * These specs drive the two production call sites that own the multi-step
 * stories: Conductor's BUILD dispatch guard and its engine-managed rebase step.
 * Real local Git repositories supply the merge-base, ancestry, and path-diff
 * semantics. There are no third-party calls.
 *
 * Production derivation call sites covered (writing-system-tests §3d):
 * - `src/conductor/src/engine/conductor.ts`: BUILD/SHIP dispatch guard calls
 *   `verifyProtectedArtifactSeal` with the real repository state.
 * - `src/conductor/src/engine/rebase.ts`: an engine-managed rebase calls
 *   `translateAfterRebase`, which records protected paths and rotates the seal.
 *
 * Field names for the additive provenance payload are intentionally not pinned
 * by the accepted stories or ADR. Assertions therefore inspect new payload
 * values beyond the prior event shape and require the observable evidence,
 * without inventing a schema spelling for BUILD to implement.
 */

import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import {
  createProtectedArtifactSeal,
  PROTECTED_ARTIFACT_SEAL_PATH,
} from '../../src/engine/protected-artifact-seal.js';
import { HALT_CLASS_MARKER, HALT_MARKER } from '../../src/engine/halt-marker.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductState, ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCb);
const indeterminateMergeTreeRepos = vi.hoisted(() => new Set<string>());

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: (...args: any[]) => {
      const [command, gitArgs, options] = args;
      if (
        command === 'git'
        && Array.isArray(gitArgs)
        && gitArgs[0] === 'merge-tree'
        && indeterminateMergeTreeRepos.has(String(options?.cwd ?? ''))
      ) {
        return Promise.resolve({
          exitCode: 128,
          stdout: '',
          stderr: 'fixture: prospective merge assessment unavailable',
        }) as unknown as ReturnType<typeof actual.execa>;
      }
      return (actual.execa as (...argv: any[]) => ReturnType<typeof actual.execa>)(...args);
    },
  };
});

const FEATURE = 'manual-rebase-strands-protected-artifact-seal';
const OTHER_PLAN = '.docs/plans/other-feature.md';
const BASE_AHEAD_DECISION = '.docs/decisions/base-ahead-decision.md';
const OWN_STORY = `.docs/stories/${FEATURE}.md`;

interface Scratch {
  repo: string;
  origin: string;
  g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

interface SealFile {
  baselineCommit: string;
  protectedArtifacts: { path: string; fingerprint: string }[];
  rebaselines: { fromCommit: string; toCommit: string; trigger: string; paths: string[] }[];
}

type CapturedEvent = ConductorEvent & Record<string, unknown>;

const scratches: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (scratches.length > 0) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

async function writeRepoFile(repo: string, path: string, content: string): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

async function pathExists(path: string): Promise<boolean> {
  return readFile(path, 'utf8').then(
    () => true,
    () => false,
  );
}

async function makeFeatureRepo(): Promise<Scratch> {
  const origin = await mkdtemp(join(tmpdir(), 'seal-1229-origin-'));
  scratches.push(origin);
  await execFile('git', ['init', '-q', '--bare', '-b', 'main', origin]);

  const repo = await mkdtemp(join(tmpdir(), 'seal-1229-'));
  scratches.push(repo);
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 'acceptance@example.com']);
  await g(['config', 'user.name', 'Acceptance Fixture']);
  await g(['config', 'commit.gpgsign', 'false']);
  await g(['remote', 'add', 'origin', origin]);
  await writeRepoFile(repo, '.gitignore', '.pipeline/\nconduct-state.json\n');
  await writeRepoFile(repo, 'base.ts', 'base\n');
  await writeRepoFile(repo, OTHER_PLAN, 'approved plan\n');
  await writeRepoFile(repo, OWN_STORY, 'accepted story\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'approved DECIDE artifacts']);
  await g(['push', '-q', 'origin', 'main']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeRepoFile(repo, 'src/feature.ts', 'feature work\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feat: implementation']);
  return { repo, origin, g };
}

async function head(scratch: Scratch): Promise<string> {
  return (await scratch.g(['rev-parse', 'HEAD'])).stdout.trim();
}

async function advanceMain(
  scratch: Scratch,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  await scratch.g(['checkout', '-q', 'main']);
  for (const [path, content] of Object.entries(files)) {
    await writeRepoFile(scratch.repo, path, content);
  }
  await scratch.g(['add', '-A']);
  await scratch.g(['commit', '-q', '-m', message]);
  const commit = await head(scratch);
  await scratch.g(['push', '-q', 'origin', 'main']);
  await scratch.g(['fetch', '-q', 'origin']);
  await scratch.g(['checkout', '-q', 'feat']);
  return commit;
}

async function readSeal(repo: string): Promise<SealFile> {
  return JSON.parse(
    await readFile(join(repo, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'),
  ) as SealFile;
}

function captureEvents(events: ConductorEventEmitter): CapturedEvent[] {
  const seen: CapturedEvent[] = [];
  const original = events.emit.bind(events);
  vi.spyOn(events, 'emit').mockImplementation(async (event) => {
    seen.push(event as unknown as CapturedEvent);
    return original(event);
  });
  return seen;
}

interface RunResult {
  dispatched: string[];
  events: CapturedEvent[];
  logLines: string[];
}

async function runBuildGuard(repo: string, maxRetries = 1): Promise<RunResult> {
  const statePath = join(repo, 'conduct-state.json');
  await writeState(statePath, { plan: 'done', feature_desc: FEATURE } as ConductState);
  const emitter = new ConductorEventEmitter();
  const events = captureEvents(emitter);
  const dispatched: string[] = [];
  const logLines: string[] = [];
  const runner: StepRunner = {
    run: async (step) => {
      dispatched.push(step);
      return { success: false, output: 'expected acceptance stop after BUILD dispatch' } satisfies StepRunResult;
    },
  };
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events: emitter,
    projectRoot: repo,
    log: (line: string) => logLines.push(line),
    config: {} as never,
    fromStep: 'build',
    mode: 'default',
    maxRetries,
    baseBranch: 'main',
  } as never);
  await conductor.run();
  return { dispatched, events, logLines };
}

async function seedPreRebaseState(statePath: string): Promise<void> {
  const state: ConductState = { feature_desc: FEATURE } as ConductState;
  for (const step of ALL_STEPS) {
    if (step.name === 'rebase') break;
    (state as Record<string, unknown>)[step.name] = step.name === 'retro' ? 'skipped' : 'done';
  }
  state.finish = 'done';
  await writeState(statePath, state);
}

async function runRebaseStep(repo: string): Promise<RunResult> {
  const statePath = join(repo, 'conduct-state.json');
  await seedPreRebaseState(statePath);
  const emitter = new ConductorEventEmitter();
  const events = captureEvents(emitter);
  const dispatched: string[] = [];
  const logLines: string[] = [];
  const runner: StepRunner = {
    run: async (step) => {
      dispatched.push(step);
      return { success: true } satisfies StepRunResult;
    },
  };
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events: emitter,
    projectRoot: repo,
    log: (line: string) => logLines.push(line),
    daemon: true,
    mode: 'auto',
    fromStep: 'rebase',
    baseBranch: 'main',
  } as never);
  indeterminateMergeTreeRepos.add(repo);
  try {
    await conductor.run();
  } finally {
    indeterminateMergeTreeRepos.delete(repo);
  }
  return { dispatched, events, logLines };
}

async function makeStrandedBehindBaseFixture(): Promise<{
  scratch: Scratch;
  strandedBaseline: string;
  postRebaseHead: string;
  mergeBase: string;
}> {
  const scratch = await makeFeatureRepo();
  const strandedBaseline = await head(scratch);
  await createProtectedArtifactSeal({
    projectRoot: scratch.repo,
    baselineCommit: strandedBaseline,
  });

  await advanceMain(scratch, { 'main-only.ts': 'main advance before rebase\n' }, 'main: pre-rebase advance');
  await scratch.g(['rebase', '-q', 'origin/main']);
  const postRebaseHead = await head(scratch);

  await advanceMain(
    scratch,
    { [BASE_AHEAD_DECISION]: 'decision merged after feature rebase\n' },
    'main: add protected decision after feature rebase',
  );
  const mergeBase = (await scratch.g(['merge-base', 'HEAD', 'origin/main'])).stdout.trim();
  return { scratch, strandedBaseline, postRebaseHead, mergeBase };
}

function extraEventValues(
  event: CapturedEvent,
  priorShape: readonly string[],
): unknown[] {
  return Object.entries(event)
    .filter(([key]) => !priorShape.includes(key))
    .map(([, value]) => value);
}

describe('#1229: provenance-based protected-artifact seal rotation', () => {
  it(
    'Stories 1/8: the reported manual-rebase then base-ahead sequence resumes BUILD without a halt and rotates to HEAD',
    async () => {
      const { scratch, strandedBaseline, postRebaseHead } = await makeStrandedBehindBaseFixture();

      const { dispatched, events } = await runBuildGuard(scratch.repo);

      expect(dispatched).toContain('build');
      expect(await pathExists(join(scratch.repo, HALT_MARKER))).toBe(false);
      expect(await pathExists(join(scratch.repo, HALT_CLASS_MARKER))).toBe(false);

      const seal = await readSeal(scratch.repo);
      expect(seal.baselineCommit).toBe(postRebaseHead);
      expect(seal.baselineCommit).not.toBe(strandedBaseline);
      expect(seal.protectedArtifacts.map(({ path }) => path)).not.toContain(BASE_AHEAD_DECISION);
      expect(seal.rebaselines).toHaveLength(1);

      const rotation = events.find(({ type }) => type === 'protected_artifact_rebaseline');
      expect(rotation).toBeDefined();
      expect(JSON.stringify(events)).not.toMatch(/feature-authored/i);
      expect(extraEventValues(
        rotation!,
        ['type', 'trigger', 'fromCommit', 'toCommit', 'paths'],
      )).toContainEqual(expect.arrayContaining([BASE_AHEAD_DECISION]));
    },
    30000,
  );

  it(
    'Story 6: a feature-authored refusal carries merge-base evidence through the existing event and daemon renderer',
    async () => {
      const { scratch, mergeBase } = await makeStrandedBehindBaseFixture();
      await writeRepoFile(scratch.repo, OTHER_PLAN, 'feature-authored edit\n');
      await scratch.g(['add', OTHER_PLAN]);
      await scratch.g(['commit', '-q', '-m', 'feat: edit another feature plan']);

      const { dispatched, events } = await runBuildGuard(scratch.repo, 2);

      expect(dispatched).toEqual([]);
      expect(await pathExists(join(scratch.repo, HALT_MARKER))).toBe(true);
      const refusal = events.find(({ type }) => type === 'protected_artifact_rebaseline_refused');
      expect(refusal).toBeDefined();
      const evidence = extraEventValues(
        refusal!,
        ['type', 'condition', 'verdictCondition', 'path'],
      );
      expect(evidence).toContain(mergeBase);
      expect(evidence).toContain(true);

      const daemonLines: string[] = [];
      renderDaemonEvent(refusal!, (line) => daemonLines.push(line));
      const rendered = daemonLines.find((line) => /seal rebaseline refused/i.test(line));
      expect(rendered).toContain(mergeBase.slice(0, 12));
      expect(rendered).toMatch(/head.*(?:changed|touched)|authored/i);
    },
    30000,
  );

  it(
    'Story 7: an engine-managed rebase records decisions and excludes unprotected paths from its audit entry',
    async () => {
      const scratch = await makeFeatureRepo();
      const baseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: scratch.repo, baselineCommit: baseline });
      await advanceMain(
        scratch,
        {
          [BASE_AHEAD_DECISION]: 'decision advanced by main\n',
          'unprotected.txt': 'not part of the protected audit\n',
        },
        'main: advance protected and unprotected paths',
      );

      await runRebaseStep(scratch.repo);

      const seal = await readSeal(scratch.repo);
      expect(seal.rebaselines).toHaveLength(1);
      expect(seal.rebaselines[0].paths).toEqual([BASE_AHEAD_DECISION]);
      expect(seal.baselineCommit).toBe(await head(scratch));
    },
    30000,
  );
});
