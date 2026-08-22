/**
 * Acceptance RED for #1805.
 *
 * The four scenarios below are the cross-gate flows assigned to plan Task 31.
 * Every other happy/negative criterion stays with its named lower-layer task.
 * The real Conductor loop, state, artifacts, compatibility readers, and local
 * filesystem are exercised; the StepRunner and aggregate verifier are faithful
 * fakes for provider/process boundaries.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Conductor,
  type ConductorOptions,
  type StepRunner,
  type StepRunResult,
} from '../../src/engine/conductor.js';
import {
  BuildReviewDispositionStore,
  type BuildReviewFeatureIdentity,
} from '../../src/engine/build-review-dispositions.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];

const MANUAL_TEST_PASS = [
  '# Manual Test',
  '',
  '| Story | Result |',
  '|---|---|',
  '| S1 | PASS |',
  '',
].join('\n');

// The new criterion-grade table and the retained per-FR evidence table are
// both present, matching the approved prd_audit ADR.
const PRD_AUDIT_PASS = [
  '# PRD Audit',
  '',
  '**PRD:** present',
  '',
  '## Verdict Table',
  '',
  '| Criterion | Grade | Plan task | Evidence |',
  '|---|---|---|---|',
  '| S13.1 | PASS | 1 | src/feature.ts:1 |',
  '',
  '## FR Evidence',
  '',
  '| FR | Verdict | Gap-class | Evidence | Accepted? |',
  '|---|---|---|---|---|',
  '| FR-16 | ALIGNED | | src/feature.ts:1 | yes |',
  '| FR-17 | ALIGNED | | src/feature.ts:1 | yes |',
  '',
].join('\n');

const AS_BUILT_APPROVED = '# As-Built Architecture Review\n\nVerdict: APPROVED\n';
const AS_BUILT_PLAN_GAP = [
  '# As-Built Architecture Review',
  '',
  'Verdict: PLAN_GAP',
  'Outcome delivered: yes',
  '',
  '## Recorded Findings',
  '- The code faithfully implements the approved design; the plan is the limit.',
  '',
].join('\n');

interface Fixture {
  root: string;
  pipelineDir: string;
  statePath: string;
  slug: string;
  feature: BuildReviewFeatureIdentity;
}

interface FixtureOptions {
  fromStep: StepName;
  tier: 'S' | 'L';
  track: 'product' | 'technical';
  legacyPlan?: boolean;
  downstream?: Partial<Record<StepName, 'pending' | 'done' | 'skipped'>>;
}

async function seedFixture(options: FixtureOptions): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'one-review-owner-'));
  dirs.push(root);
  const slug = 'one-review-owner';
  const pipelineDir = join(root, '.pipeline');
  const statePath = join(pipelineDir, 'conduct-state.json');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'specs'), { recursive: true });
  await mkdir(pipelineDir, { recursive: true });

  const taskBlocks = options.legacyPlan
    ? [
        '### Task 1: legacy authored task',
        '',
        '**Files:** src/feature.ts',
        '',
        ...Array.from({ length: 5 }, (_, index) => [
          `### Task rem-${index + 1}: pre-change remediation ${index + 1}`,
          '',
          '**Files:** src/feature.ts',
          '',
        ]).flat(),
      ]
    : [
        '### Task 1: implement the accepted behavior',
        '',
        '**Done when:**',
        '- The accepted behavior is observable.',
        '',
        '**Files:** src/feature.ts',
        '',
      ];
  await writeFile(
    join(root, '.docs', 'plans', `${slug}.md`),
    [
      '# Plan',
      '',
      `**Stories:** .docs/stories/${slug}.md`,
      '',
      ...taskBlocks,
    ].join('\n'),
  );
  await writeFile(
    join(root, '.docs', 'stories', `${slug}.md`),
    [
      '**Status:** Accepted',
      '',
      '# Stories',
      '',
      '## Story 1: accepted behavior',
      '',
      '### Acceptance Criteria',
      '',
      '#### Happy Path',
      '- Given the implementation, when it ships, then the outcome is visible.',
      '',
      '#### Negative Paths',
      '- Given missing evidence, when the gate runs, then the feature does not finish.',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(root, '.docs', 'specs', `${slug}.md`),
    [
      '# PRD',
      '',
      '**Status:** Approved',
      '',
      '## Functional Requirements',
      '',
      '- **FR-16:** A delivered plan gap is recorded and ships.',
      '- **FR-17:** No SHIP gate directs unplanned work back to BUILD.',
      '',
    ].join('\n'),
  );
  await writeFile(join(root, 'src-feature.ts'), 'export const delivered = true;\n');
  await writeFile(
    join(pipelineDir, 'task-status.json'),
    JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
  );

  const fromIndex = ALL_STEPS.findIndex((step) => step.name === options.fromStep);
  const state: Record<string, unknown> = {
    feature_desc: slug,
    complexity_tier: options.tier,
    track: options.track,
    run_started_at: Date.now() - 1_000,
  };
  for (const [index, step] of ALL_STEPS.entries()) {
    state[step.name] = index < fromIndex ? 'done' : 'pending';
  }
  Object.assign(state, options.downstream);
  await writeState(statePath, state as ConductState);

  return {
    root,
    pipelineDir,
    statePath,
    slug,
    feature: { version: 'v1', repository: root, feature: slug },
  };
}

interface RunnerOptions {
  prdAudit?: 'pass' | 'missing';
  asBuilt?: 'approved' | 'plan-gap';
}

function fakeRunner(fixture: Fixture, calls: StepName[], options: RunnerOptions = {}): StepRunner {
  return {
    run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
      calls.push(step);
      if (step === 'build') {
        await writeFile(
          join(fixture.pipelineDir, 'task-status.json'),
          JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
        );
      } else if (step === 'manual_test') {
        await writeFile(join(fixture.pipelineDir, 'manual-test-results.md'), MANUAL_TEST_PASS);
      } else if (step === 'prd_audit' && options.prdAudit !== 'missing') {
        await writeFile(join(fixture.pipelineDir, 'prd-audit.md'), PRD_AUDIT_PASS);
      } else if (step === 'architecture_review_as_built') {
        await writeFile(
          join(fixture.pipelineDir, 'architecture-review-as-built.md'),
          options.asBuilt === 'plan-gap' ? AS_BUILT_PLAN_GAP : AS_BUILT_APPROVED,
        );
      } else if (step === 'retro') {
        await mkdir(join(fixture.root, '.docs', 'retros'), { recursive: true });
        await writeFile(join(fixture.root, '.docs', 'retros', `${fixture.slug}.md`), '# Retro\n');
      } else if (step === 'finish') {
        await writeFile(join(fixture.pipelineDir, 'finish-choice'), 'keep\n');
      }
      return { success: true };
    }),
    resetSession: async () => {},
  };
}

async function runFixture(
  fixture: Fixture,
  runner: StepRunner,
  options: Pick<ConductorOptions, 'fromStep' | 'verifyArtifacts' | 'daemon'>,
): Promise<void> {
  const conductor = new Conductor({
    stateFilePath: fixture.statePath,
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: fixture.root,
    mode: 'auto',
    maxRetries: 1,
    escalateBuildFailure: async () => ({}),
    fullSuiteVerifier: {
      ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
      inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
    },
    git: async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/one-review-owner\n' }
        : { stdout: '' },
    ...options,
  });
  await conductor.run();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Covers: FR-21, FR-22, S16.1, S16.2 — pre-change features remain shippable', () => {
  it('reaches SHIP with legacy tasks while counting stale rem-* tasks as authored and ignoring retired-rubric dispositions', async () => {
    const fixture = await seedFixture({
      fromStep: 'build',
      tier: 'L',
      track: 'product',
      legacyPlan: true,
      downstream: { retro: 'skipped', rebase: 'done' },
    });
    await writeFile(
      join(fixture.pipelineDir, 'build-review-dispositions.json'),
      JSON.stringify({
        version: 'v1',
        records: [{
          kind: 'reduced-coverage',
          version: 'v1',
          feature: fixture.feature,
          identity: { rubric: 'scope', reason: 'provider-error' },
          rationale: 'accepted before rubric retirement',
          operator: 'operator',
          acceptedAt: '2026-08-21T12:00:00.000Z',
        }],
      }),
    );
    const calls: StepName[] = [];

    await runFixture(fixture, fakeRunner(fixture, calls, { prdAudit: 'pass' }), {
      fromStep: 'build',
      verifyArtifacts: false,
      daemon: false,
    });

    const ledger = JSON.parse(
      await readFile(join(fixture.pipelineDir, 'kickback-ledger.json'), 'utf8').catch(() => '{}'),
    ) as { growth?: { authored?: number; added?: number } };
    const stale = await new BuildReviewDispositionStore(fixture.root).listReducedCoverage(
      fixture.feature,
    );
    expect({
      reachedShip: calls.includes('prd_audit') && calls.includes('architecture_review_as_built'),
      finished: calls.includes('finish'),
      growth: ledger.growth,
      retiredRecords: stale.ok ? stale.records.length : 'reader-error',
      halted: existsSync(join(fixture.pipelineDir, 'HALT')),
    }).toEqual({
      reachedShip: true,
      finished: true,
      growth: { authored: 6, added: 0 },
      retiredRecords: 0,
      halted: false,
    });
  });
});

describe('Covers: FR-2 — a plan-conformant feature traverses BUILD to SHIP', () => {
  it('finishes without a halt when every fake boundary returns a passing judgement', async () => {
    const fixture = await seedFixture({
      fromStep: 'build',
      tier: 'L',
      track: 'product',
      downstream: { retro: 'skipped', rebase: 'done' },
    });
    const calls: StepName[] = [];

    await runFixture(fixture, fakeRunner(fixture, calls, { prdAudit: 'pass' }), {
      fromStep: 'build',
      verifyArtifacts: false,
      daemon: false,
    });

    expect(calls).toEqual(expect.arrayContaining([
      'build',
      'build_review',
      'prd_audit',
      'architecture_review_as_built',
      'finish',
    ]));
    expect(existsSync(join(fixture.pipelineDir, 'HALT'))).toBe(false);
  });
});

describe('Covers: FR-16, FR-17, S13.1 — a delivered as-built PLAN_GAP is non-blocking', () => {
  it('records the PLAN_GAP verdict and advances to retro without a BUILD or remediation route', async () => {
    const fixture = await seedFixture({
      fromStep: 'prd_audit',
      tier: 'L',
      track: 'product',
      downstream: { retro: 'pending', rebase: 'done', finish: 'done' },
    });
    const calls: StepName[] = [];

    await runFixture(
      fixture,
      fakeRunner(fixture, calls, { prdAudit: 'pass', asBuilt: 'plan-gap' }),
      { fromStep: 'prd_audit', verifyArtifacts: true, daemon: false },
    );

    expect(calls).toContain('architecture_review_as_built');
    expect(calls).toContain('retro');
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
    expect(await readFile(join(fixture.pipelineDir, 'architecture-review-as-built.md'), 'utf8'))
      .toContain('Verdict: PLAN_GAP');
    expect(existsSync(join(fixture.pipelineDir, 'HALT'))).toBe(false);
  });
});

describe('Covers: FR-8, S7.1 — S-tier technical work is still audited', () => {
  it('cannot reach finish when prd_audit returns success without its required verdict artifact', async () => {
    const fixture = await seedFixture({
      fromStep: 'prd_audit',
      tier: 'S',
      track: 'technical',
      downstream: {
        manual_test: 'skipped',
        retro: 'skipped',
        rebase: 'done',
        finish: 'pending',
      },
    });
    const calls: StepName[] = [];

    await runFixture(
      fixture,
      fakeRunner(fixture, calls, { prdAudit: 'missing', asBuilt: 'approved' }),
      { fromStep: 'prd_audit', verifyArtifacts: true, daemon: true },
    );

    expect(calls).toContain('prd_audit');
    expect(calls).toContain('architecture_review_as_built');
    expect(calls).not.toContain('finish');
    expect(existsSync(join(fixture.pipelineDir, 'HALT'))).toBe(true);
  });
});
