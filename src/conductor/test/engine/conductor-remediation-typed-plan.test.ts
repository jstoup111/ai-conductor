// Covers: task:19, task:20
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { AS_BUILT_VERDICT_CONTRACT_VERSION, stampAsBuiltFindingIds } from '../../src/engine/as-built-contract.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { REMEDIATION_TYPED_PLAN_PATH } from '../../src/engine/remediation-plan-store.js';
import { readKickbackLedger, settlePendingRepair } from '../../src/engine/kickback-ledger.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { RemediationPlanProviderOutcome } from './remediation-plan-fixtures.js';
import type { RemediationProjectionDependencies, RemediationProjectionLimits } from '../../src/engine/remediation-projection.js';
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

const realisticPlan = Array.from({ length: 8 }, (_, index) => {
  const id = index + 1;
  if (id !== 8) return [
    `### Task ${id}: Authored task ${id}`,
    '**Done when:**',
    `- Task ${id} is complete.`,
  ].join('\n');
  return [
    '### Task 8: Project typed sources, refusals and explicit absence',
    '**Done when:**',
    '- A PRD-audit projection carries every FIXABLE criterion by engine criterion id, its owning task, judgment summary, title, completion conditions, and accepted vocabulary rendered from code constants.',
    '- An as-built projection carries every REMEDIABLE stamped finding, governing reference, pending history, and prior remediation laps without fabricating an authority.',
    '- A validation-group projection preserves the source-labelled union, keeps required input untruncated under corpus-sized engine bounds, and faults incomplete required authority before provider dispatch.',
    `- ${'The realistic Task 8 completion section remains available to the typed-plan routing boundary. '.repeat(18)}`,
  ].join('\n');
}).join('\n\n');

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

function asBuiltOutput() {
  return {
    version: 'v1',
    dispositions: [{
      reference: { kind: 'as-built-finding', id: 'as-built:fixture-as-built:1' },
      disposition: 'existing-task', category: null,
      rationale: 'Task 1 owns the as-built repair.', tasks: [], boundTaskIds: ['1'],
      reconciliation: { relation: 'new', reason: 'This fixture finding has no prior case.' },
    }],
  };
}

function validationGroupOutput(refusalEvidence: readonly { readonly decisionId: string }[]) {
  return {
    ...output(),
    dispositions: [
      ...output().dispositions,
      ...asBuiltOutput().dispositions,
      ...refusalEvidence.map((entry) => ({
        reference: { kind: 'refusal', id: entry.decisionId },
        disposition: 'build', category: null,
        rationale: 'Remove the refused behavior from the delivered flow.',
        tasks: [{ id: `remove-${entry.decisionId}`, title: 'Remove the refused behavior.' }], boundTaskIds: [],
      })),
    ],
  };
}

const refusal = {
  key: 'S9.1',
  decisionId: 'decision-refused-9',
  revision: 2,
  rationale: 'The operator declined this behavior.',
};

const asBuiltPolicy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: true, reason: 'fixture' },
  diagramDrift: { enabled: true, reason: 'fixture' },
};

function refusalOutput(overrides: Record<string, unknown> = {}) {
  return {
    ...output(),
    dispositions: [
      ...output().dispositions,
      {
        reference: { kind: 'refusal', id: refusal.decisionId },
        disposition: 'build',
        category: null,
        rationale: 'Remove the refused behavior from the delivered flow.',
        tasks: [{ id: 'remove-refused-9', title: 'Remove the refused behavior.' }],
        boundTaskIds: [],
        ...overrides,
      },
    ],
  };
}

async function fixture(
  key: 'claude' | 'codex',
  outcomes: readonly RemediationPlanProviderOutcome[] = [
    { kind: 'structured', finalStructuredResult: output() },
  ],
  maxRetries = 2,
  options: {
    nativeSchema?: boolean;
    planText?: string;
    source?: string;
    evidenceFile?: string;
    stallQuestion?: string;
    evidenceDirectory?: boolean;
    skipPlanRemediation?: boolean;
    asBuiltRound?: boolean;
    asBuiltCases?: readonly Record<string, unknown>[];
    attemptRunId?: string;
    corruptKickbackLedger?: boolean;
    malformedCaseStore?: boolean;
    remediationProjectionLimitOverrides?: Partial<RemediationProjectionLimits>;
    remediationProjectionDependencies?: RemediationProjectionDependencies;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'conductor-remediation-typed-plan-'));
  roots.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await Promise.all([
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.pipeline'), { recursive: true }),
  ]);
  await writeFile(planPath, `${options.planText ?? plan}\n`, 'utf8');
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }), 'utf8');
  await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
    tasks: Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), status: 'completed' })),
  }), 'utf8');
  if (options.asBuiltCases !== undefined) {
    await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
      version: 'v4',
      feature: { version: 'v1', repository: 'acme/conductor', feature: 'typed-plan-fixture' },
      cases: [], prdWideningCases: [], asBuiltCases: options.asBuiltCases, suppressions: [], outbox: [],
    }), 'utf8');
  }
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
  }, { attemptId: options.attemptRunId ?? 'fixture-prd-audit', codeStamp: null });
  if (options.asBuiltRound) {
    await persistAsBuiltVerdict(root, stampAsBuiltFindingIds({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED', reachability: [], driftNotes: [],
      violations: 'Fixture as-built finding.', resolution: 'Repair Task 1.',
      findings: [{ class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Fixture as-built finding.' }],
    }, 'fixture-as-built'), { attemptId: 'fixture-as-built', codeStamp: null, policy: asBuiltPolicy });
  }
  // This is intentionally contradictory legacy prose. The conductor must not
  // read it after the typed-plan migration.
  await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
    dispositions: [{ id: 'S1.1', disposition: 'halt', category: 'unanswerable', rationale: 'legacy conflict', tasks: [] }],
  }), 'utf8');

  const provider = createRemediationPlanProviderFixture({
    key,
    outcomes,
  });
  if (options.nativeSchema === false) {
    (provider.runtime as { nativeSchemaCapability: { nativeOutputSchema: boolean } })
      .nativeSchemaCapability = { nativeOutputSchema: false };
  }
  const config = {
    llm_provider: key,
    steps: { remediate: { llm_provider: key, max_retries: maxRetries } },
    prd_audit: { max_remediation_laps: 2 },
  } as never;
  const runner = new DefaultStepRunner(provider.provider, 'fixture-runner-session', root, {
    config,
    providerKey: key,
    providerRuntimes: provider.runtimes,
    configuredProviders: [key],
    sessionStore: new ProviderSessionStore(),
  });
  const events = new ConductorEventEmitter();
  const blockedReasons: string[] = [];
  const rejectedDispositions: string[] = [];
  events.on('gate_blocked', (event) => {
    if (event.type === 'gate_blocked') blockedReasons.push(event.reason);
  });
  events.on('remediation_disposition_rejected', (event) => {
    if (event.type === 'remediation_disposition_rejected') rejectedDispositions.push(event.disposition);
  });
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events,
    projectRoot: root,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    config,
    remediationProjectionLimitOverrides: options.remediationProjectionLimitOverrides,
    remediationProjectionDependencies: options.remediationProjectionDependencies,
  });
  if (options.attemptRunId !== undefined) {
    (conductor as unknown as { currentRunId: string }).currentRunId = options.attemptRunId;
  }
  const source = options.source ?? 'prd-audit';
  const evidenceFile = options.evidenceFile ?? '.pipeline/prd-audit.md';
  if (options.evidenceDirectory) {
    await mkdir(join(root, evidenceFile), { recursive: true });
  } else if (options.stallQuestion !== undefined) {
    await writeFile(join(root, evidenceFile), options.stallQuestion, 'utf8');
  }
  if (options.corruptKickbackLedger) await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), '{', 'utf8');
  if (options.malformedCaseStore) await writeFile(join(root, '.pipeline', 'remediation-cases.json'), '{', 'utf8');
  const state = { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState;
  // This focused planner seam normally runs after Conductor.run has captured
  // the mutation baseline. Seed that lifecycle-owned baseline so a mechanical
  // halt can persist through the same state transition port.
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify(state), 'utf8');
  (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...state };
  const outcome = options.skipPlanRemediation ? { kind: 'none' } : await (conductor as unknown as {
    planRemediation(
      state: ConductState,
      steps: typeof ALL_STEPS,
      context: string,
      source: { source: string; evidence: readonly { gate: string; evidenceFile: string }[] },
    ): Promise<{ kind: string; target?: string; hint?: string }>;
  }).planRemediation(
    state,
    ALL_STEPS,
    'PRD audit reported repairable criteria.',
    { source, evidence: [{ gate: source.includes('stall') ? 'build' : source === 'as-built' ? 'architecture_review_as_built' : 'prd_audit', evidenceFile }] } as never,
  );
  return {
    root,
    planPath,
    provider,
    runner,
    conductor,
    config,
    state,
    outcome,
    blockedReasons,
    rejectedDispositions,
  };
}

describe('Conductor typed remediation-plan admission', () => {
  async function refusalRound(
    outcomes: readonly RemediationPlanProviderOutcome[],
    maxRetries = 2,
  ) {
    const result = await fixture('claude', outcomes, maxRetries, { skipPlanRemediation: true });
    (result.conductor as unknown as {
      routeCurrentPrdAuditOverScope: () => Promise<unknown>;
    }).routeCurrentPrdAuditOverScope = async () => ({
      kind: 'refusal-rework',
      refusals: [refusal],
      refused: [],
      findings: [],
      detail: 'OVER_SCOPE visible behavior on S9.1.',
    });
    const outcome = await (result.conductor as unknown as {
      planRemediation(
        state: ConductState,
        steps: typeof ALL_STEPS,
        context: string,
        source: { source: string; evidence: readonly { gate: string; evidenceFile: string }[] },
      ): Promise<{ kind: string; target?: string; reason?: string; detail?: string }>;
    }).planRemediation(
      result.state,
      ALL_STEPS,
      'PRD audit requires refusal rework.',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );
    return { ...result, outcome };
  }

  // Covers: task:29
  it('routes validated refusal references through the typed plan and appends decision-bound rework tasks', async () => {
    const result = await refusalRound([{ kind: 'structured', finalStructuredResult: refusalOutput() }]);

    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(await readFile(result.planPath, 'utf8')).toContain(
      '### Task rem-prd-audit-refusal-decision-refused-9:',
    );
  });

  // Covers: task:29
  it.each([
    ['halt', { disposition: 'halt', category: 'product-scope', tasks: [] }],
    ['existing-task', { disposition: 'existing-task', tasks: [], boundTaskIds: ['1'] }],
    ['omission', null],
  ])('rejects a refusal answered with %s without appending unrelated work', async (_label, override) => {
    const result = await refusalRound([{
      kind: 'structured',
      finalStructuredResult: override === null
        ? output()
        : refusalOutput(override),
    }]);

    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(await readFile(result.planPath, 'utf8')).not.toContain('rem-prd-audit-refusal-decision-refused-9');
  });

  // Covers: task:29
  it('retries a task-less refusal build as a whole-plan validation rejection', async () => {
    const result = await refusalRound([
      { kind: 'structured', finalStructuredResult: refusalOutput({ tasks: [] }) },
      { kind: 'structured', finalStructuredResult: refusalOutput() },
    ]);

    expect(result.provider.invocationCount).toBe(2);
    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(await readFile(result.planPath, 'utf8')).toContain('rem-prd-audit-refusal-decision-refused-9');
  });

  // Covers: task:19, task:rem-prd-audit-rem-prd-audit-s1-1-2
  it.each(['claude', 'codex'] as const)(
    'projects and dispatches a %s typed gap plan without consulting legacy remediation.json',
    async (key) => {
      const result = await fixture(key, undefined, 2, { planText: realisticPlan });

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

  // Covers: task:1
  it('writes attempt history before invoking the as-built remediate runner', async () => {
    const cases = Array.from({ length: 11 }, (_, index) => ({
      id: `case-${index + 1}`, domain: 'as_built', status: 'open', recurrenceCount: 1,
      repairTaskIds: ['1'],
      sources: [{
        findingId: `as-built:prior:${index + 1}`, attemptId: 'prior', class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: '1' },
        summary: `Case ${index + 1}: ${'complete durable source '.repeat(40)}`,
        relation: 'new', reason: 'The prior as-built review recorded this source.',
      }],
    }));
    const result = await fixture('codex', [{ kind: 'structured', finalStructuredResult: asBuiltOutput() }], 2, {
      source: 'as-built', asBuiltRound: true, asBuiltCases: cases,
    });

    expect(result.provider.invocationCount).toBe(1);
    const history = await readdir(join(result.root, '.pipeline', 'remediation-history'));
    const activeName = history.find((name) => name.endsWith('.active.json'));
    expect(activeName).toBeDefined();
    const active = JSON.parse(await readFile(join(result.root, '.pipeline', 'remediation-history', activeName!), 'utf8'));
    expect(Buffer.byteLength(JSON.stringify(active.priorAsBuiltCases), 'utf8')).toBeGreaterThan(8 * 1024);
    expect(active.priorAsBuiltCases).toEqual(expect.arrayContaining(cases.map((entry) => expect.objectContaining({
      id: entry.id,
      repairTasks: [{ id: '1', resolution: 'completed' }],
    }))));
  });

  // Covers: task:1
  it('writes both empty history files before invoking the as-built remediate runner', async () => {
    const result = await fixture('codex', [{ kind: 'structured', finalStructuredResult: asBuiltOutput() }], 2, {
      source: 'as-built', asBuiltRound: true,
    });

    expect(result.provider.invocationCount).toBe(1);
    const history = await readdir(join(result.root, '.pipeline', 'remediation-history'));
    const activeName = history.find((name) => name.endsWith('.active.json'));
    const resolvedName = history.find((name) => name.endsWith('.resolved.json'));
    expect(activeName).toBeDefined();
    expect(resolvedName).toBeDefined();
    await expect(readFile(join(result.root, '.pipeline', 'remediation-history', activeName!), 'utf8')).resolves.toBe(
      JSON.stringify({ pendingAsBuiltFindings: [], priorAsBuiltCases: [], priorLaps: [], refusals: [] }),
    );
    await expect(readFile(join(result.root, '.pipeline', 'remediation-history', resolvedName!), 'utf8')).resolves.toBe(
      JSON.stringify({ pendingAsBuiltFindings: [], priorAsBuiltCases: [], priorLaps: [], refusals: [] }),
    );
  });

  // Covers: task:2
  it('omits prior as-built cases from both files in a PRD-audit-only dispatch', async () => {
    const result = await fixture('codex');

    expect(result.provider.invocationCount).toBe(1);
    const history = await readdir(join(result.root, '.pipeline', 'remediation-history'));
    const [activeName, resolvedName] = [
      history.find((name) => name.endsWith('.active.json')),
      history.find((name) => name.endsWith('.resolved.json')),
    ];
    expect(activeName).toBeDefined();
    expect(resolvedName).toBeDefined();
    const [active, resolved] = await Promise.all([activeName, resolvedName].map((name) =>
      readFile(join(result.root, '.pipeline', 'remediation-history', name!), 'utf8').then(JSON.parse),
    ));
    expect(active).not.toHaveProperty('priorAsBuiltCases');
    expect(resolved).not.toHaveProperty('priorAsBuiltCases');
  });

  // Covers: task:1
  it('dispatches a validation-group gap plan with over 512 KiB of complete history', async () => {
    const refusals = Array.from({ length: 3 }, (_, index) => ({
      key: `S9.${index + 1}`, decisionId: `refusal-large-${index + 1}`, revision: 1,
      rationale: `Refusal ${index + 1} remains part of the complete history.`,
    }));
    const result = await fixture('codex', [{ kind: 'structured', finalStructuredResult: validationGroupOutput(refusals) }], 2, {
      source: 'validation-group', asBuiltRound: true, skipPlanRemediation: true,
    });
    const pending = Array.from({ length: 3 }, (_, index) => ({
      gate: 'architecture_review_as_built', finding: `as-built:large:${index + 1}`, class: 'REMEDIABLE',
      governingClause: 'Task 1', reference: { kind: 'plan-task', taskId: '1' },
      summary: `Pending ${index + 1}: ${'complete pending finding text '.repeat(7_000)}`,
      outcome: 'remediated',
    }));
    await writeFile(join(result.root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: { architecture_review_as_built: { count: 1, cumulative: 1, laps: 1, treeHash: null, lastReason: 'prior', priorVerdict: true, resolvedBefore: 0 } },
      pendingAsBuiltRemediationFindings: pending,
    }), 'utf8');
    (result.conductor as unknown as { routeCurrentPrdAuditOverScope: () => Promise<unknown> }).routeCurrentPrdAuditOverScope = async () => ({
      kind: 'refusal-rework', refusals, refused: [], findings: [], detail: 'Fixture refusal rework.',
    });
    const outcome = await (result.conductor as unknown as {
      planRemediation(
        state: ConductState, steps: typeof ALL_STEPS, context: string,
        source: { source: string; evidence: readonly { gate: string; evidenceFile: string }[] },
      ): Promise<{ kind: string }>;
    }).planRemediation(
      result.state, ALL_STEPS, 'Validation group requires remediation.', {
        source: 'validation-group',
        evidence: [
          { gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' },
          { gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' },
        ],
      },
    );

    expect(outcome).toMatchObject({ kind: 'route' });
    expect(result.provider.invocationCount).toBe(1);
    const activeName = (await readdir(join(result.root, '.pipeline', 'remediation-history')))
      .find((name) => name.endsWith('.active.json'));
    expect(activeName).toBeDefined();
    const active = JSON.parse(await readFile(join(result.root, '.pipeline', 'remediation-history', activeName!), 'utf8'));
    expect(Buffer.byteLength(JSON.stringify({ pending, refusals }), 'utf8')).toBeGreaterThan(512 * 1024);
    expect(active.pendingAsBuiltFindings).toEqual(pending);
    expect(active.priorLaps).toEqual([{ gate: 'architecture_review_as_built', laps: 1 }]);
    expect(active.refusals).toEqual(refusals);
  });

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

  // Covers: task:20
  it('retries a missing structured plan as a fresh gap-plan session and records its fault', async () => {
    const result = await fixture('claude', [
      { kind: 'chat', output: 'I cannot provide structured output.' },
      { kind: 'structured', finalStructuredResult: output() },
    ]);

    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(result.provider.invocationCount).toBe(2);
    expect(result.provider.calls[1]?.sessionId).not.toBe(result.provider.calls[0]?.sessionId);
    expect(result.blockedReasons).toContain('structured-result-missing');
  });

  // Covers: task:20
  it('retries a rejected structured plan and records its validator diagnostic', async () => {
    const rejected = {
      version: 'v1',
      dispositions: [{
        reference: { kind: 'prd-criterion', id: 'S1.1' },
        disposition: 'invented-disposition',
        category: null,
        rationale: 'This is not a supported engine disposition.',
        tasks: [],
        boundTaskIds: [],
      }],
    };
    const result = await fixture('claude', [
      { kind: 'structured', finalStructuredResult: rejected },
      { kind: 'structured', finalStructuredResult: output() },
    ]);

    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(result.provider.invocationCount).toBe(2);
    expect(result.rejectedDispositions).toEqual(['invented-disposition']);
  });

  // Covers: task:3
  it('keeps the same history files byte-identical through a rejected-plan retry', async () => {
    const rejected = {
      version: 'v1', dispositions: [{
        reference: { kind: 'prd-criterion', id: 'S1.1' }, disposition: 'invented-disposition', category: null,
        rationale: 'Rejected fixture disposition.', tasks: [], boundTaskIds: [],
      }],
    };
    const result = await fixture('codex', [
      { kind: 'structured', finalStructuredResult: rejected },
      { kind: 'structured', finalStructuredResult: output() },
    ]);

    expect(result.provider.invocationCount).toBe(2);
    const directory = join(result.root, '.pipeline', 'remediation-history');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(2);
    const contents = await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')));
    expect(contents).toEqual(contents.map((content) => JSON.stringify(JSON.parse(content))));
  });

  // Covers: task:3
  it('leaves an earlier attempt history intact when a new remediation attempt is prepared', async () => {
    const result = await fixture('codex', [
      { kind: 'structured', finalStructuredResult: output() },
      { kind: 'structured', finalStructuredResult: output() },
    ], 1, { attemptRunId: 'attempt-one' });
    const directory = join(result.root, '.pipeline', 'remediation-history');
    const firstFiles = (await readdir(directory)).sort();
    const firstBytes = await Promise.all(firstFiles.map((name) => readFile(join(directory, name), 'utf8')));
    await settlePendingRepair(result.root, [{
      gate: 'prd_audit', lapCap: 2, growthCap: 2, authoredSource: 'plan',
      growth: { authored: 8, added: 0, byGate: {}, remaining: 2 },
    }]);
    await persistPrdAuditVerdict(result.root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: ['S1.1', 'S1.2'].map((criterion, index) => ({
          criterion: { storyId: '1', ordinal: index + 1 }, criterionId: criterion, grade: 'FIXABLE' as const,
          evidence: `${criterion} has a repairable gap.`, rationale: `${criterion} requires repair.`,
          requirementAssociations: [], evidenceTaskIds: [String(index + 1)], ownerTaskId: String(index + 1),
        })),
        noOwnerObservations: [],
      }, diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'attempt-two', codeStamp: null });
    const next = new Conductor({ stateFilePath: join(result.root, '.pipeline', 'conduct-state.json'), stepRunner: result.runner, events: new ConductorEventEmitter(), projectRoot: result.root, mode: 'auto', daemon: true, verifyArtifacts: false, config: result.config });
    (next as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...result.state };
    (next as unknown as { currentRunId: string }).currentRunId = 'attempt-two';
    await (next as unknown as { planRemediation(state: ConductState, steps: typeof ALL_STEPS, context: string, source: { source: string; evidence: readonly { gate: string; evidenceFile: string }[] }): Promise<unknown> }).planRemediation(result.state, ALL_STEPS, 'Retry after a new attempt.', { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] });
    const allFiles = (await readdir(directory)).sort();
    expect(allFiles).toHaveLength(4);
    await expect(Promise.all(firstFiles.map((name) => readFile(join(directory, name), 'utf8')))).resolves.toEqual(firstBytes);
  });

  // Covers: task:20
  it('does not retry a valid first gap-plan attempt', async () => {
    const result = await fixture('codex');

    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(result.provider.invocationCount).toBe(1);
  });

  // Covers: task:27
  it('re-dispatches after restart with a fresh attempt, retains its receipt, and rejects the prior plan on a no-result retry', async () => {
    const result = await fixture('claude', [
      { kind: 'structured', finalStructuredResult: output() },
      { kind: 'chat', output: 'the restarted attempt omitted its structured result' },
    ], 1);
    const firstPlan = JSON.parse(await readFile(join(result.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8')) as {
      attemptId: string;
    };
    const firstLedger = await readKickbackLedger(result.root);

    const restarted = new Conductor({
      stateFilePath: join(result.root, '.pipeline', 'conduct-state.json'),
      stepRunner: result.runner,
      events: new ConductorEventEmitter(),
      projectRoot: result.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config: result.config,
    });
    (restarted as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...result.state };
    const restartedOutcome = await (restarted as unknown as {
      planRemediation(
        state: ConductState,
        steps: typeof ALL_STEPS,
        context: string,
        source: { source: string; evidence: readonly { gate: string; evidenceFile: string }[] },
      ): Promise<{ kind: string; reason?: string }>;
    }).planRemediation(
      result.state,
      ALL_STEPS,
      'PRD audit reported repairable criteria after restart.',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(result.provider.invocationCount).toBe(2);
    expect(result.provider.calls[1]?.sessionId).not.toBe(result.provider.calls[0]?.sessionId);
    expect(restartedOutcome).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('structured-result-missing'),
    });
    expect(JSON.parse(await readFile(join(result.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8'))).toMatchObject({
      attemptId: firstPlan.attemptId,
    });
    await expect(readKickbackLedger(result.root)).resolves.toMatchObject({
      pendingRepair: firstLedger.pendingRepair,
    });

    const budgets = [{
      gate: 'prd_audit' as const,
      lapCap: 2,
      growthCap: 2, authoredSource: 'plan' as const,
      growth: { authored: 8, added: 0, byGate: {}, remaining: 2 },
    }];
    await expect(settlePendingRepair(result.root, budgets)).resolves.toEqual({ kind: 'settled' });
    await expect(settlePendingRepair(result.root, budgets)).resolves.toEqual({ kind: 'none' });
    await expect(readKickbackLedger(result.root)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 1 } },
      growth: { added: 1, byGate: { prd_audit: 1 } },
    });
  });

  // Covers: task:20
  it.each([
    ['timeout', { kind: 'timeout' as const }],
    ['throw', { kind: 'throw' as const, error: new Error('fixture threw') }],
  ])('retries a %s gap-plan dispatch with a fresh session', async (_name, failure) => {
    const result = await fixture('claude', [failure, { kind: 'structured', finalStructuredResult: output() }]);

    expect(result.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(result.provider.invocationCount).toBe(2);
    expect(result.provider.calls[1]?.sessionId).not.toBe(result.provider.calls[0]?.sessionId);
  });

  // Covers: task:23
  it('returns the final named mechanical fault when every typed gap-plan attempt is unusable', async () => {
    const result = await fixture('claude', [
      { kind: 'chat', output: 'first attempt omitted structured output' },
      { kind: 'throw', error: new Error('last planner fault') },
    ], 2);

    expect(result.provider.invocationCount).toBe(2);
    expect(result.outcome).toMatchObject({ kind: 'none', reason: expect.stringContaining('last planner fault') });
  });

  // Covers: task:20
  it.each([
    ['authentication', { authFailure: true }],
    ['rate limit', { rateLimited: true }],
    ['model unavailable', { modelUnavailable: true }],
  ] as const)('keeps %s handling ahead of missing-plan diagnostics', async (_name, condition) => {
    const result = await fixture('claude', [{
      kind: 'provider-condition',
      result: { success: false, output: 'provider condition', exitCode: 1, ...condition },
    }]);

    expect(result.outcome).toMatchObject({ kind: 'none' });
    expect(result.blockedReasons).not.toContain('remediation planner produced no current typed plan');
    expect(result.blockedReasons).not.toContain('structured-result-missing');
  });

  // Covers: task:21
  it('halts mechanically for a gap-plan provider without native-schema capability before retrying', async () => {
    const result = await fixture('claude', undefined, 2, { nativeSchema: false });

    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /candidate set \[claude\].*nativeSchemaCapability\.nativeOutputSchema/s,
    );
    await expect(readFile(join(result.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:21, task:rem-prd-audit-rem-prd-audit-s1-1-1
  it('halts mechanically for a bounded remediation projection input fault before provider dispatch', async () => {
    const oversizedTask = 'x'.repeat(600);
    const oversizedPlan = plan.replace('Authored task 1', oversizedTask);
    const result = await fixture('codex', undefined, 2, {
      planText: oversizedPlan,
      remediationProjectionLimitOverrides: { tasksBytes: 512 },
    });

    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /source prd-audit, dimension tasks \(actual \d+, limit \d+\)/,
    );
    await expect(readFile(join(result.root, REMEDIATION_TYPED_PLAN_PATH), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:8
  it('halts before dispatch when the rendered gap-plan payload exceeds its total limit', async () => {
    const result = await fixture('codex', undefined, 2, {
      remediationProjectionLimitOverrides: { totalBytes: 1 },
    });

    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /dimension total \(actual \d+, limit 1\)/,
    );
  });

  // Covers: task:4
  it('halts mechanically without invoking remediate when every history write fails', async () => {
    const result = await fixture('codex', undefined, 2, {
      remediationProjectionDependencies: {
        filesystem: { mkdir, rename, writeFile: async () => { throw new Error('fixture history writer failed'); } },
      },
    });
    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/history snapshot.*fixture history writer failed/);
  });

  // Covers: task:4
  it('does not invoke remediate when the resolved history write fails', async () => {
    const result = await fixture('codex', undefined, 2, {
      remediationProjectionDependencies: {
        filesystem: {
          mkdir, rename,
          writeFile: async (path, data, options) => {
            if (String(path).includes('.resolved.json')) throw new Error(`fixture denied ${path}`);
            return writeFile(path, data, options);
          },
        },
      },
    });
    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
  });

  // Covers: task:4
  it('halts before history writing when the kickback ledger is corrupt', async () => {
    const result = await fixture('codex', undefined, 2, { corruptKickbackLedger: true });
    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('kickback ledger');
    await expect(readdir(join(result.root, '.pipeline', 'remediation-history'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:5
  it('halts needs-human without history when the as-built case store is unreadable', async () => {
    const result = await fixture('codex', [{ kind: 'structured', finalStructuredResult: asBuiltOutput() }], 2, {
      source: 'as-built', asBuiltRound: true, malformedCaseStore: true,
    });
    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/remediation case store.*unreadable/);
    await expect(readdir(join(result.root, '.pipeline', 'remediation-history'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:9
  it('uses preparation-fault causes for needs-human versus mechanical remediation halts', async () => {
    const unreadable = await fixture('codex', [{ kind: 'structured', finalStructuredResult: asBuiltOutput() }], 2, {
      source: 'as-built', asBuiltRound: true, malformedCaseStore: true,
    });
    expect(unreadable.outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
    const mechanical = await fixture('codex', undefined, 2, {
      remediationProjectionDependencies: { filesystem: { mkdir, rename, writeFile: async () => { throw new Error('history failure'); } } },
    });
    expect(mechanical.provider.invocationCount).toBe(0);
    expect(mechanical.outcome).toMatchObject({ kind: 'halt', haltClass: 'mechanical' });
  });

  // Covers: task:9
  it('keeps input preparation faults mechanical', async () => {
    const oversized = await fixture('codex', undefined, 2, {
      planText: plan.replace('Authored task 1', 'x'.repeat(600)), remediationProjectionLimitOverrides: { tasksBytes: 1 },
    });
    const ledger = await fixture('codex', undefined, 2, { corruptKickbackLedger: true });
    expect(oversized.outcome).toMatchObject({ kind: 'halt', haltClass: 'mechanical' });
    expect(ledger.outcome).toMatchObject({ kind: 'halt', haltClass: 'mechanical' });
  });

  // Covers: task:9
  it('classes a missing as-built typed verdict as mechanical', async () => {
    const result = await fixture('codex', undefined, 2, { source: 'as-built' });
    expect(result.outcome).toMatchObject({ kind: 'halt', haltClass: 'mechanical' });
    expect(result.provider.invocationCount).toBe(0);
  });

  // Covers: task:21
  it('retains the build-stall question verbatim on a mechanical capability halt', async () => {
    const question = 'Which verified input should unblock this stalled build?';
    const result = await fixture('claude', undefined, 2, {
      nativeSchema: false,
      source: 'build-stall',
      evidenceFile: '.pipeline/build-stall-question.md',
      stallQuestion: question,
    });

    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(question);
  });

  // Covers: task:rem-as-built-rem-as-built-ab2-1
  it('halts through the remediation validator before provider dispatch for unreadable finish evidence', async () => {
    const result = await fixture('codex', undefined, 2, {
      source: 'finish-verification',
      evidenceFile: '.pipeline/test-failures.md',
      evidenceDirectory: true,
    });

    expect(result.outcome).toMatchObject({ kind: 'halt' });
    expect(result.provider.invocationCount).toBe(0);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /source finish test failures: untyped evidence is unreadable: \.pipeline\/test-failures\.md/,
    );
  });
});
