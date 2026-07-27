import {
  Conductor as ProductionConductor,
  type ConductorOptions,
} from '../src/engine/conductor.js';
import type { FullSuitePassEvidence } from '../src/engine/full-suite-evidence.js';

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
    super({
      ...options,
      fullSuiteVerifier: options.fullSuiteVerifier ?? PASSING_FULL_SUITE_VERIFIER,
    });
  }
}
