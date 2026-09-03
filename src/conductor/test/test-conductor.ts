import {
  Conductor as ProductionConductor,
  type ConductorOptions,
} from '../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../src/engine/full-suite-evidence.js';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:test-conductor-current',
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

export const PASSING_FULL_SUITE_VERIFIER = {
  ensure: async () => ({ status: 'REUSED', evidence: PASS_EVIDENCE } as const),
  inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const),
};

/** Production conductor with the native aggregate gate satisfied by default. */
export class Conductor extends ProductionConductor {
  constructor(options: ConductorOptions) {
    const suppliedRunner = options.stepRunner;
    // Preserve prototype-supplied runner capabilities (for example,
    // DefaultStepRunner.resetSession and rebase conflict resolution). Object
    // spread copies only own enumerable properties, which silently strips
    // those methods from class-backed runners.
    const coverageAwareRunner = Object.create(suppliedRunner) as StepRunner;
    coverageAwareRunner.run = async (step, state, runOptions) => {
      const result = await suppliedRunner.run(step, state, runOptions);
      if (step === 'coverage_binding' && result.success) {
        const envelope = join(options.projectRoot, '.pipeline/coverage-binding.json');
        const exists = await access(envelope).then(() => true, () => false);
        if (!exists) {
          await mkdir(join(options.projectRoot, '.pipeline'), { recursive: true });
          await writeFile(envelope, JSON.stringify({
            version: 1, slug: 'test-feature', runId: 'test-run', status: 'disabled', entries: [],
          }));
        }
      }
      return result;
    };
    super({
      ...options,
      // Most conductor fixtures deliberately model their subject step and
      // leave unrelated default-off gates to the test harness.  Production's
      // runner writes this envelope itself; faithfully emulate that boundary
      // here so those fixtures continue to exercise their intended transition.
      stepRunner: coverageAwareRunner,
      fullSuiteVerifier: options.fullSuiteVerifier ?? PASSING_FULL_SUITE_VERIFIER,
    });
  }
}
