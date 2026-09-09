import { spawnSync } from 'node:child_process';
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
  it('requires the non-provider tier and joins provider outcomes with an at-least-one-success gate', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/live-daemon-e2e.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'live daemon E2E workflow');
    const jobs = job(workflow.jobs, 'live daemon E2E workflow jobs');
    const credentialRequirement = job(jobs['require-live-provider-credential'], 'live credential requirement job');
    const completeTier = job(jobs['complete-smoke-tier'], 'complete smoke tier job');
    const liveE2E = job(jobs['live-daemon-e2e'], 'live daemon E2E job');
    const providerGate = job(jobs['live-provider-gate'], 'live provider gate job');
    const strategy = job(liveE2E.strategy, 'live daemon E2E strategy');
    const matrix = job(strategy.matrix, 'live daemon E2E matrix');
    const credentialRequirementStep = (credentialRequirement.steps as Array<Record<string, unknown>>)[0];
    const steps = liveE2E.steps as Array<Record<string, unknown>>;
    const credentialCheck = steps.find((step) => step.name === 'Check live-provider credentials');
    const smoke = steps.find((step) => step.name === 'Run provider release smoke in gate mode');

    expect(job(credentialRequirementStep?.env, 'live credential requirement environment')).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      CODEX_API_KEY: '${{ secrets.CODEX_API_KEY }}',
    });
    expect(String(credentialRequirementStep?.run))
      .toMatch(/CLAUDE_CODE_OAUTH_TOKEN[\s\S]*CODEX_API_KEY[\s\S]*exit 1/);
    expect(liveE2E.needs).toBe('require-live-provider-credential');
    expect(job(liveE2E.env, 'live daemon E2E environment')).toMatchObject({
      DAEMON_E2E_LIVE_TOKEN_CAP: "${{ vars.DAEMON_E2E_LIVE_TOKEN_CAP || '300000' }}",
    });
    expect(completeTier.needs).toBe('require-live-provider-credential');
    expect(job(completeTier.env, 'complete smoke tier environment')).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      CODEX_API_KEY: '${{ secrets.CODEX_API_KEY }}',
      DAEMON_E2E_LIVE_TOKEN_CAP: "${{ vars.DAEMON_E2E_LIVE_TOKEN_CAP || '300000' }}",
    });
    const completeSmoke = (completeTier.steps as Array<Record<string, unknown>>)
      .find((step) => step.name === 'Run complete release smoke tier in gate mode');
    expect(String(completeSmoke?.run)).toContain('SMOKE_MODE=advisory');
    expect(String(completeSmoke?.run)).toContain('capability:credentialed:claude,capability:credentialed:codex');

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
    expect(smoke?.id).toBe('provider-smoke');
    expect(smoke?.['continue-on-error']).toBe(true);
    expect(String(smoke?.run)).toContain('SMOKE_MODE=gate npm run smoke -- "${{ matrix.smoke_file }}"');
    expect(String(smoke?.run)).toContain('export "${{ matrix.credential_env }}=$LIVE_PROVIDER_CREDENTIAL"');
    expect(String(smoke?.run)).toContain('unset LIVE_PROVIDER_CREDENTIAL');
    expect(String(smoke?.run)).not.toMatch(/(?:npx\s+)?vitest\s+run/);
    const providerSteps = liveE2E.steps as Array<Record<string, unknown>>;
    expect(providerSteps.some((step) => step.uses === 'actions/upload-artifact@v4')).toBe(true);
    expect(providerGate.needs).toEqual(['complete-smoke-tier', 'live-daemon-e2e']);
    expect(String(providerGate.if)).toContain('always()');
    const gateSteps = providerGate.steps as Array<Record<string, unknown>>;
    expect(gateSteps.some((step) => step.uses === 'actions/download-artifact@v5')).toBe(true);
    const assertStep = gateSteps.find((step) => step.name === 'Require one successful live-provider E2E');
    expect(String(assertStep?.run)).toMatch(/grep[\s\S]*success[\s\S]*exit 1/);
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

  it('baselines the release-PR bump on the nearest RELEASE tag, not any marker tag', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release-pr.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release PR workflow');
    const jobs = job(workflow.jobs, 'release PR workflow jobs');
    const maintenance = job(jobs['release-pr-maintenance'], 'release PR maintenance job');
    const script = (maintenance.steps as Array<Record<string, unknown>>)
      .map((step) => String((step.with as Record<string, unknown> | undefined)?.script ?? ''))
      .find((value) => value.includes('latestTag')) ?? '';

    // A bare `describe --tags` returns the nearest reachable tag of ANY kind, so a
    // non-release marker tag on main (the `retro-last` recovery anchor, 2026-08-26)
    // became the version baseline and wedged maintenance on every merge with
    // `Invalid current version: retro-last`.
    expect(script).toMatch(
      /latestTag:[^\n]*\[[^\]]*'describe'[^\]]*'--tags'[^\]]*'--abbrev=0'[^\]]*'--match'[^\]]*'v\*\.\*\.\*'[^\]]*\]/,
    );
  });

  it('admits manual release-PR maintenance while preserving merged-PR filtering', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release-pr.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release PR workflow');
    const triggers = job(workflow.on, 'release PR workflow triggers');
    const jobs = job(workflow.jobs, 'release PR workflow jobs');
    const maintenance = job(jobs['release-pr-maintenance'], 'release PR maintenance job');
    const checkout = (maintenance.steps as Array<Record<string, unknown>>)
      .find((step) => step.uses === 'actions/checkout@v5');

    expect(triggers.workflow_dispatch).toEqual({});
    expect(job(triggers.pull_request, 'closed pull-request trigger').types).toEqual(['closed']);
    expect(String(maintenance.if)).toMatch(
      /github\.event_name\s*==\s*'workflow_dispatch'[\s\S]*github\.event\.pull_request\.merged\s*==\s*true[\s\S]*github\.event\.pull_request\.head\.ref\s*!=\s*'automation\/release-pr'/,
    );
    expect(job(checkout?.with, 'checkout inputs').ref)
      .toBe('${{ github.event.pull_request.merge_commit_sha || github.sha }}');
  });

  it('shares job-level serialization and App credentials across release-PR triggers', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release-pr.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release PR workflow');
    const triggers = job(workflow.on, 'release PR workflow triggers');
    const permissions = job(workflow.permissions, 'release PR workflow permissions');
    const jobs = job(workflow.jobs, 'release PR workflow jobs');
    const maintenance = job(jobs['release-pr-maintenance'], 'release PR maintenance job');
    const concurrency = job(maintenance.concurrency, 'release PR maintenance concurrency');
    const steps = maintenance.steps as Array<Record<string, unknown>>;
    const appToken = steps.find((step) => step.id === 'app-token');
    const maintenanceScript = steps.find((step) => step.uses === 'actions/github-script@v9');

    expect(triggers.workflow_dispatch).toEqual({});
    expect(workflow.concurrency).toBeUndefined();
    expect(Object.keys(jobs)).toEqual(['release-pr-maintenance']);
    expect(concurrency).toEqual({
      group: 'release-pr-maintenance',
      'cancel-in-progress': false,
    });

    expect(appToken?.if).toBeUndefined();
    expect(maintenanceScript?.if).toBeUndefined();
    expect(job(maintenanceScript?.with, 'release PR maintenance script inputs')['github-token'])
      .toBe('${{ steps.app-token.outputs.token }}');
    expect(job(maintenanceScript?.env, 'release PR maintenance script environment').RELEASE_PR_APP_TOKEN)
      .toBe('${{ steps.app-token.outputs.token }}');

    expect(permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    expect(Object.values(permissions)).not.toContain('write');
  });

  it('rejects manual release-PR maintenance away from the default branch before checkout', async () => {
    const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release-pr.yml'), 'utf8');
    const workflow = job(loadYaml(source), 'release PR workflow');
    const jobs = job(workflow.jobs, 'release PR workflow jobs');
    const maintenance = job(jobs['release-pr-maintenance'], 'release PR maintenance job');
    const steps = maintenance.steps as Array<Record<string, unknown>>;
    const guard = steps[0];
    const checkoutIndex = steps.findIndex((step) => step.uses === 'actions/checkout@v5');
    const script = String(guard?.run ?? '');

    expect(String(guard?.if)).toMatch(/github\.event_name\s*==\s*'workflow_dispatch'/);
    expect(guard?.env).toEqual({
      REQUESTED_REF: '${{ github.ref_name }}',
      DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}',
    });
    expect(checkoutIndex).toBeGreaterThan(0);
    expect(script).not.toContain('${{');

    const mismatched = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { REQUESTED_REF: 'feature/release-fix', DEFAULT_BRANCH: 'main' },
    });
    expect(mismatched.status).not.toBe(0);
    expect(`${mismatched.stdout}${mismatched.stderr}`).toContain('main');
    expect(`${mismatched.stdout}${mismatched.stderr}`).toContain('feature/release-fix');

    const matched = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { REQUESTED_REF: 'main', DEFAULT_BRANCH: 'main' },
    });
    expect(matched.status).toBe(0);
    expect(`${matched.stdout}${matched.stderr}`).toBe('');
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
