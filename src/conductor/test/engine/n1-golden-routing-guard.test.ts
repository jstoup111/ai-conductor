// Covers: task:3, task:18
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const uuidState = vi.hoisted(() => ({ counter: 0 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: () => `00000000-0000-4000-8000-${String(uuidState.counter++).padStart(12, '0')}`,
  };
});

vi.mock('../../src/engine/protected-artifact-seal.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/protected-artifact-seal.js')>(),
  verifyProtectedArtifactSeal: vi.fn(async () => ({ ok: true, seal: undefined, selfAmendments: [] })),
}));

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { loadConfig } from '../../src/engine/config.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { persistFixtureProjectedRemediationPlan } from './remediation-plan-fixtures.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  CELLS,
  RECORD,
  expectGolden,
  normalizeGolden,
  readAndNormalize,
  withGitArgvShim,
} from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const UNSLICED_CELLS = CELLS.filter((cell) => cell.name === 'flag-off-unsliced' || cell.name === 'flag-on-unsliced');
const ROUTING_REFS = ['routes', 'repairing', 'revalidate'] as const;
const ROUTED_EVENT_TYPES = new Set(['remediation_routed', 'remediation_rerouted', 'routed_repair_phase', 'child_revalidated']);

const STORY = `# Stories: n1-golden

## Story 1: Golden coverage

### Acceptance Criteria

- Given an N=1 feature, when a fix is needed, then it is repaired on the feature branch.
`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function assertNoRoutingRefArgv(argvLines: readonly (readonly string[])[]): void {
  const routingArg = argvLines.flat().find((argument) => ROUTING_REFS.some((part) =>
    argument.includes(`refs/conductor/n1-golden/${part}`),
  ));
  if (routingArg !== undefined) {
    throw new Error(`N=1 golden lap touched a routing ref: ${routingArg}`);
  }
}

async function runFixableLap(cell: typeof UNSLICED_CELLS[number]) {
  uuidState.counter = 0;
  const root = await mkdtemp(join(tmpdir(), `n1-golden-routing-${cell.name}-`));
  roots.push(root);
  const pipeline = join(root, '.pipeline');
  const planPath = join(root, '.docs', 'plans', 'n1-golden.md');
  const statePath = join(pipeline, 'conduct-state.json');
  const eventsPath = join(pipeline, 'events.jsonl');

  await Promise.all([
    mkdir(join(root, '.ai-conductor'), { recursive: true }),
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.docs', 'stories'), { recursive: true }),
    mkdir(pipeline, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml),
    writeFile(planPath, cell.planMd),
    writeFile(join(root, '.docs', 'stories', 'n1-golden.md'), STORY),
    writeFile(join(root, 'README.md'), '# n1-golden\n'),
    writeFile(join(root, '.gitignore'), '.pipeline/\n'),
  ]);
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-qm', 'init'], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
  });
  await execFile('git', ['checkout', '-qb', 'feat/daemon-n1-golden'], { cwd: root });
  const codeStamp = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

  const state = Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'skipped'])) as ConductState;
  for (const { name } of ALL_STEPS) {
    if (name === 'prd_audit') break;
    state[name] = 'done';
  }
  state.prd_audit = 'pending';
  state.complexity_tier = 'S';
  state.track = 'technical';
  state.feature_desc = 'n1-golden';
  await Promise.all([
    writeState(statePath, state),
    writeFile(join(pipeline, 'engine-state.json'), JSON.stringify({ activePlanPath: planPath })),
    writeFile(join(pipeline, 'task-status.json'), JSON.stringify({ tasks: [
      { id: '1', status: 'completed' },
      { id: '2', status: 'completed' },
      { id: '3', status: 'completed' },
    ] })),
  ]);

  const events = new ConductorEventEmitter();
  const persister = new EventPersister(eventsPath, events, { nowMs: () => 1_000 });
  persister.start();
  let remediationRecorded = false;
  const dispatched: string[] = [];
  const runner: StepRunner = {
    run: async (step, _state, options) => {
      dispatched.push(step);
      if (step === 'prd_audit') {
        await persistPrdAuditVerdict(root, {
          complete: true,
          judgment: {
            version: 'v1',
            criterionJudgments: [{
              criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
              evidence: 'src/feature.ts:1', rationale: 'Task 2 owns this fixture repair.',
              requirementAssociations: [], evidenceTaskIds: ['2'], ownerTaskId: '2',
            }],
            noOwnerObservations: [],
          },
          diagnostics: [], recordedDispositions: [],
        }, { attemptId: options?.runId ?? 'fixture-prd-audit', codeStamp });
      } else if (step === 'remediate') {
        await persistFixtureProjectedRemediationPlan(root, options, [{
          id: 'S1.1', disposition: 'build', category: null,
          rationale: 'Append a bounded repair for the task-two-owned finding.',
          tasks: [{ id: 'rem-prd-audit-s1.1', title: 'Repair the Task 2-owned golden finding' }],
        }]);
        remediationRecorded = true;
      } else {
        throw new Error(`unexpected dispatch after N=1 remediation rewind: ${step}`);
      }
      return { success: true };
    },
  };
  const config = await loadConfig(root);
  if (!config.ok) throw config.error;
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    fromStep: 'prd_audit',
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
    featureSlug: 'n1-golden',
    operatorParkBoundary: async () => remediationRecorded,
    // This fixture owns remediation routing, not the independent code-stamp
    // validity gate. Keep its typed verdict current without manufacturing a
    // code-validity history fixture.
    config: { ...config.config, gate_code_validity: { enabled: false } } as never,
  });

  try {
    let termination: unknown;
    const outcome = await withGitArgvShim(root, async () => { termination = await conductor.run(); });
    const ledgerPath = join(pipeline, 'kickback-ledger.json');
    const ledger = await readAndNormalize(ledgerPath, root).catch((error: NodeJS.ErrnoException) => {
      return Promise.all([
        readAndNormalize(statePath, root),
        readFile(join(pipeline, 'HALT'), 'utf8').catch(() => '<no halt>'),
      ]).then(([latestState, halt]) => {
        throw new Error(`N=1 FIXABLE lap did not write its ledger after ${dispatched.join(', ')} (${JSON.stringify(termination)}; halt ${halt.trim()}; state ${latestState}): ${error.message}`);
      });
    });
    return {
      branch: (await execFile('git', ['branch', '--show-current'], { cwd: root })).stdout.trim(),
      plan: normalizeGolden(await readFile(planPath, 'utf8'), root),
      ledger,
      state: await readAndNormalize(statePath, root),
      events: await readAndNormalize(eventsPath, root),
      gitArgv: outcome,
    };
  } finally {
    persister.stop();
  }
}

describe('N=1 golden remediation routing guard', () => {
  it.each(UNSLICED_CELLS)('matches the recorded N=1 FIXABLE lap goldens and emits no routed event for $name', async (cell) => {
    const lap = await runFixableLap(cell);

    expect(lap.branch).toBe('feat/daemon-n1-golden');
    await expectGolden(`${cell.name}-fixable-lap-plan`, lap.plan);
    await expectGolden(`${cell.name}-fixable-lap-kickback-ledger`, lap.ledger);
    await expectGolden(`${cell.name}-fixable-lap-conduct-state`, lap.state);
    await expectGolden(`${cell.name}-fixable-lap-events`, lap.events);
    assertNoRoutingRefArgv(lap.gitArgv);
    const eventTypes = lap.events.split('\n').filter(Boolean).map((line) => JSON.parse(line).type as string);
    expect(eventTypes.filter((type) => ROUTED_EVENT_TYPES.has(type))).toEqual([]);
  });

  it('self-tests the N=1 FIXABLE lap fixtures against a deleted recorded line', async () => {
    if (RECORD) return;
    const fixtureName = 'flag-off-unsliced-fixable-lap-plan';
    const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${fixtureName}.golden`);
    const fixture = await readFile(fixturePath, 'utf8');
    const altered = fixture.split('\n').filter((_, index) => index !== 2).join('\n').replace(/^<!-- Recorded from [a-f0-9]+ -->\n/, '');
    await expect(expectGolden(fixtureName, altered)).rejects.toThrow(`golden mismatch in ${fixtureName}: line`);
  });

  it('fails the N=1 routing guard when a fixture probes the repairing ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'n1-golden-routing-probe-'));
    roots.push(root);
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: root });
    const gitArgv = await withGitArgvShim(root, async () => {
      await execFile('git', ['rev-parse', '-q', '--verify', 'refs/conductor/n1-golden/repairing'], { cwd: root }).catch(() => undefined);
    });
    expect(() => assertNoRoutingRefArgv(gitArgv)).toThrow('N=1 golden lap touched a routing ref: refs/conductor/n1-golden/repairing');
  });
});
