import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = 'src/conductor/test/acceptance/composer-decide-cannot-switch-providers-within-one.acceptance.test.ts';
const reportDirectory = mkdtempSync(join(tmpdir(), 'composer-handoff-red-'));
const reportPath = join(reportDirectory, 'vitest.json');
let evidence;
try {
  const run = spawnSync('ai-conductor', [
    'scoped-run', target, '--reporter=json', `--outputFile=${reportPath}`,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (run.stdout) process.stderr.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.error) throw run.error;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  const failed = assertions.filter((test) => test.status === 'failed');
  const passed = assertions.filter((test) => test.status === 'passed');
  const skipped = assertions.filter((test) => ['pending', 'todo', 'skipped', 'disabled'].includes(test.status));
  evidence = {
    executed: passed.length + failed.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    errors: (report.numRuntimeErrorTestSuites ?? 0) + (report.unhandledErrors?.length ?? 0)
      + (assertions.length === 0 ? 1 : 0),
    failingTests: failed.map((test) => ({
      name: test.fullName ?? test.title,
      reason: String(test.failureMessages?.[0] ?? 'checkpoint/resume assertion failed').split('\n')[0],
    })),
    intentRationale: 'The public compose checkpoint command does not yet persist a run record, so accepted progress and an unaccepted draft cannot be resumed and accepted by another provider.',
  };
  for (const failure of evidence.failingTests) process.stderr.write(`${failure.name}: ${failure.reason}\n`);
  process.stderr.write(`${evidence.passed} passed, ${evidence.failed} failed, ${evidence.skipped} skipped, ${evidence.errors} errors\n`);
} catch (error) {
  evidence = {
    executed: 0, passed: 0, failed: 0, skipped: 0, errors: 1, failingTests: [],
    intentRationale: `Could not obtain executable acceptance evidence: ${String(error)}`,
  };
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
