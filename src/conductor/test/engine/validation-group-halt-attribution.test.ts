// Covers: task:2
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

import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const VALIDATION_GROUP_PREREQS = {
  feature_desc: 'validation-group-halt-attribution',
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
  architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
  build: 'done', build_review: 'done', test_suite: 'done', rebase: 'done', finish: 'done',
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

  async function runTerminalAsBuiltGroup(kind: 'PLAN_GAP' | 'DESIGN' | 'invalid', prdGap = false) {
    const root = await mkdtemp(join(tmpdir(), 'validation-group-halt-attribution-group-'));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, '.pipeline'), { recursive: true }),
      mkdir(join(root, '.docs', 'specs'), { recursive: true }),
      mkdir(join(root, '.docs', 'stories'), { recursive: true }),
    ]);
    await Promise.all([
      writeState(join(root, '.pipeline/conduct-state.json'), VALIDATION_GROUP_PREREQS),
      writeFile(join(root, '.docs/specs/validation-group-halt-attribution.md'), '## Functional Requirements\n\nFR-1\n'),
      writeFile(join(root, '.docs/stories/validation-group-halt-attribution.md'), '## Story 1\n\n**Requirements:** FR-1\n'),
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
        fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1,
        stepRunner: { run: vi.fn(async (step: StepName, _state, options) => {
          if (step === 'manual_test') {
            await writeFile(join(root, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| S1 | PASS |\n');
          } else if (step === 'prd_audit') {
            await persistPrdAuditVerdict(root, { complete: true, judgment: {
              version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: prdGap ? 'FIXABLE' : 'PASS', evidence: 'fixture', rationale: 'fixture', requirementAssociations: [], evidenceTaskIds: [] }], noOwnerObservations: [],
            }, diagnostics: [], recordedDispositions: [] }, { attemptId: options?.runId ?? 'prd', codeStamp: 'fixture' });
          } else if (step === 'architecture_review_as_built') {
            if (kind === 'invalid') {
              await writeFile(join(root, '.pipeline/architecture-review-as-built.json'), '{"invalid":true}');
            } else if (kind === 'PLAN_GAP') {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'PLAN_GAP', reachability: [], driftNotes: [], outcomeDelivered: false, affectedOutcome: 'FR-1' }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            } else {
              await persistAsBuiltVerdict(root, { version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [], findings: [{ class: 'DESIGN', summary: 'Choose a boundary.' }], violations: 'A decision is required.', resolution: 'Choose a boundary.' }, { attemptId: options?.runId ?? 'as-built', codeStamp: null, policy: AS_BUILT_POLICY });
            }
          }
          return { success: true };
        }) },
      });
      vi.spyOn(conductor as any, 'verdictDispatchHandshake').mockResolvedValue(undefined);
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
    'terminal PLAN_GAP',
    'terminal DESIGN',
    'terminal invalid verdict',
    'remediation planner halt',
    'kickback no-op escalation',
    'findings projection refusal',
  ])('uses the as-built member for %s', async () => {
    const { conductor, events } = await conductorAtValidationGroupEntry();
    const halts: Array<{ step?: string }> = [];
    events.on('loop_halt', (event) => { halts.push(event); });

    await (conductor as any).writeHaltMarker(
      'as-built validator ended this group\n',
      'needs-human',
      'architecture_review_as_built',
    );
    await (conductor as any).emitLoopHalt(
      'as-built validator ended this group',
      undefined,
      'architecture_review_as_built',
    );

    expect(halts).toEqual([expect.objectContaining({ step: 'architecture_review_as_built' })]);
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String),
      'as-built validator ended this group\n',
      'needs-human',
      expect.anything(),
      undefined,
      'architecture_review_as_built',
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
