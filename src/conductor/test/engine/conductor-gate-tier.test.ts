// Covers: task:2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const directories: string[] = [];

const AS_BUILT_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'test fixture' },
  planGap: { enabled: true, reason: 'test fixture' },
  adrCompliance: { enabled: false, reason: 'test fixture' },
  diagramDrift: { enabled: false, reason: 'test fixture' },
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runValidationKickback(
  tier: ConductState['complexity_tier'],
  manualTest: 'PASS' | 'FAIL' = 'PASS',
) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-gate-tier-'));
  directories.push(projectRoot);
  const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeState(stateFilePath, {
    ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])),
    manual_test: 'pending', prd_audit: 'pending', architecture_review_as_built: 'pending',
    finish: 'pending', track: 'product', complexity_tier: tier,
  } as ConductState);
  await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'specs'), { recursive: true });
  const planPath = join(projectRoot, '.docs', 'plans', 'active.md');
  await Promise.all([
    writeFile(planPath, '### Task 1: Repair the validation gap\n\n**Criterion:** S1.1\n'),
    writeFile(join(projectRoot, '.docs', 'stories', 'active.md'), '## Story 1\n\n### Happy Path\n\n- The repair succeeds.\n'),
    writeFile(join(projectRoot, '.docs', 'specs', 'active.md'), '## Functional Requirements\n\n- **FR-1:** The repair succeeds.\n'),
    writeFile(join(projectRoot, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath })),
  ]);

  const events = new ConductorEventEmitter();
  const observed: ConductorEvent[] = [];
  events.on('gate_verdict', (event) => { observed.push(event); });
  events.on('kickback', (event) => { observed.push(event); });
  const runner: StepRunner = {
    run: async (step, _state, options) => {
      if (step === 'manual_test') {
        await writeFile(
          join(projectRoot, '.pipeline', 'manual-test-results.md'),
          `# Results\n\n| Story | Result |\n|--|--|\n| s1 | ${manualTest} |\n`,
        );
      } else if (step === 'prd_audit') {
        await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | MISSING | impl-gap | feature.ts:1 | no |\n');
      } else if (step === 'architecture_review_as_built') {
        await persistAsBuiltVerdict(projectRoot, {
          version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [],
        }, { attemptId: options?.runId ?? 'test-run', codeStamp: null, policy: AS_BUILT_POLICY });
      } else if (step === 'build') {
        return { success: false, error: 'stop after kickback observation' };
      }
      return { success: true };
    },
  };
  const conductor = new Conductor({
    projectRoot, stateFilePath, stepRunner: runner, events, fromStep: 'manual_test',
    mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1,
  });
  (conductor as any).planRemediation = async () => ({
    kind: 'route', target: 'build', evidence: 'validated gap', hint: 'repair the gap',
  });
  await conductor.run();
  return observed;
}

describe('Conductor gate tier stamping', () => {
  it('stamps validation-tail verdicts and gate kickbacks with the seeded tier', async () => {
    const events = await runValidationKickback('S');
    const verdict = events.find((event): event is Extract<ConductorEvent, { type: 'gate_verdict' }> => event.type === 'gate_verdict' && event.step === 'prd_audit');
    const kickback = events.find((event): event is Extract<ConductorEvent, { type: 'kickback' }> => event.type === 'kickback' && event.from === 'prd_audit' && event.to === 'build');

    expect(verdict).toMatchObject({ step: 'prd_audit', satisfied: false, reason: expect.any(String), tier: 'S' });
    expect(kickback).toMatchObject({ from: 'prd_audit', to: 'build', count: expect.any(Number), tier: 'S' });
  });

  it('leaves validation-tail verdicts and gate kickbacks tierless when the state has no tier', async () => {
    const events = await runValidationKickback(undefined, 'FAIL');
    const verdict = events.find((event): event is Extract<ConductorEvent, { type: 'gate_verdict' }> => event.type === 'gate_verdict' && event.step === 'manual_test');
    const kickback = events.find((event): event is Extract<ConductorEvent, { type: 'kickback' }> => event.type === 'kickback' && event.from === 'manual_test' && event.to === 'build');

    expect(verdict).toBeDefined();
    expect(kickback).toBeDefined();
    expect(Object.hasOwn(verdict!, 'tier')).toBe(false);
    expect(Object.hasOwn(kickback!, 'tier')).toBe(false);
  });

  it('keeps persisted rebase reopen kickbacks tierless in a tiered run', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-rebase-tier-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const state = { ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])), complexity_tier: 'M' } as ConductState;
    await writeState(stateFilePath, state);
    await writeVerdict(projectRoot, 'rebase', { satisfied: true, checkedAt: 1 });
    await writeVerdict(projectRoot, 'build', {
      satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'rebase changed build inputs' },
    });
    const events = new ConductorEventEmitter();
    const observed: ConductorEvent[] = [];
    events.on('kickback', (event) => { observed.push(event); });
    const conductor = new Conductor({
      projectRoot, stateFilePath, stepRunner: { run: async () => ({ success: true }) }, events, verifyArtifacts: true,
    });
    (conductor as any).lastRebaseOutcome = { kind: 'changed', reason: 'test rebase change' };

    await (conductor as any).advanceTail(
      { name: 'rebase' }, state, new Map(), ALL_STEPS, (name: StepName) => ALL_STEPS.findIndex((step) => step.name === name),
    );

    const kickback = observed.find((event) => event.type === 'kickback' && event.from === 'rebase' && event.to === 'build');
    expect(kickback).toMatchObject({ from: 'rebase', to: 'build', count: 1 });
    expect(Object.hasOwn(kickback!, 'tier')).toBe(false);
  });
});
