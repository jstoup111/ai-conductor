/**
 * RED acceptance coverage for jstoup111/ai-conductor#1682.
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Story 1 crosses source-input assembly, counterfactual checkout creation,
 *   the real scoped-command process, projection, provider dispatch, and join.
 * - Story 4 crosses that same process boundary, preflight settlement, the
 *   rubric coordinator, and the persisted event spine.
 * - Story 2's closed unions/process classifications and Story 3's judging
 *   prose are single-boundary contracts owned by the plan's lower-layer tests.
 *
 * Production call sites exercised:
 * - src/engine/step-runners.ts: DefaultStepRunner.run('build_review')
 * - src/engine/step-runners.ts: runScopedTautologyCommand
 * - src/engine/build-review-tautology-preflight.ts: materializeTautologyPreflight
 * - src/engine/build-review-coordinator.ts: coordinateBuildReviewRubrics
 * - src/engine/event-persister.ts: EventPersister
 *
 * The LLM boundary is replaced by a deterministic provider fake. Git and the
 * local scoped shell process are real because their semantics are under test.
 *
 * Verify-claims: every asserted classification, run kind, event field, and
 * terminal outcome is stated by the accepted stories and approved ADR. No
 * unconfirmed load-bearing assumption is encoded here.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventPersister } from '../../src/engine/event-persister.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const execFile = promisify(execFileCallback);
const PLAN_PATH = '.docs/plans/feature.md';
const FEATURE_PATH = 'src/example.ts';
const SPEC_PATH = 'spec/example_spec.rb';
const scratchRoots: string[] = [];

interface Fixture {
  root: string;
  head: string;
  planPath: string;
}

interface TautologyProjection {
  rubric: 'tautology';
  lapId: string;
  snapshotDigest: string;
  preflightEvidence: {
    classification: string;
    scopedRun?: {
      runKind: string;
      failureExcerpt: string;
      ranSelectors: readonly string[];
    };
  };
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: root });
  return stdout.trim();
}

async function writeRepoFile(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function makeFixture(name: string): Promise<Fixture> {
  const repository = await mkdtemp(join(tmpdir(), 'rspec-tautology-acceptance-'));
  scratchRoots.push(repository);

  await git(repository, 'init', '-q', '-b', 'main');
  await git(repository, 'config', 'user.email', 'acceptance@example.test');
  await git(repository, 'config', 'user.name', 'Acceptance Test');
  await git(repository, 'config', 'commit.gpgsign', 'false');
  await writeRepoFile(repository, '.gitignore', '.pipeline/\n');
  await writeRepoFile(repository, PLAN_PATH, [
    '# Approved plan',
    '',
    '### Task 1: change behavior with distinguishing coverage',
    `- Update \`${FEATURE_PATH}\`.`,
    `- Add a distinguishing example in \`${SPEC_PATH}\`.`,
    '',
  ].join('\n'));
  await writeRepoFile(repository, FEATURE_PATH, 'export const answer = 1;\n');
  await writeRepoFile(repository, SPEC_PATH, 'RSpec.describe("answer") { it { expect(1).to eq(1) } }\n');
  await git(repository, 'add', '.');
  await git(repository, 'commit', '-q', '-m', 'base behavior');

  await git(repository, 'remote', 'add', 'origin', repository);
  await git(repository, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(repository, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  const root = join(repository, '.worktrees', name);
  await mkdir(dirname(root), { recursive: true });
  await git(repository, 'worktree', 'add', '-q', '-b', `feature/${name}`, root);
  await writeRepoFile(root, FEATURE_PATH, 'export const answer = 2;\n');
  await writeRepoFile(root, SPEC_PATH, 'RSpec.describe("answer") { it { expect(2).to eq(2) } }\n');
  await git(root, 'add', FEATURE_PATH, SPEC_PATH);
  await git(root, 'commit', '-q', '-m', 'change behavior and its example');

  return {
    root,
    head: await git(root, 'rev-parse', 'HEAD'),
    planPath: join(root, PLAN_PATH),
  };
}

function currentProof(head: string) {
  return {
    inspectTestSuite: async () => ({
      status: 'CURRENT',
      evidence: { provenanceHeadSha: head, outcome: 'PASS', fingerprint: 'current-green-proof' },
    } as never),
  };
}

function tautologyOnlyConfig(scopedCommand: string): HarnessConfig {
  return {
    test_suite: { scoped_command: scopedCommand },
    build_review: {
      enabled: true,
      perTaskFloor: false,
      rubrics: {
        tautology: { enabled: true },
        scope: { enabled: false },
        rootCause: { enabled: false },
        completeness: { enabled: false },
      },
    },
  } as HarnessConfig;
}

function judgedProvider(observed: TautologyProjection[]): LLMProvider {
  return {
    invoke: vi.fn(async (options) => {
      const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as TautologyProjection;
      observed.push(projection);
      return {
        success: true,
        output: JSON.stringify({
          kind: 'judged',
          rubric: projection.rubric,
          lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest,
          contractVersion: 'v1',
          findings: [],
        }),
        exitCode: 0,
      };
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

describe('acceptance: RSpec counterfactuals always settle the Tautology rubric (#1682)', () => {
  it('classifies an RSpec failure by non-zero exit and returns a judged verdict', async () => {
    const fixture = await makeFixture('rspec-verdict');
    const projections: TautologyProjection[] = [];
    const provider = judgedProvider(projections);
    const runner = new DefaultStepRunner(provider, 'acceptance-maker', fixture.root, {
      config: tautologyOnlyConfig("printf '2 examples, 1 failure\\n'; exit 1"),
      planPath: fixture.planPath,
      pipelineDir: join(fixture.root, '.pipeline'),
      buildReviewInputOptions: currentProof(fixture.head),
    });

    const result = await runner.run('build_review', {
      complexity_tier: 'S',
      feature_desc: 'rspec-verdict',
      track: 'technical',
    });

    expect(result.success, result.output).toBe(true);
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(projections).toHaveLength(1);
    expect(projections[0]!.preflightEvidence).toMatchObject({
      classification: 'red',
      scopedRun: {
        runKind: 'nonzero-exit',
        ranSelectors: [SPEC_PATH],
      },
    });
    expect(projections[0]!.preflightEvidence.scopedRun?.failureExcerpt).toContain(
      '2 examples, 1 failure',
    );

    const aggregate = JSON.parse(
      await readFile(join(fixture.root, '.pipeline', 'build-review.json'), 'utf8'),
    ) as { verdict: string; results: { tautology: { kind: string } } };
    expect(aggregate).toMatchObject({
      verdict: 'PASS',
      results: { tautology: { kind: 'judged' } },
    });
  });

  it('persists signaled scoped-run output on the existing infrastructure event', async () => {
    const fixture = await makeFixture('signal-evidence');
    const provider = judgedProvider([]);
    const events = new ConductorEventEmitter();
    const eventsPath = join(fixture.root, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    const runner = new DefaultStepRunner(provider, 'acceptance-maker', fixture.root, {
      config: tautologyOnlyConfig("printf 'RSpec worker terminated after selecting example\\n' >&2; kill -TERM $$"),
      events,
      planPath: fixture.planPath,
      pipelineDir: join(fixture.root, '.pipeline'),
      buildReviewInputOptions: currentProof(fixture.head),
    });

    let result;
    try {
      result = await runner.run('build_review', {
        complexity_tier: 'S',
        feature_desc: 'signal-evidence',
        track: 'technical',
      });
    } finally {
      persister.stop();
    }

    expect(result.success).toBe(false);
    expect(provider.invoke).not.toHaveBeenCalled();
    const ledger = (await readFile(eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(ledger).toContainEqual(expect.objectContaining({
      type: 'build_review_rubric_infrastructure_failure',
      rubric: 'tautology',
      reason: 'scoped-run-signaled',
      failureExcerpt: expect.stringContaining('RSpec worker terminated after selecting example'),
    }));
  });
});
