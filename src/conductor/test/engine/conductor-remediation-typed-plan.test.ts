// Covers: task:19
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { REMEDIATION_TYPED_PLAN_PATH } from '../../src/engine/remediation-plan-store.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';
import { createRemediationPlanProviderFixture } from './remediation-plan-fixtures.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const plan = Array.from({ length: 8 }, (_, index) => [
  `### Task ${index + 1}: Authored task ${index + 1}`,
  '**Done when:**',
  `- Task ${index + 1} is complete.`,
].join('\n')).join('\n\n');

function output() {
  return {
    version: 'v1',
    dispositions: [
      {
        reference: { kind: 'prd-criterion', id: 'S1.1' },
        disposition: 'existing-task',
        category: null,
        rationale: 'The owning task already contains this repair.',
        tasks: [],
        boundTaskIds: ['1'],
      },
      {
        reference: { kind: 'prd-criterion', id: 'S1.2' },
        disposition: 'build',
        category: null,
        rationale: 'The second criterion needs a scoped repair task.',
        tasks: [{ id: 'provider-task', title: 'Implement the second criterion repair.' }],
        boundTaskIds: [],
      },
    ],
  };
}

async function fixture(key: 'claude' | 'codex') {
  const root = await mkdtemp(join(tmpdir(), 'conductor-remediation-typed-plan-'));
  roots.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await Promise.all([
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.pipeline'), { recursive: true }),
  ]);
  await writeFile(planPath, `${plan}\n`, 'utf8');
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }), 'utf8');
  await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
    tasks: Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), status: 'completed' })),
  }), 'utf8');
  await persistPrdAuditVerdict(root, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: ['S1.1', 'S1.2'].map((criterion, index) => ({
        criterion: { storyId: '1', ordinal: index + 1 },
        criterionId: criterion,
        grade: 'FIXABLE' as const,
        evidence: `${criterion} has a repairable gap.`,
        rationale: `${criterion} requires repair.`,
        requirementAssociations: [],
        evidenceTaskIds: [String(index + 1)],
        ownerTaskId: String(index + 1),
      })),
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: 'fixture-prd-audit', codeStamp: null });
  // This is intentionally contradictory legacy prose. The conductor must not
  // read it after the typed-plan migration.
  await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
    dispositions: [{ id: 'S1.1', disposition: 'halt', category: 'unanswerable', rationale: 'legacy conflict', tasks: [] }],
  }), 'utf8');

  const provider = createRemediationPlanProviderFixture({
    key,
    outcomes: [{ kind: 'structured', finalStructuredResult: output() }],
  });
  const config = {
    llm_provider: key,
    steps: { remediate: { llm_provider: key } },
    prd_audit: { max_remediation_laps: 2 },
  } as never;
  const runner = new DefaultStepRunner(provider.provider, 'fixture-runner-session', root, {
    config,
    providerKey: key,
    providerRuntimes: provider.runtimes,
    configuredProviders: [key],
    sessionStore: new ProviderSessionStore(),
  });
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    config,
  });
  const outcome = await (conductor as unknown as {
    planRemediation(
      state: ConductState,
      steps: typeof ALL_STEPS,
      context: string,
      source: { source: string; evidence: readonly { gate: 'prd_audit'; evidenceFile: string }[] },
    ): Promise<{ kind: string; target?: string; hint?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'PRD audit reported repairable criteria.',
    { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
  );
  return { root, planPath, provider, outcome };
}

describe('Conductor typed remediation-plan admission', () => {
  // Covers: task:19
  it.each(['claude', 'codex'] as const)(
    'projects and dispatches a %s typed gap plan without consulting legacy remediation.json',
    async (key) => {
      const result = await fixture(key);

      expect(result.provider.invocationCount).toBe(1);
      expect(result.provider.calls[0]?.nativeSchema).toBeDefined();
      expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect(await readFile(result.planPath, 'utf8')).toContain('### Task rem-prd-audit-provider-task:');
      const taskStatus = JSON.parse(await readFile(join(result.root, '.pipeline', 'task-status.json'), 'utf8')) as {
        tasks: Array<{ id: string; status: string }>;
      };
      expect(taskStatus.tasks.find((task) => task.id === '1')?.status).toBe('pending');
      expect(JSON.parse(await readFile(join(result.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8')))
        .toMatchObject({ source: 'prd-audit', dispositions: expect.any(Array) });
    },
  );

  // Covers: task:19
  it('keeps Claude and Codex disposition effects equal apart from attempt metadata', async () => {
    const claude = await fixture('claude');
    const codex = await fixture('codex');
    const [claudePlan, codexPlan] = await Promise.all([
      readFile(join(claude.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8').then(JSON.parse),
      readFile(join(codex.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8').then(JSON.parse),
    ]);

    expect({ ...claudePlan, attemptId: '<attempt>' }).toEqual({ ...codexPlan, attemptId: '<attempt>' });
    expect({ target: claude.outcome.target, hint: claude.outcome.hint }).toEqual({
      target: codex.outcome.target,
      hint: codex.outcome.hint,
    });
    for (const result of [claude, codex]) {
      expect(await readFile(result.planPath, 'utf8')).toContain('### Task rem-prd-audit-provider-task:');
    }
  });
});
