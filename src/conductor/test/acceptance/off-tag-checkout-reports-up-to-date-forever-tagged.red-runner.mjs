import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const target = 'test/acceptance/off-tag-checkout-reports-up-to-date-forever-tagged.acceptance.test.ts';
const repoRoot = join(process.cwd(), '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'off-tag-update-red-'));
const baselineRoot = join(scratch, 'baseline');
const reportPath = join(scratch, 'vitest.json');
const vitestPath = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

function gitResult(args, encoding) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? result.error)}`);
  }
  return result.stdout;
}

function git(...args) {
  return String(gitResult(args, 'utf8')).trim();
}

function materialize(ref, path) {
  const destination = join(baselineRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, gitResult(['show', `${ref}:${path}`]));
  chmodSync(destination, 0o755);
}

let evidence;
try {
  const specCommit = git('log', '--diff-filter=A', '--format=%H', '--', `src/conductor/${target}`)
    .split('\n')
    .filter(Boolean)
    .at(-1);
  if (!specCommit) throw new Error(`could not locate the commit that added ${target}`);
  const baselineRef = `${specCommit}^`;

  materialize(baselineRef, 'bin/update');
  materialize(baselineRef, 'bin/conduct');
  materialize(baselineRef, 'bin/lib/harness-common.sh');
  mkdirSync(join(baselineRoot, 'bin'), { recursive: true });
  symlinkSync(join(repoRoot, 'bin', 'conduct-ts'), join(baselineRoot, 'bin', 'conduct-ts'));

  const env = { ...process.env, OFF_TAG_ACCEPTANCE_REPO_ROOT: baselineRoot };
  delete env.CONDUCT_DAEMON_SESSION;
  const result = spawnSync(
    process.execPath,
    [vitestPath, 'run', target, '--reporter=json', `--outputFile=${reportPath}`],
    { cwd: process.cwd(), env, encoding: 'utf8' },
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
      name: test.fullName,
      reason: String(test.failureMessages?.[0] ?? 'acceptance assertion failed').split('\n')[0],
    })),
    intentRationale:
      'Failures against the production snapshot immediately before these specs were added prove checkout-derived identity reporting, persistence, and bin/update-to-bin/conduct parity were not yet implemented.',
  };
} catch (error) {
  evidence = {
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: 1,
    failingTests: [],
    intentRationale: `The acceptance RED runner could not produce valid evidence: ${String(error)}`,
  };
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
