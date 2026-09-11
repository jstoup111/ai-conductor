import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = 'test/acceptance/projects-cannot-add-portable-non-competing-build-r.acceptance.test.ts';
const evidenceRoot = mkdtempSync(join(tmpdir(), 'portable-build-review-red-'));
const reportPath = join(evidenceRoot, 'vitest.json');

try {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-vitest.mjs', target, '--run', '--reporter=json', `--outputFile=${reportPath}`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
    },
  );

  if (result.error) throw result.error;

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  const passed = assertions.filter((assertion) => assertion.status === 'passed');
  const failed = assertions.filter((assertion) => assertion.status === 'failed');
  const skipped = assertions.filter((assertion) => ['pending', 'skipped', 'todo'].includes(assertion.status));
  const evidence = {
    executed: passed.length + failed.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    errors: report.numRuntimeErrorTestSuites ?? 0,
    failingTests: failed.map((assertion) => ({
      name: assertion.fullName,
      reason: String(assertion.failureMessages?.[0] ?? 'acceptance assertion failed').split('\n')[0],
    })),
    intentRationale:
      'Configured custom policies do not yet reach the attended/daemon aggregate route, and repaired custom-policy work does not yet enforce fresh verification before progression.',
  };

  if (result.status === 0 || evidence.failed === 0 || evidence.errors !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`expected assertion-only RED, received exit=${result.status} failures=${evidence.failed} errors=${evidence.errors}`);
  }

  process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
} finally {
  rmSync(evidenceRoot, { recursive: true, force: true });
}
