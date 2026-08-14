import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CONDUCTOR_ROOT, '../..');

type WorkflowJob = Record<string, unknown>;

function job(value: unknown, label: string): WorkflowJob {
  expect(value, `${label} must be a mapping`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as WorkflowJob;
}

describe('structural: release workflow', () => {
  it('orders classify, smoke, and publish so only a publishable classification can spend or publish', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release workflow');
    const jobs = job(workflow.jobs, 'release workflow jobs');
    const classify = job(jobs.classify, 'classify job');
    const smoke = job(jobs.smoke, 'smoke job');
    const publish = job(jobs.publish, 'publish job');

    expect(Object.keys(jobs)).toEqual(['classify', 'smoke', 'publish']);
    expect(job(classify.outputs, 'classify outputs').publishable)
      .toBe('${{ steps.classify.outputs.publishable }}');
    expect(smoke.needs).toBe('classify');
    expect(String(smoke.if)).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(smoke.uses).toBe('./.github/workflows/live-daemon-e2e.yml');
    expect(smoke.secrets).toBe('inherit');
    expect(job(smoke.with, 'smoke inputs').require_credentials).toBe(true);
    expect(publish.needs).toEqual(expect.arrayContaining(['classify', 'smoke']));
    expect(String(publish.if)).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(String(publish.if)).toMatch(/needs\.smoke\.result\s*==\s*'success'/);
    expect(String(publish.if)).not.toMatch(/(?:cancelled|timedout)/i);
    expect(String(publish.if)).not.toMatch(/failure\(\)|cancelled\(\)|always\(\)/);
    expect(source).toContain('runReleasePublisherAction');
  });

  it('wires the stable branch through a create-or-fast-forward GitHub ref adapter', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release workflow');
    const jobs = job(workflow.jobs, 'release workflow jobs');
    const publish = job(jobs.publish, 'publish job');
    const publishAction = (publish.steps as Array<Record<string, unknown>>)
      .map((step) => {
        const inputs = step.with as Record<string, unknown> | undefined;
        return [step.run, inputs?.script].map((value) => String(value ?? '')).join('\n');
      })
      .find((script) => script.includes('runReleasePublisherAction')) ?? '';

    expect(publishAction).toMatch(
      /(?=[\s\S]*stableBranch:\s*['"]stable['"])(?=[\s\S]*updateStableBranch\s*(?::|\())(?=[\s\S]*\.git\.createRef\s*\()(?=[\s\S]*\.git\.updateRef\s*\()(?=[\s\S]*refs\/heads\/\$\{branch\})(?=[\s\S]*sha:\s*(?:commit|target))(?=[\s\S]*force:\s*false)/,
    );
  });
});
