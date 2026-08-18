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
  it('runs the complete gate while every matrix leg selects, gates, and reports only itself', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/live-daemon-e2e.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'live daemon E2E workflow');
    const jobs = job(workflow.jobs, 'live daemon E2E workflow jobs');
    const credentialRequirement = job(jobs['require-live-provider-credential'], 'live credential requirement job');
    const completeTier = job(jobs['complete-smoke-tier'], 'complete smoke tier job');
    const liveE2E = job(jobs['live-daemon-e2e'], 'live daemon E2E job');
    const strategy = job(liveE2E.strategy, 'live daemon E2E strategy');
    const matrix = job(strategy.matrix, 'live daemon E2E matrix');
    const credentialRequirementStep = (credentialRequirement.steps as Array<Record<string, unknown>>)[0];
    const steps = liveE2E.steps as Array<Record<string, unknown>>;
    const credentialCheck = steps.find((step) => step.name === 'Check live-provider credentials');
    const smoke = steps.find((step) => step.name === 'Run complete release smoke tier in gate mode');

    expect(job(credentialRequirementStep?.env, 'live credential requirement environment')).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      CODEX_API_KEY: '${{ secrets.CODEX_API_KEY }}',
    });
    expect(String(credentialRequirementStep?.run))
      .toMatch(/CLAUDE_CODE_OAUTH_TOKEN[\s\S]*CODEX_API_KEY[\s\S]*exit 1/);
    expect(liveE2E.needs).toBe('require-live-provider-credential');
    expect(completeTier.needs).toBe('require-live-provider-credential');
    expect(job(completeTier.env, 'complete smoke tier environment')).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      CODEX_API_KEY: '${{ secrets.CODEX_API_KEY }}',
    });
    const completeSmoke = (completeTier.steps as Array<Record<string, unknown>>)
      .find((step) => step.name === 'Run complete release smoke tier in gate mode');
    expect(String(completeSmoke?.run)).toBe('SMOKE_MODE=gate npm run smoke');

    expect(matrix.include).toEqual([
      {
        provider: 'claude',
        credential_env: 'CLAUDE_CODE_OAUTH_TOKEN',
        smoke_file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts',
      },
      {
        provider: 'codex',
        credential_env: 'CODEX_API_KEY',
        smoke_file: 'test/engine/daemon-e2e-live-codex.smoke.test.ts',
      },
    ]);
    expect(job(credentialCheck, 'live-provider credential check').env)
      .toMatchObject({ LIVE_PROVIDER_CREDENTIAL: '${{ secrets[matrix.credential_env] }}' });
    expect(String(credentialCheck?.run)).toContain('${{ matrix.provider }}');
    expect(String(credentialCheck?.run)).toContain('${{ matrix.credential_env }}');
    expect(job(smoke, 'live-provider smoke').env).toEqual({
      LIVE_PROVIDER_CREDENTIAL: '${{ secrets[matrix.credential_env] }}',
    });
    expect(String(smoke?.run)).not.toContain('exit 0');
    expect(String(smoke?.run)).toContain('SMOKE_MODE=gate npm run smoke -- "${{ matrix.smoke_file }}"');
    expect(String(smoke?.run)).toContain('export "${{ matrix.credential_env }}=$LIVE_PROVIDER_CREDENTIAL"');
    expect(String(smoke?.run)).toContain('unset LIVE_PROVIDER_CREDENTIAL');
    expect(String(smoke?.run)).not.toMatch(/(?:npx\s+)?vitest\s+run/);
    expect(source).toMatch(/\$GITHUB_STEP_SUMMARY[\s\S]*\$\{\{ matrix\.provider \}\}[\s\S]*(?:gating|non-gating skip)[\s\S]*\$\{\{ matrix\.credential_env \}\}/);
  });

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
