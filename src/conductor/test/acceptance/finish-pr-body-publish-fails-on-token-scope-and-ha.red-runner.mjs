import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const target = 'src/conductor/test/acceptance/finish-pr-body-publish-fails-on-token-scope-and-ha.acceptance.test.ts';
const reportDirectory = mkdtempSync(join(tmpdir(), 'finish-publish-failure-red-'));
const reportPath = join(reportDirectory, 'vitest.json');
const result = spawnSync(
  join(repositoryRoot, 'bin', 'ai-conductor'),
  ['scoped-run', target, '--reporter=json', `--outputFile=${reportPath}`],
  { cwd: repositoryRoot, encoding: 'utf8' },
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
      'The failing FINISH flow proves that a recorded same-PR publish failure is still diagnosed as unchanged prose instead of reaching the HALT and event spine.',
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
