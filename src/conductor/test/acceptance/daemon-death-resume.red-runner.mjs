#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = 'src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts';
const reportDirectory = mkdtempSync(join(tmpdir(), 'daemon-death-resume-red-'));
const reportPath = join(reportDirectory, 'vitest.json');

let evidence;
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
  evidence = {
    executed: assertions.length - skipped.length,
    passed: assertions.filter((test) => test.status === 'passed').length,
    failed: failing.length,
    skipped: skipped.length,
    errors: assertions.length === 0 && report.success === false ? 1 : 0,
    failingTests: failing.map((test) => ({
      name: test.fullName ?? test.title,
      reason: String(test.failureMessages?.[0] ?? 'daemon death resume assertion failed').split('\n')[0],
    })),
    intentRationale:
      'The failures show that a daemon redispatch does not yet restore every trailer-proven row and reset uncommitted in-flight work to pending as Story 7 requires.',
  };
} catch (error) {
  evidence = {
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: 1,
    failingTests: [],
    intentRationale: `The acceptance runner could not produce valid evidence: ${String(error)}`,
  };
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}

process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
