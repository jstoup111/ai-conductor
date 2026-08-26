import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const target = 'test/acceptance/every-as-built-blocked-verdict-halts-needs-human-i.acceptance.test.ts';
const reportPath = join(process.cwd(), `.as-built-remediable-red-${process.pid}.json`);
const runnerPath = join(process.cwd(), 'scripts', 'run-vitest.mjs');
const result = spawnSync(
  process.execPath,
  [runnerPath, 'run', target, '--reporter=json', `--outputFile=${reportPath}`],
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
      'The all-REMEDIABLE as-built verdict still halts needs-human before remediation, plan append, and BUILD dispatch.',
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
