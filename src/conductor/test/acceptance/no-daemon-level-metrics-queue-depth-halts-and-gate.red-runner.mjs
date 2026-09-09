#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target =
  'src/conductor/test/acceptance/no-daemon-level-metrics-queue-depth-halts-and-gate.acceptance.test.ts';
const reportDirectory = mkdtempSync(join(tmpdir(), 'daemon-metrics-red-'));
const reportPath = join(reportDirectory, 'vitest.json');

try {
  const result = spawnSync(
    'ai-conductor',
    ['scoped-run', target, '--reporter=json', `--outputFile=${reportPath}`],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  const failing = assertions.filter((test) => test.status === 'failed');
  const skipped = assertions.filter((test) => test.status === 'pending' || test.status === 'todo');
  const errors = report.testResults.filter(
    (suite) => (suite.assertionResults?.length ?? 0) === 0 && suite.status === 'failed',
  ).length;
  const evidence = {
    executed: assertions.length - skipped.length,
    passed: assertions.filter((test) => test.status === 'passed').length,
    failed: failing.length,
    skipped: skipped.length,
    errors,
    failingTests: failing.map((test) => ({
      name: test.fullName ?? test.title,
      reason: String(test.failureMessages?.[0] ?? 'acceptance assertion failed').split('\n')[0],
    })),
    intentRationale:
      'The failures show that the daemon-lifetime metrics wiring is absent, so counters cannot survive dispatch exit and an idle daemon cannot export liveness or queue state.',
  };
  process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
} catch (error) {
  process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: 1,
    failingTests: [],
    intentRationale: `The acceptance runner could not produce valid evidence: ${String(error)}`,
  })}\n`);
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
