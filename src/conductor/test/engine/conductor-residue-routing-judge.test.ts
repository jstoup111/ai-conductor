// Covers: task:rem-prd-audit-W1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'conductor-residue-routing-judge',
  })),
}));

vi.mock('../../src/engine/routing/route-record-store.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/routing/route-record-store.js')>(),
  nextRoundId: vi.fn(async () => 'r1'),
  createRouteRecord: vi.fn(async (_worktree, _slug, input) => ({
    kind: 'created' as const,
    record: {
      ...input,
      phase: 'prepared' as const,
      hosts: { 1: 'pending' as const },
      currentHostIndex: 0,
      receipt: {},
      outbox: [],
    },
  })),
}));

vi.mock('../../src/engine/routing/round-admission.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/routing/round-admission.js')>(),
  admitRound: vi.fn(async (_worktree, _slug, record) => ({ kind: 'admitted' as const, record })),
}));

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { persistFixtureRemediationPlan } from './remediation-plan-fixtures.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

class ContextBoundResidueRunner implements StepRunner {
  calls = 0;

  constructor(private readonly projectRoot: string) {}

  async run(_step: string, _state: ConductState, options: Parameters<StepRunner['run']>[2]) {
    const request = options?.remediationRequest;
    if (request?.mode !== 'gap-plan' || options.runId === undefined) {
      throw new Error('fixture requires a remediation gap-plan request');
    }
    await persistFixtureRemediationPlan(this.projectRoot, options, {
      version: 'v1',
      dispositions: [{
        reference: { kind: 'stall', id: 'stall:residue' },
        disposition: 'build', category: null,
        rationale: 'Taskless build-stall residue must be placed in the routed round.',
        tasks: [], boundTaskIds: [],
      }],
    });
    return { success: true };
  }

  async dispatchResidueRoutingJudgement(prompt: string) {
    this.calls += 1;
    const request = JSON.parse(prompt.slice(prompt.indexOf('{'))) as {
      items: Array<{ itemId: string }>;
    };
    return {
      success: true,
      output: JSON.stringify({
        version: 'v1',
        items: request.items.map(({ itemId }) => ({
          itemId, child: 1, candidates: [1], rationale: 'The first slice owns this residue.',
        })),
      }),
    };
  }
}

describe('Conductor residue routing judge binding', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-residue-routing-judge-'));
    const planPath = join(projectRoot, '.docs', 'plans', 'feature.md');
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(planPath, '# Implementation plan\n', 'utf8');
    await writeFile(
      join(projectRoot, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
      'utf8',
    );
    await writeCoverageBindingEnvelope(projectRoot, {
      version: 1, slug: 'demo', runId: 'fixture', status: 'done', entries: [],
      sliceMembership: { taskSlices: { first: 1, second: 2 }, titles: ['first', 'second'] },
    }, envelopeFilesystem);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('binds a context-dependent residue judge and routes each residue item without a malformed halt', async () => {
    const runner = new ContextBoundResidueRunner(projectRoot);
    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'build stall requires residue routing',
      { source: 'build_stall', evidence: [{ gate: 'build', evidenceFile: '.pipeline/build-stall-question.md' }] },
    );

    expect(runner.calls, JSON.stringify(outcome)).toBe(1);
    expect(outcome).toMatchObject({ kind: 'route' });
    expect(outcome.detail).toBeUndefined();
  });
});
