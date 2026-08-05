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
    expect(publish.needs).toEqual(expect.arrayContaining(['classify', 'smoke']));
    expect(String(publish.if)).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(source).toContain('runReleasePublisherAction');
  });
});
