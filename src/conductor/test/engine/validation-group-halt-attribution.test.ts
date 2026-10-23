// Covers: task:2, task:3, task:4, task:5
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
    kind: 'PLAN_GAP' | 'DESIGN' | 'invalid' | 'REMEDIABLE' | 'APPROVED' | 'NO_VERDICT' | 'MECHANICAL' | 'PERMISSION' | 'AUTH_PARK' | 'CACHED_TRIAL' | 'MANUAL_NO_VERDICT',
    route: 'terminal' | 'planner-halt' | 'projection-refusal' | 'no-op' = 'terminal',
    entry: 'manual_test' | 'prd_audit' = 'manual_test',
    options: { manualFail?: boolean; acceptPrdAudit?: boolean } = {},
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
        fromStep: entry, mode: 'auto', daemon: true, verifyArtifacts: route !== 'projection-refusal', maxRetries: 1,
        stepRunner: { run: vi.fn(async (step: StepName, _state, runOptions) => {
          if (step === 'manual_test') {
            if (kind === 'MANUAL_NO_VERDICT') return { success: false, output: 'fixture manual dispatch lost' };
            await writeFile(join(root, '.pipeline/manual-test-results.md'), options.manualFail
              ? '# Results\n\n| Story | Result |\n|--|--|\n| S1 | FAIL |\n'
              : '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n');
          } else if (step === 'build') {
            await writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));
          } else if (step === 'prd_audit') {
            await persistPrdAuditVerdict(root, { complete: true, judgment: {
              version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS', evidence: 'fixture', rationale: 'fixture', requirementAssociations: [], evidenceTaskIds: [] }], noOwnerObservations: [],
            }, diagnostics: [], recordedDispositions: [] }, { attemptId: runOptions?.runId ?? 'prd', codeStamp: 'fixture' });
          } else if (step === 'architecture_review_as_built') {
            if (kind === 'NO_VERDICT') return { success: false, output: 'fixture dispatch lost' };
            if (kind === 'MECHANICAL') {
              return { success: false, asBuiltFault: { kind: 'input', reason: 'fixture mechanical fault' } };
            }
            if (kind === 'PERMISSION') return {
              success: false, permissionDenied: true, actualProvider: 'codex', output: 'fixture permission denied',
              authentication: { provider: 'codex', source: 'cached-login', state: 'ready' },
            };
            if (kind === 'AUTH_PARK' || kind === 'CACHED_TRIAL') return {
              success: false, authFailure: true,
              authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
            };
            if (kind === 'invalid') {
              await writeFile(join(root, '.pipeline/architecture-review-as-built.json'), '{"invalid":true}');
            } else if (kind === 'PLAN_GAP') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: false, affectedOutcome: 'FR-1' }, { attemptId: runOptions?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else if (kind === 'REMEDIABLE') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Add the missing guard.' }], violations: 'A repair is needed.', resolution: 'Add the guard.' }, { attemptId: runOptions?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else if (kind === 'APPROVED') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [] }, { attemptId: runOptions?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ class: 'DESIGN', summary: 'Choose a boundary.' }], violations: 'A decision is required.', resolution: 'Choose a boundary.' }, { attemptId: runOptions?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            }
          }
          return { success: true };
        }) },
      });
      vi.spyOn(conductor as any, 'verdictDispatchHandshake').mockResolvedValue(undefined);
      if (options.acceptPrdAudit) {
        vi.spyOn(conductor as any, 'routeCurrentPrdAudit').mockResolvedValue({ kind: 'record' });
      }
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
      if (kind === 'AUTH_PARK') {
        vi.spyOn(conductor as any, 'parkOnAuthFailure').mockResolvedValue({
          disposition: 'halt', haltReason: 'fixture authentication park',
        });
      }
      if (kind === 'CACHED_TRIAL') {
        vi.spyOn(conductor as any, 'parkOnAuthFailure').mockResolvedValue({
          disposition: 'trial-required',
          probeFailure: { kind: 'unparseable-output', facts: { parserRejection: 'fixture' } },
        });
      }
      await conductor.run();
    } finally {
      persister.stop();
    }
    return persistedEvents(await readFile(path, 'utf8'));
  }

  async function runPrdAuditGroup(
    route: Record<string, unknown>,
    options: {
      incompleteAudit?: boolean;
      plannerFault?: boolean;
      spentAllowance?: boolean;
      noOp?: boolean;
      manualFail?: boolean;
      daemon?: boolean;
    } = {},
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
        fromStep: 'manual_test', mode: 'auto', daemon: options.daemon ?? true, verifyArtifacts: true, maxRetries: 1,
        stepRunner: { run: vi.fn(async (step: StepName, _state, runOptions) => {
          if (step === 'manual_test') {
            await writeFile(join(root, '.pipeline/manual-test-results.md'), options.manualFail
              ? '# Results\n\n| Story | Result |\n|--|--|\n| S1 | FAIL |\n'
              : '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n');
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
      if (options.noOp) {
        vi.spyOn(conductor as any, 'planRemediation').mockResolvedValue({
          kind: 'route', target: 'build', hint: 'fixture unchanged prd gap', evidence: 'prd fixture',
        });
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

  it('attributes an as-built no-verdict group halt to the member that exhausted retries', async () => {
    const persisted = await runTerminalAsBuiltGroup('NO_VERDICT');
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt', step: 'architecture_review_as_built',
    }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), 'needs-human', expect.anything(), undefined,
      'architecture_review_as_built',
    ]));
  });

  it('attributes a member mechanical fault while keeping its halt unrecorded', async () => {
    const persisted = await runTerminalAsBuiltGroup('MECHANICAL');
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt', step: 'architecture_review_as_built',
    }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), 'mechanical', expect.anything(), undefined,
      'architecture_review_as_built',
    ]));
  });

  it.each([
    ['permission denial', 'PERMISSION'],
    ['cached-login recovery-trial failure', 'CACHED_TRIAL'],
    ['authentication park', 'AUTH_PARK'],
  ] as const)('attributes a member %s halt to that member', async (_name, kind) => {
    const persisted = await runTerminalAsBuiltGroup(kind);
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt', step: 'architecture_review_as_built',
    }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), 'needs-human', expect.anything(), undefined,
      'architecture_review_as_built',
    ]));
  });

  it('attributes a manual_test no-verdict to manual_test when prd_audit entered the group', async () => {
    const { conductor, events } = await conductorAtValidationGroupEntry();
    const halts: Array<{ step?: string }> = [];
    events.on('loop_halt', (event) => { halts.push(event); });
    (conductor as any).dispatchingStep = 'prd_audit';
    await (conductor as any).writeHaltMarker('manual fixture no-verdict\n', 'needs-human', 'manual_test');
    await (conductor as any).emitLoopHalt('manual fixture no-verdict', undefined, 'manual_test');
    expect(halts).toEqual([expect.objectContaining({ step: 'manual_test' })]);
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.any(String), 'needs-human', expect.anything(), undefined, 'manual_test',
    ]));
  });

  it('attributes a prd_audit gap kickback-to-build no-op escalation to prd_audit', async () => {
    const persisted = await runPrdAuditGroup({ kind: 'none' }, { incompleteAudit: true, noOp: true });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String), expect.stringContaining('prd_audit kickback-to-build no-op'), 'needs-human',
      expect.anything(), undefined, 'prd_audit',
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

  function validationRefusals(events: Array<Record<string, unknown>>): string[] {
    return events
      .filter((event) => event.type === 'step_refused' && event.kind === 'validation-verdict')
      .map((event) => event.step as string)
      .sort();
  }

  it('attributes a generic multi-member halt to manual_test and refuses each failing member', async () => {
    const persisted = await runPrdAuditGroup({ kind: 'none' }, {
      incompleteAudit: true, manualFail: true, daemon: false,
    });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'manual_test' }));
    expect(validationRefusals(persisted)).toEqual(['manual_test', 'prd_audit']);
  });

  it('attributes a mixed-gap planner halt to the first gap member and refuses only gap members', async () => {
    const persisted = await runPrdAuditGroup({ kind: 'none' }, {
      incompleteAudit: true, plannerFault: true,
    });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(validationRefusals(persisted)).toEqual(['prd_audit']);
  });

  it('attributes a merged manual-test planner halt to the first gap member and refuses manual_test plus gaps', async () => {
    const persisted = await runPrdAuditGroup({ kind: 'none' }, {
      incompleteAudit: true, manualFail: true, plannerFault: true,
    });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'prd_audit' }));
    expect(validationRefusals(persisted)).toEqual(['manual_test', 'prd_audit']);
  });

  it('refuses manual_test beside a terminal as-built verdict without refusing passing siblings', async () => {
    const persisted = await runTerminalAsBuiltGroup('DESIGN', 'terminal', 'manual_test', {
      manualFail: true, acceptPrdAudit: true,
    });
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'loop_halt', step: 'architecture_review_as_built',
    }));
    expect(validationRefusals(persisted)).toEqual(['architecture_review_as_built', 'manual_test']);
  });

  it('refuses exactly the single failing member', async () => {
    const persisted = await runPrdAuditGroup({ kind: 'record' }, { manualFail: true, daemon: false });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'loop_halt', step: 'manual_test' }));
    expect(validationRefusals(persisted)).toEqual(['manual_test']);
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
