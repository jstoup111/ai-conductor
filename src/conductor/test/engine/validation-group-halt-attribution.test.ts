// Covers: task:2, task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const haltMarkerCalls = vi.hoisted((): unknown[][] => []);

vi.mock('../../src/engine/halt-marker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/halt-marker.js')>();
  return {
    ...actual,
    writeHaltMarker: async (...args: Parameters<typeof actual.writeHaltMarker>) => {
      haltMarkerCalls.push(args);
      return actual.writeHaltMarker(...args);
    },
  };
});

vi.mock('../../src/engine/pr-labels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/pr-labels.js')>();
  return { ...actual, makeProductionGit: () => async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
});

import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const VALIDATION_GROUP_PREREQS = {
  feature_desc: 'validation-group-halt-attribution',
  worktree_branch: 'feat/validation-group-halt-attribution',
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
  architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
  build: 'done', coverage_binding: 'done', build_review: 'skipped', test_suite: 'done', rebase: 'done', finish: 'done',
} as ConductState;

const AS_BUILT_POLICY = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

function persistedEvents(raw: string): Array<Record<string, unknown>> {
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('validation-group halt attribution', () => {
  const roots: string[] = [];

  afterEach(async () => {
    haltMarkerCalls.length = 0;
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function conductorAtValidationGroupEntry() {
    const root = await mkdtemp(join(tmpdir(), 'validation-group-halt-attribution-'));
    roots.push(root);
    const events = new ConductorEventEmitter();
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline/conduct-state.json'),
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      events,
      mode: 'auto',
      daemon: true,
    });
    // This is the fan-out's entry breadcrumb. The member override must win.
    (conductor as any).dispatchingStep = 'manual_test';
    return { conductor, events };
  }

  async function runTerminalAsBuiltGroup(
    kind: 'PLAN_GAP' | 'DESIGN' | 'invalid' | 'REMEDIABLE' | 'APPROVED',
    route: 'terminal' | 'planner-halt' | 'projection-refusal' | 'no-op' = 'terminal',
  ) {
    const root = await mkdtemp(join(tmpdir(), 'validation-group-halt-attribution-group-'));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, '.pipeline'), { recursive: true }),
      mkdir(join(root, '.docs', 'specs'), { recursive: true }),
      mkdir(join(root, '.docs', 'stories'), { recursive: true }),
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    ]);
    await Promise.all([
      writeState(join(root, '.pipeline/conduct-state.json'), VALIDATION_GROUP_PREREQS),
      writeFile(join(root, '.docs/specs/validation-group-halt-attribution.md'), '## Functional Requirements\n\nFR-1\n'),
      writeFile(join(root, '.docs/stories/validation-group-halt-attribution.md'), '## Story 1\n\n**Requirements:** FR-1\n'),
      writeFile(join(root, '.docs/plans/validation-group-halt-attribution.md'), '### Task 1: fixture\n\nDone when: fixture\n'),
      writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] })),
    ]);
    const events = new ConductorEventEmitter();
    const path = join(root, '.pipeline/events.jsonl');
    const persister = new EventPersister(path, events);
    persister.start();
    try {
      const conductor = new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline/conduct-state.json'),
        events,
        fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: route !== 'projection-refusal', maxRetries: 1,
        stepRunner: { run: vi.fn(async (step: StepName, _state, options) => {
          if (step === 'manual_test') {
            await writeFile(join(root, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n');
          } else if (step === 'build') {
            await writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));
          } else if (step === 'prd_audit') {
            await persistPrdAuditVerdict(root, { complete: true, judgment: {
              version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS', evidence: 'fixture', rationale: 'fixture', requirementAssociations: [], evidenceTaskIds: [] }], noOwnerObservations: [],
            }, diagnostics: [], recordedDispositions: [] }, { attemptId: options?.runId ?? 'prd', codeStamp: 'fixture' });
          } else if (step === 'architecture_review_as_built') {
            if (kind === 'invalid') {
              await writeFile(join(root, '.pipeline/architecture-review-as-built.json'), '{"invalid":true}');
            } else if (kind === 'PLAN_GAP') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: false, affectedOutcome: 'FR-1' }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else if (kind === 'REMEDIABLE') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Add the missing guard.' }], violations: 'A repair is needed.', resolution: 'Add the guard.' }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else if (kind === 'APPROVED') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [] }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ class: 'DESIGN', summary: 'Choose a boundary.' }], violations: 'A decision is required.', resolution: 'Choose a boundary.' }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            }
          }
          return { success: true };
        }) },
      });
      vi.spyOn(conductor as any, 'verdictDispatchHandshake').mockResolvedValue(undefined);
      if (route === 'planner-halt') {
        vi.spyOn(conductor as any, 'planRemediation').mockResolvedValue({ kind: 'halt', detail: 'planner requires a decision', haltClass: 'needs-human' });
      }
      if (route === 'no-op') {
        vi.spyOn(conductor as any, 'planRemediation').mockResolvedValue({
          kind: 'route', target: 'build', hint: 'repair the unchanged finding', evidence: 'as-built fixture',
        });
      }
      if (route === 'projection-refusal') {
        vi.spyOn(conductor as any, 'projectPendingAsBuiltRemediationFindings').mockResolvedValue('projection storage refused');
      }
      await conductor.run();
    } finally {
      persister.stop();
    }
    return persistedEvents(await readFile(path, 'utf8'));
  }

  async function runPrdAuditGroup(
    route: Record<string, unknown>,
    options: { incompleteAudit?: boolean; plannerFault?: boolean; spentAllowance?: boolean } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), 'validation-group-halt-attribution-prd-'));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, '.pipeline'), { recursive: true }),
      mkdir(join(root, '.docs', 'specs'), { recursive: true }),
      mkdir(join(root, '.docs', 'stories'), { recursive: true }),
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    ]);
    await Promise.all([
      writeState(join(root, '.pipeline/conduct-state.json'), VALIDATION_GROUP_PREREQS),
      writeFile(join(root, '.docs/specs/validation-group-halt-attribution.md'), '## Functional Requirements\n\nFR-1\n'),
      writeFile(join(root, '.docs/stories/validation-group-halt-attribution.md'), '## Story 1\n\n**Requirements:** FR-1\n'),
      writeFile(join(root, '.docs/plans/validation-group-halt-attribution.md'), '### Task 1: fixture\n\nDone when: fixture\n'),
      writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] })),
      ...(options.spentAllowance ? [writeFile(join(root, '.pipeline/kickback-ledger.json'), JSON.stringify({
        version: 1,
        gates: { prd_audit: { count: 0, cumulative: 0, laps: 1, effectiveLapCap: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 } },
      }))] : []),
    ]);
    const events = new ConductorEventEmitter();
    const path = join(root, '.pipeline/events.jsonl');
    const persister = new EventPersister(path, events);
    persister.start();
    try {
      const conductor = new Conductor({
        projectRoot: root, stateFilePath: join(root, '.pipeline/conduct-state.json'), events,
        fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1,
        stepRunner: { run: vi.fn(async (step: StepName, _state, runOptions) => {
          if (step === 'manual_test') {
            await writeFile(join(root, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n');
          } else if (step === 'prd_audit') {
            await persistPrdAuditVerdict(root, {
              complete: !options.incompleteAudit,
              judgment: { version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS', evidence: 'fixture', rationale: 'fixture', requirementAssociations: [], evidenceTaskIds: [] }], noOwnerObservations: [] },
              diagnostics: options.incompleteAudit ? ['fixture gap'] : [], recordedDispositions: [],
            }, { attemptId: runOptions?.runId ?? 'prd', codeStamp: 'fixture' });
          } else if (step === 'architecture_review_as_built') {
            await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [] }, { attemptId: runOptions?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
          }
          return { success: true };
        }) },
      });
      vi.spyOn(conductor as any, 'verdictDispatchHandshake').mockResolvedValue(undefined);
      vi.spyOn(conductor as any, 'routeCurrentPrdAudit').mockResolvedValue(route);
      if (options.plannerFault) {
        vi.spyOn(conductor as any, 'planRemediation').mockResolvedValue({ kind: 'halt', detail: 'planner fault', haltClass: 'needs-human' });
      }
      await conductor.run();
    } finally {
      persister.stop();
    }
    return persistedEvents(await readFile(path, 'utf8'));
  }

  it.each(['PLAN_GAP', 'DESIGN', 'invalid'] as const)(
    'attributes real validation-group terminal %s verdicts to as-built, including concurrent PRD gaps',
    async (kind) => {
      const persisted = await runTerminalAsBuiltGroup(kind);
      expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'architecture_review_as_built' }));
      expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
        expect.any(String), expect.any(String), expect.any(String), expect.anything(), undefined,
        'architecture_review_as_built',
      ]));
    },
  );

  it.each([
    ['remediable planner halt', 'REMEDIABLE', 'planner-halt'],
    ['all-green findings projection refusal', 'APPROVED', 'projection-refusal'],
  ] as const)('attributes the real %s exit to as-built', async (_name, kind, route) => {
    const persisted = await runTerminalAsBuiltGroup(kind, route);
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'architecture_review_as_built' }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), expect.any(String), expect.anything(), undefined,
      'architecture_review_as_built',
    ]));
  });

  it('attributes a real two-round as-built kickback-to-build no-op escalation to as-built', async () => {
    const persisted = await runTerminalAsBuiltGroup('REMEDIABLE', 'no-op');
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt', step: 'architecture_review_as_built',
    }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.stringContaining('as-built architecture review kickback-to-build no-op'),
      'kickback-cap', expect.anything(), undefined, 'architecture_review_as_built',
    ]));
  });

  it.each([
    ['projection', { kind: 'projection-halt', reason: 'projection refused' }],
    ['plan-gap', { kind: 'plan-gap-halt', route: { detail: 'plan gap', haltClass: 'plan-gap' } }],
    ['over-scope', { kind: 'over-scope-halt', route: { detail: 'over scope', haltClass: 'over-scope', undecided: [], refused: [] } }],
  ])('attributes real prd_audit %s group halts to prd_audit', async (_name, route) => {
    const persisted = await runPrdAuditGroup(route);
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), expect.any(String), expect.anything(), undefined, 'prd_audit',
    ]));
    expect(persisted).not.toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'architecture_review_as_built' }));
  });

  it('attributes a real refused-over-scope planner fault group halt to prd_audit', async () => {
    const persisted = await runPrdAuditGroup({
      kind: 'over-scope-refusal-rework', route: { detail: 'refused scope', refused: [], refusals: [] },
    }, { incompleteAudit: true, plannerFault: true });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), expect.any(String), expect.anything(), undefined, 'prd_audit',
    ]));
  });

  it('attributes a real refused-over-scope spent-allowance group halt to prd_audit', async () => {
    const persisted = await runPrdAuditGroup({
      kind: 'over-scope-refusal-rework', route: { detail: 'refused scope', refused: [], refusals: [] },
    }, { incompleteAudit: true, spentAllowance: true });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), expect.any(String), expect.anything(), undefined, 'prd_audit',
    ]));
  });

  it('keeps a non-group BUILD halt attributed to build', async () => {
    const { conductor, events } = await conductorAtValidationGroupEntry();
    const halts: Array<{ step?: string }> = [];
    events.on('loop_halt', (event) => { halts.push(event); });
    (conductor as any).dispatchingStep = 'build';

    await (conductor as any).writeHaltMarker('BUILD failed\n', 'needs-human');
    await (conductor as any).emitLoopHalt('BUILD failed');

    expect(halts).toEqual([expect.objectContaining({ step: 'build' })]);
    expect(haltMarkerCalls.at(-1)).toEqual(expect.arrayContaining([
      expect.any(String), 'BUILD failed\n', 'needs-human', expect.anything(), undefined, undefined,
    ]));
  });
});
