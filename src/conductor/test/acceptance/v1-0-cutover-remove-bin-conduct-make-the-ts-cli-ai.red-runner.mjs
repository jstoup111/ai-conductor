#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const target =
  'test/acceptance/v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai.acceptance.test.ts';
const reportPath = join(process.cwd(), `.v1-cli-cutover-red-${process.pid}.json`);
const result = spawnSync(
  process.execPath,
  [
    join(process.cwd(), 'scripts', 'run-vitest.mjs'),
    'run',
    target,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
    },
  },
);

if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

let evidence;
try {
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
      name: test.fullName,
      reason: String(test.failureMessages?.[0] ?? 'acceptance assertion failed').split('\n')[0],
    })),
    intentRationale:
      'The real installer still leaves conduct on the legacy bash target, proving the requested TS-only CLI cutover is not implemented.',
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
  rmSync(reportPath, { force: true });
}

process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
