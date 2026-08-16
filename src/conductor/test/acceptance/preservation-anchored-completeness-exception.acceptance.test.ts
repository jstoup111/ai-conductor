/**
 * RED acceptance coverage for jstoup111/ai-conductor#1580.
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Story 1 is a single skill-text authoring operation; Plan Tasks 7-8 own its
 *   lower-layer contract coverage.
 * - Story 2 crosses plan parsing, source-snapshot assembly, and closed rubric
 *   projection, so its engine evidence flow is covered here.
 * - Stories 3-6 cross that evidence flow and the real build_review rubric
 *   dispatch/join path. They are acceptance flows, with the LLM boundary
 *   replaced by the deterministic provider fake below.
 *
 * Production call sites exercised:
 * - src/engine/build-review-inputs.ts: assembleBuildReviewInputs
 * - src/engine/build-review-projections.ts: deriveBuildReviewRubricProjections
 * - src/engine/step-runners.ts: DefaultStepRunner.run('build_review')
 *
 * Verify-claims: every asserted clause, predicate condition, anchor field,
 * and negative path is stated by the accepted stories and approved ADR. No
 * unconfirmed load-bearing assumption is encoded here.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const execFile = promisify(execFileCallback);
const PLAN_PATH = '.docs/plans/feature.md';
const CARRIER_PATH = 'test/preservation-carrier.test.ts';
const COMPLETENESS_SKILL_PATH = new URL(
  '../../../../skills/build-review-completeness/SKILL.md',
  import.meta.url,
);
const scratchRoots: string[] = [];

interface PreservationEntry {
  taskId: string;
  behavior: string;
}

interface Scenario {
  name: string;
  preserves?: readonly string[];
  planRequirement?: string;
  baseCarrier?: string;
  replacements?: Readonly<Record<string, string>>;
  changeProduction?: boolean;
}

interface Fixture {
  root: string;
  head: string;
  planPath: string;
}

interface CompletenessProjection {
  rubric: 'completeness';
  lapId: string;
  snapshotDigest: string;
  preservationContext?: readonly PreservationEntry[];
  removalContext: { deletedFiles: readonly string[] };
}

interface CompletenessFinding {
  concernKind: string;
  summary: string;
  evidenceLocations: string[];
  anchor: {
    rubric: 'completeness';
    planTask: string;
    missingOutcome: string;
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

function planBody(scenario: Scenario): string {
  return [
    '# Approved plan',
    '',
    '### Task 9: Preserve review coverage',
    ...(scenario.preserves ?? []).map((behavior) => `**Preserves:** ${behavior}`),
    scenario.planRequirement ?? 'Relocate the existing coverage without changing its assertions.',
    '**Files:**',
    `- \`${CARRIER_PATH}\``,
    ...Object.keys(scenario.replacements ?? {}).map((path) => `- \`${path}\``),
    '',
  ].join('\n');
}

async function makeFixture(scenario: Scenario): Promise<Fixture> {
  const repository = await mkdtemp(join(tmpdir(), 'preservation-completeness-'));
  scratchRoots.push(repository);

  await git(repository, 'init', '-q', '-b', 'main');
  await git(repository, 'config', 'user.email', 'acceptance@example.test');
  await git(repository, 'config', 'user.name', 'Acceptance Test');
  await git(repository, 'config', 'commit.gpgsign', 'false');
  await git(repository, 'config', 'diff.renames', 'false');
  await writeRepoFile(repository, '.gitignore', '.pipeline/\n');
  await writeRepoFile(repository, PLAN_PATH, planBody(scenario));
  await writeRepoFile(repository, 'src/feature.ts', 'export const behavior = true;\n');
  if (scenario.baseCarrier !== undefined) {
    await writeRepoFile(repository, CARRIER_PATH, scenario.baseCarrier);
  }
  await git(repository, 'add', '.');
  await git(repository, 'commit', '-q', '-m', 'base behavior and approved plan');

  await git(repository, 'remote', 'add', 'origin', repository);
  await git(repository, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(repository, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const root = join(repository, '.worktrees', scenario.name);
  await mkdir(dirname(root), { recursive: true });
  await git(repository, 'worktree', 'add', '-q', '-b', `feature/${scenario.name}`, root);

  if (scenario.baseCarrier !== undefined) {
    await rm(join(root, CARRIER_PATH));
  }
  for (const [path, content] of Object.entries(scenario.replacements ?? {})) {
    await writeRepoFile(root, path, content);
  }
  if (scenario.changeProduction) {
    await writeRepoFile(root, 'src/feature.ts', 'export const behavior = true;\nexport const touched = true;\n');
  }
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'reorganize preserved coverage');

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
      evidence: { provenanceHeadSha: head, outcome: 'PASS' },
    } as never),
  };
}

function preservationContext(value: unknown): readonly PreservationEntry[] | undefined {
  return (value as { preservationContext?: readonly PreservationEntry[] }).preservationContext;
}

function contractSupportsPreservation(skill: string): boolean {
  return /preservation[- ]maintenance/i.test(skill) &&
    /no equivalent assertion[\s\S]*survives anywhere/i.test(skill) &&
    /per preserved[- ]behavior clause/i.test(skill) &&
    /removalContext[\s\S]*anchors exactly/i.test(skill);
}

function finding(missingOutcome: string): CompletenessFinding {
  return {
    concernKind: 'missing preserved coverage',
    summary: `No equivalent assertion survives for ${missingOutcome}.`,
    evidenceLocations: [`${PLAN_PATH}:4`, `${CARRIER_PATH}:1`],
    anchor: {
      rubric: 'completeness',
      planTask: '9',
      missingOutcome,
    },
  };
}

const ASSERTION_BY_BEHAVIOR: Readonly<Record<string, string>> = {
  'wrapper transparency': 'expect(wrapper.transparent).toBe(true)',
  'failed preflight never dispatches': 'expect(dispatches).toBe(0)',
  'optional member remains absent': 'expect(wrapper.optionalMember).toBeUndefined()',
};

function behaviorAssertedIn(content: string, behavior: string): boolean {
  const assertion = ASSERTION_BY_BEHAVIOR[behavior];
  return assertion !== undefined && content.split('\n').some((line) =>
    !line.includes('it.skip') && line.includes(assertion),
  );
}

async function carrierContents(root: string): Promise<string[]> {
  const trackedPaths = (await git(root, 'ls-files')).split('\n');
  return Promise.all(trackedPaths
    .filter((path) => path.startsWith('test/'))
    .map((path) => readFile(join(root, path), 'utf8')));
}

async function behaviorRemovedFromBaseCarrier(root: string): Promise<string | undefined> {
  try {
    const baseCarrier = await git(root, 'show', `HEAD~1:${CARRIER_PATH}`);
    return Object.keys(ASSERTION_BY_BEHAVIOR).find((behavior) => behaviorAssertedIn(baseCarrier, behavior));
  } catch {
    return undefined;
  }
}

async function judgeScenario(scenario: Scenario): Promise<{
  success: boolean;
  result: { kind: string; contractVersion?: string; findings?: CompletenessFinding[] };
  projection: CompletenessProjection;
}> {
  const fixture = await makeFixture(scenario);
  const skill = await readFile(COMPLETENESS_SKILL_PATH, 'utf8');
  let observedProjection: CompletenessProjection | undefined;
  const provider: LLMProvider = {
    invoke: vi.fn(async (options) => {
      const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as CompletenessProjection;
      observedProjection = projection;
      const expectedContext = (scenario.preserves ?? []).map((behavior) => ({ taskId: '9', behavior }));
      const contextPresent = JSON.stringify(projection.preservationContext ?? []) === JSON.stringify(expectedContext);
      const contractPresent = contractSupportsPreservation(skill);
      const replacementContents = await carrierContents(fixture.root);
      const carrierWasRemoved = projection.removalContext.deletedFiles.includes(CARRIER_PATH);
      const lostPreservedBehaviors = (projection.preservationContext ?? [])
        .map(({ behavior }) => behavior)
        .filter((behavior) => !replacementContents.some((content) => behaviorAssertedIn(content, behavior)));
      const removedCarrierBehavior = carrierWasRemoved
        ? await behaviorRemovedFromBaseCarrier(fixture.root)
        : undefined;
      const syntheticFailure = !contractPresent
        ? ['the Completeness rubric lacks the preservation-maintenance predicate']
        : !contextPresent
          ? ['the engine omitted the declared preservation evidence']
          : lostPreservedBehaviors.length > 0
            ? lostPreservedBehaviors
            : (projection.preservationContext ?? []).length > 0 || removedCarrierBehavior === undefined
              ? []
              : [removedCarrierBehavior];
      const findings = syntheticFailure.map(finding);
      return {
        success: true,
        output: JSON.stringify({
          kind: 'judged',
          rubric: projection.rubric,
          lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest,
          contractVersion: 'v1',
          findings,
          verdict: findings.length === 0 ? 'PASS' : 'FAIL',
        }),
        exitCode: 0,
      };
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
  const runner = new DefaultStepRunner(provider, 'acceptance-maker', fixture.root, {
    config: {
      build_review: {
        enabled: true,
        perTaskFloor: false,
        rubrics: {
          tautology: { enabled: false },
          scope: { enabled: false },
          rootCause: { enabled: false },
          completeness: { enabled: true },
        },
      },
    } as HarnessConfig,
    planPath: fixture.planPath,
    pipelineDir: join(fixture.root, '.pipeline'),
    buildReviewInputOptions: currentProof(fixture.head),
  });

  const run = await runner.run('build_review', {
    complexity_tier: 'M',
    feature_desc: scenario.name,
    track: 'technical',
  });
  const aggregate = JSON.parse(
    await readFile(join(fixture.root, '.pipeline', 'build-review.json'), 'utf8'),
  ) as { results: { completeness: { kind: string; contractVersion?: string; findings?: CompletenessFinding[] } } };
  expect(observedProjection).toBeDefined();
  return {
    success: run.success,
    result: aggregate.results.completeness,
    projection: observedProjection!,
  };
}

describe('acceptance: preservation-anchored Completeness exception (#1580)', () => {
  it('threads every declared behavior through the frozen snapshot and Completeness projection only', async () => {
    const scenario: Scenario = {
      name: 'projection-evidence',
      preserves: ['wrapper transparency', 'failed preflight never dispatches'],
      baseCarrier: 'expect(wrapper.transparent).toBe(true);\n',
      replacements: {
        'test/provider-leg.test.ts': 'expect(wrapper.transparent).toBe(true);\n',
      },
    };
    const fixture = await makeFixture(scenario);
    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );
    const expected = scenario.preserves!.map((behavior) => ({ taskId: '9', behavior }));

    expect(preservationContext(inputs)).toEqual(expected);
    expect(preservationContext(inputs.sourceSnapshot)).toEqual(expected);
    expect(Object.isFrozen(preservationContext(inputs.sourceSnapshot))).toBe(true);

    const projections = deriveBuildReviewRubricProjections({
      lapId: 'lap-preservation' as never,
      inputs,
      tautology: {
        changedTestSelectors: [],
        revertedProductionManifest: [],
        preflightEvidence: { classification: 'not-requested' },
      },
    });
    expect(preservationContext(projections.completeness)).toEqual(expected);
    expect(projections.completeness.projectionVersion).toBe('v2');
    expect(projections.tautology).not.toHaveProperty('preservationContext');
    expect(projections.scope).not.toHaveProperty('preservationContext');
    expect(projections.rootCause).not.toHaveProperty('preservationContext');
  });

  it.each([
    ['no clause', '# Plan\n\n### Task 9: ordinary task\n', []],
    ['empty clause', '# Plan\n\n### Task 9: ordinary task\n**Preserves:**   \n', []],
    ['headerless prose', '# Plan\n\n**Preserves:** wrapper transparency\n', []],
  ] as const)('fails closed for %s', async (_name, body, expected) => {
    const fixture = await makeFixture({
      name: `fail-closed-${_name.replace(' ', '-')}`,
      baseCarrier: 'expect(wrapper.transparent).toBe(true);\n',
      replacements: { 'test/provider-leg.test.ts': 'expect(wrapper.transparent).toBe(true);\n' },
    });
    await writeFile(fixture.planPath, body, 'utf8');
    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root), fixture.planPath, currentProof(fixture.head),
    );
    expect(preservationContext(inputs)).toEqual(expected);
  });

  it('returns no finding when coverage is relocated with an equivalent assertion', async () => {
    const judged = await judgeScenario({
      name: 'equivalent-relocation',
      preserves: ['wrapper transparency'],
      baseCarrier: [
        '// old combined provider suite',
        'expect(wrapper.transparent).toBe(true);',
        'expect(wrapper.optionalMember).toBeUndefined();',
      ].join('\n'),
      replacements: {
        'test/codex-provider-leg.test.ts': [
          'expect(wrapper.transparent).toBe(true);',
          'expect(wrapper.optionalMember).toBeUndefined();',
        ].join('\n'),
      },
    });

    expect(judged.projection.removalContext.deletedFiles).toContain(CARRIER_PATH);
    expect(judged.result).toMatchObject({ kind: 'judged', findings: [] });
    expect(judged.success).toBe(true);
  });

  it.each([
    ['deleted', {}, 'wrapper transparency'],
    ['weakened', { 'test/provider-leg.test.ts': 'expect(wrapper).toBeDefined();\n' }, 'wrapper transparency'],
    ['same named but assertion-free', { 'test/provider-leg.test.ts': "it('wrapper transparency', () => {});\n" }, 'wrapper transparency'],
    ['different behavior', { 'test/provider-leg.test.ts': 'expect(wrapper.metered).toBe(true);\n' }, 'wrapper transparency'],
    ['skipped replacement', { 'test/provider-leg.test.ts': "it.skip('wrapper transparency', () => expect(wrapper.transparent).toBe(true));\n" }, 'wrapper transparency'],
  ] as const)('keeps %s coverage loss as a finding with the nested v1 anchor', async (name, replacements, behavior) => {
    const judged = await judgeScenario({
      name: `lost-${name.replaceAll(' ', '-')}`,
      preserves: [behavior],
      baseCarrier: 'expect(wrapper.transparent).toBe(true);\n',
      replacements,
    });

    expect(judged.result).toMatchObject({
      kind: 'judged',
      contractVersion: 'v1',
      findings: [{
        concernKind: 'missing preserved coverage',
        anchor: {
          rubric: 'completeness',
          planTask: '9',
          missingOutcome: behavior,
        },
      }],
    });
    expect(judged.success).toBe(false);
  });

  it('judges each clause independently in a mixed relocation-and-loss diff', async () => {
    const judged = await judgeScenario({
      name: 'mixed-two-clauses',
      preserves: ['wrapper transparency', 'failed preflight never dispatches'],
      baseCarrier: [
        'expect(wrapper.transparent).toBe(true);',
        'expect(dispatches).toBe(0);',
      ].join('\n'),
      replacements: {
        'test/provider-leg.test.ts': 'expect(wrapper.transparent).toBe(true);\n',
      },
    });

    expect(judged.result.findings).toHaveLength(1);
    expect(judged.result.findings?.[0]?.anchor).toEqual({
      rubric: 'completeness',
      planTask: '9',
      missingOutcome: 'failed preflight never dispatches',
    });
    expect(judged.result.findings?.[0]?.anchor.missingOutcome).not.toBe('wrapper transparency');
  });

  it('judges each clause independently in a three-clause mixed relocation-and-loss diff', async () => {
    const judged = await judgeScenario({
      name: 'mixed-per-clause',
      preserves: ['wrapper transparency', 'failed preflight never dispatches', 'optional member remains absent'],
      baseCarrier: [
        'expect(wrapper.transparent).toBe(true);',
        'expect(dispatches).toBe(0);',
        'expect(wrapper.optionalMember).toBeUndefined();',
      ].join('\n'),
      replacements: {
        'test/provider-leg.test.ts': [
          'expect(wrapper.transparent).toBe(true);',
          'expect(wrapper.optionalMember).toBeUndefined();',
        ].join('\n'),
      },
    });

    expect(judged.result.findings).toHaveLength(1);
    expect(judged.result.findings?.[0]?.anchor).toEqual({
      rubric: 'completeness',
      planTask: '9',
      missingOutcome: 'failed preflight never dispatches',
    });
    expect(judged.result.findings?.[0]?.anchor.missingOutcome).not.toBe('wrapper transparency');
  });

  it('keeps separately lost preserved behaviors on distinct finding anchors', async () => {
    const judged = await judgeScenario({
      name: 'distinct-lost-anchors',
      preserves: ['failed preflight never dispatches', 'optional member remains absent'],
      baseCarrier: [
        'expect(dispatches).toBe(0);',
        'expect(wrapper.optionalMember).toBeUndefined();',
      ].join('\n'),
    });

    expect(judged.result.findings?.map((entry) => entry.anchor)).toEqual([
      {
        rubric: 'completeness',
        planTask: '9',
        missingOutcome: 'failed preflight never dispatches',
      },
      {
        rubric: 'completeness',
        planTask: '9',
        missingOutcome: 'optional member remains absent',
      },
    ]);
  });

  it('grants no exemption when removal evidence exists without a preservation clause', async () => {
    const behavior = 'wrapper transparency';
    const judged = await judgeScenario({
      name: 'removal-only',
      planRequirement: `Retain coverage for ${behavior}.`,
      baseCarrier: 'expect(wrapper.transparent).toBe(true);\n',
    });

    expect(judged.projection.preservationContext ?? []).toEqual([]);
    expect(judged.projection.removalContext.deletedFiles).toContain(CARRIER_PATH);
    expect(judged.result).toMatchObject({
      kind: 'judged',
      contractVersion: 'v1',
      findings: [{
        anchor: {
          rubric: 'completeness',
          planTask: '9',
          missingOutcome: behavior,
        },
      }],
    });
  });

  it('grants no exemption when a clause names behavior with no merge-base carrier', async () => {
    const behavior = 'wrapper transparency';
    const judged = await judgeScenario({
      name: 'clause-only',
      preserves: [behavior],
      planRequirement: `Add and preserve coverage for ${behavior}.`,
      changeProduction: true,
    });

    expect(judged.projection.preservationContext).toEqual([{ taskId: '9', behavior }]);
    expect(judged.projection.removalContext.deletedFiles).toEqual([]);
    expect(judged.result).toMatchObject({
      kind: 'judged',
      contractVersion: 'v1',
      findings: [{
        anchor: {
          rubric: 'completeness',
          planTask: '9',
          missingOutcome: behavior,
        },
      }],
    });
  });
});
