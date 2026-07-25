import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import type { FullSuiteVerifierResult } from '../../src/engine/full-suite-verifier.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:current-test-inputs',
  categoryFingerprints: {
    additional_inputs: 'sha256:additional-inputs',
    dependencies: 'sha256:dependencies',
    environment: 'sha256:environment',
    migrations: 'sha256:migrations',
    project_config: 'sha256:project-config',
    source: 'sha256:source',
    test_infrastructure: 'sha256:test-infrastructure',
    tests: 'sha256:tests',
  },
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-07-25T17:00:00.000Z',
  endedAt: '2026-07-25T17:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'all tests passed\n',
  stderr: '',
};

const FRONT_DONE: ConductState = {
  complexity_tier: 'M',
  feature_desc: 'full-suite gate integration',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  coherence_check: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
  build: 'done',
  build_review: 'done',
};

describe('test_suite native gate loop', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'test-suite-gate-loop-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeState(stateFilePath, { ...FRONT_DONE });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('holds every SHIP validator until native verification passes, then advances to manual_test', async () => {
    const timeline: string[] = [];
    let releasePass!: (result: FullSuiteVerifierResult) => void;
    const pendingPass = new Promise<FullSuiteVerifierResult>((resolve) => {
      releasePass = resolve;
    });
    const ensure = vi.fn(async () => {
      timeline.push('test_suite');
      return pendingPass;
    });
    const inspect = vi.fn(async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const));
    const runner: StepRunner = {
      run: async (step: StepName) => {
        timeline.push(step);
        if (step === 'wiring_check') {
          await writeFile(
            join(projectRoot, '.pipeline/wiring-evidence.json'),
            JSON.stringify({
              schema: 1,
              base: 'base-sha',
              head: 'head-sha',
              layer2: { applicable: false, reason: 'no TypeScript project' },
              waivers: [],
              tasks: [],
            }),
          );
        }
        if (step === 'manual_test') return { success: false, output: 'stop after ordering proof' };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      fromStep: 'wiring_check',
      maxRetries: 1,
      verifyArtifacts: true,
      fullSuiteVerifier: { ensure, inspect },
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    expect(timeline).toEqual(['wiring_check', 'test_suite']);
    expect(timeline).not.toContain('manual_test');
    expect(timeline).not.toContain('prd_audit');
    expect(timeline).not.toContain('architecture_review_as_built');

    releasePass({
      status: 'EXECUTED',
      freshness: { status: 'STALE', reason: 'missing' },
      evidence: PASS_EVIDENCE,
    });
    await run;

    expect(timeline.slice(0, 2)).toEqual(['wiring_check', 'test_suite']);
    expect(timeline.indexOf('manual_test')).toBeGreaterThan(timeline.indexOf('test_suite'));
    expect(timeline.slice(2).sort()).toEqual([
      'architecture_review_as_built',
      'manual_test',
      'prd_audit',
    ]);
    expect(inspect).toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});
