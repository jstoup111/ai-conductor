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

  it('classifies extra test-suite argv as recognized misuse instead of pipeline input', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');

    expect(
      cli.detectTestSuiteCommand(['node', 'conduct-ts', 'test-suite', '--future-option']),
    ).toEqual({ kind: 'guide' });
  });

  it('rejects recognized misuse with guidance without invoking the verifier', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');
    const output: string[] = [];
    let verifierInvoked = false;

    const exitCode = await cli.dispatchTestSuiteCommand(
      { kind: 'guide' },
      {
        verifier: {
          ensure: async () => {
            verifierInvoked = true;
            throw new Error('verifier must not run for malformed argv');
          },
        },
        print: (line: string) => output.push(line),
      },
    );

    expect({ exitCode, output, verifierInvoked }).toEqual({
      exitCode: 1,
      output: [expect.stringMatching(/Usage: conduct-ts test-suite[\s\S]*\/tdd or \/pipeline/i)],
      verifierInvoked: false,
    });
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

  it.each([
    ['missing_config', 'Project config must declare test_suite'],
    ['invalid_config', 'test_suite.command must be a non-empty string'],
    ['invalid_input', 'Declared suite input is invalid'],
    ['timeout', 'Aggregate suite exceeded its timeout'],
    ['unlaunchable', 'Aggregate suite could not be launched'],
    ['signal', 'Aggregate suite was terminated'],
    ['preflight_failed', 'Aggregate suite preflight failed'],
    ['internal_error', 'Full-suite verification failed'],
  ] as const)('renders actionable blocking guidance for %s', async (reason, message) => {
    const cli = await import('../../src/engine/test-suite-cli.js');
    const output: string[] = [];
    const sensitiveDiagnostic = `${message}: declared-environment-secret-940`;

    const exitCode = await cli.dispatchTestSuiteCommand(
      { kind: 'run' },
      {
        verifier: {
          ensure: async () => ({
            status: 'FAILED' as const,
            reason,
            message: sensitiveDiagnostic,
          }),
        },
        print: (line: string) => output.push(line),
      },
    );

    expect({ exitCode, output, leaked: output.join('\n').includes(sensitiveDiagnostic) }).toEqual({
      exitCode: 1,
      output: [
        expect.stringMatching(new RegExp(`FAILED.*evidence=${reason}.*\\/tdd or \\/pipeline`, 'is')),
      ],
      leaked: false,
    });
  });

  it('names stale nonzero evidence and its freshness reason before blocking', async () => {
    const cli = await import('../../src/engine/test-suite-cli.js');
    const output: string[] = [];

    const exitCode = await cli.dispatchTestSuiteCommand(
      { kind: 'run' },
      {
        verifier: {
          ensure: async () => ({
            status: 'FAILED' as const,
            reason: 'nonzero_exit' as const,
            message: 'Aggregate suite exited with code 7',
            freshness: { status: 'STALE' as const, reason: 'source_changed' as const },
          }),
        },
        print: (line: string) => output.push(line),
      },
    );

    expect({ exitCode, output }).toEqual({
      exitCode: 1,
      output: [
        expect.stringMatching(
          /FAILED.*evidence=nonzero_exit.*freshness=source_changed.*\/tdd or \/pipeline/is,
        ),
      ],
    });
  });
});
