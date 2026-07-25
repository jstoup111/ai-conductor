import { describe, expect, it } from 'vitest';

const PASS_EVIDENCE = {
  version: 3 as const,
  outcome: 'PASS' as const,
  reason: 'exit_zero' as const,
  fingerprint: 'sha256:canonical-proof',
  categoryFingerprints: {
    additional_inputs: 'category:additional_inputs',
    dependencies: 'category:dependencies',
    environment: 'category:environment',
    migrations: 'category:migrations',
    project_config: 'category:project_config',
    source: 'category:source',
    test_infrastructure: 'category:test_infrastructure',
    tests: 'category:tests',
  },
  provenanceHeadSha: 'head-canonical-proof',
  command: null,
  workingDirectory: null,
  startedAt: '2026-07-25T20:00:00.000Z',
  endedAt: '2026-07-25T20:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0 as const,
  stdout: '',
  stderr: '',
};

describe('test-suite CLI adapter', () => {
  it('recognizes test-suite before the normal pipeline parser', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');

    expect(cli.detectTestSuiteCommand(['node', 'conduct-ts', 'test-suite'])).toEqual({
      kind: 'run',
    });
  });

  it('does not hijack another command', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');

    expect(cli.detectTestSuiteCommand(['node', 'conduct-ts', 'inline', 'feature'])).toBeNull();
  });

  it('keeps recognized test-suite argv out of normal pipeline fallthrough', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');

    expect(
      cli.detectTestSuiteCommand(['node', 'conduct-ts', 'test-suite', '--future-option']),
    ).not.toBeNull();
  });

  it.each(['EXECUTED', 'REUSED'] as const)(
    'renders canonical %s PASS evidence and returns zero',
    async (status) => {
      const cli = await import('../../src/engine/test-suite-cli.js');
      const output: string[] = [];

      const exitCode = await cli.dispatchTestSuiteCommand(
        { kind: 'run' },
        {
          projectRoot: '/fixture/project',
          verifier: {
            ensure: async () => status === 'EXECUTED'
              ? {
                  status,
                  freshness: { status: 'STALE' as const, reason: 'missing' as const },
                  evidence: PASS_EVIDENCE,
                }
              : { status, evidence: PASS_EVIDENCE },
          },
          print: (line: string) => output.push(line),
        },
      );

      expect({ exitCode, output }).toEqual({
        exitCode: 0,
        output: [
          `${status}: full test suite PASS (fingerprint sha256:canonical-proof, duration 1000ms)`,
        ],
      });
    },
  );

  it('returns non-zero for a non-PASS verifier result without defining Task 14 guidance', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');
    const output: string[] = [];

    const exitCode = await cli.dispatchTestSuiteCommand(
      { kind: 'run' },
      {
        verifier: {
          ensure: async () => ({
            status: 'FAILED' as const,
            reason: 'internal_error' as const,
            message: 'fixture failure',
          }),
        },
        print: (line: string) => output.push(line),
      },
    );

    expect({ exitCode, output }).toEqual({ exitCode: 1, output: [] });
  });
});
