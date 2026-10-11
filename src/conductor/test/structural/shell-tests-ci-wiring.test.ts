import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CONDUCTOR_ROOT, '../..');

type WorkflowJob = Record<string, unknown>;
type WorkflowStep = Record<string, unknown>;

function mapping(value: unknown, label: string): WorkflowJob {
  expect(value, `${label} must be a mapping`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as WorkflowJob;
}

function steps(job: WorkflowJob): WorkflowStep[] {
  return job.steps as WorkflowStep[];
}

function needs(job: WorkflowJob): string[] {
  return Array.isArray(job.needs) ? job.needs as string[] : [String(job.needs)];
}

describe('structural: shell-test CI wiring', () => {
  it('runs the shell-test runner in a required, docs-only-skippable job', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const workflow = mapping(loadYaml(source), 'CI workflow');
    const jobs = mapping(workflow.jobs, 'CI workflow jobs');
    const shellTests = mapping(jobs['shell-tests'], 'shell-tests job');

    expect(needs(shellTests)).toContain('changes');
    expect(shellTests.if).toBe("needs.changes.outputs.docs_only != 'true'");
    expect(shellTests['runs-on']).toBe('ubuntu-latest');
    expect(steps(shellTests).some((step) => step.run === 'bash test/run_shell_tests.sh')).toBe(true);

    const tooling = steps(shellTests)
      .map((step) => String(step.run ?? ''))
      .find((run) => run.includes('install --yes shellcheck ripgrep'));
    expect(tooling).toMatch(/for attempt in 1 2 3; do[\s\S]*install --yes shellcheck ripgrep[\s\S]*done[\s\S]*exit 1/);
    expect(steps(shellTests).some((step) => step['continue-on-error'] !== undefined)).toBe(false);
  });

  it('joins shell-test results without treating a docs-only skip as a failure', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const workflow = mapping(loadYaml(source), 'CI workflow');
    const jobs = mapping(workflow.jobs, 'CI workflow jobs');
    const ciGate = mapping(jobs['ci-gate'], 'ci-gate job');

    expect(needs(ciGate)).toContain('shell-tests');
    const gateStep = steps(ciGate).find((step) => step.run !== undefined);
    const environment = mapping(gateStep?.env, 'ci-gate environment');
    expect(environment.SHELL_TESTS).toBe('${{ needs.shell-tests.result }}');

    const run = String(gateStep?.run ?? '');
    expect(run).toContain('shell_tests=$SHELL_TESTS');
    expect(run).toMatch(/for r in[\s\S]*"\$SHELL_TESTS"[\s\S]*; do/);
    expect(run).toMatch(/case "\$r" in\s*failure\|cancelled\)/);
    expect(run).not.toMatch(/case "\$r" in[\s\S]*\bskipped\b/);
  });
});
