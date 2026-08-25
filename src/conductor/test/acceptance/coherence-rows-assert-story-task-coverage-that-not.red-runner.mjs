#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetSpec = 'test/acceptance/decide-artifact-coherence-check.acceptance.test.ts';
const reportDirectory = mkdtempSync(join(tmpdir(), 'criterion-coherence-red-'));
const reportPath = join(reportDirectory, 'vitest.json');

try {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      targetSpec,
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const assertions = report.testResults.flatMap((testResult) => testResult.assertionResults ?? []);
  const failedAssertions = assertions.filter((assertion) => assertion.status === 'failed');
  const errors = report.testResults.filter(
    (testResult) => (testResult.assertionResults?.length ?? 0) === 0 && testResult.status === 'failed',
  ).length;
  const evidence = {
    executed: report.numPassedTests + report.numFailedTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
    errors,
    failingTests: failedAssertions.map((assertion) => ({
      name: assertion.fullName ?? assertion.title,
      reason: String(assertion.failureMessages?.[0] ?? 'acceptance assertion failed').split('\n')[0],
    })),
    intentRationale:
      'The landSpec entry point still accepts an M-tier coherence artifact that omits every accepted story criterion, proving the criterion-level land gate is not implemented.',
  };
  process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
