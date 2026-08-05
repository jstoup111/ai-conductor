/**
 * RED acceptance specs for the release-time smoke and eval gate (#1259).
 *
 * Stories: .docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md
 * Plan:    .docs/plans/no-release-time-smoke-or-eval-gate-releases-cut-wi.md
 *
 * Project shape: headless TypeScript tooling. These specs drive the committed
 * package/workflow entry points and inspect their observable orchestration.
 * They never execute the smoke tier, because that tier intentionally reaches
 * real toolchain/provider boundaries and remains opt-in smoke-only.
 *
 * Coverage classification:
 * - Story 1 is acceptance-covered here because one public command must cross
 *   package-script, Vitest-config, and glob-discovery boundaries.
 * - Story 2 is single-runner behavior owned by Tasks 5-13's lower-level tests.
 * - Story 3 is single-operation classification behavior owned by Tasks 15-17.
 * - Story 4 is acceptance-covered here because the production workflow must
 *   cross classify -> smoke -> publish and fail closed between those steps.
 * - Story 5's retry/idempotence behavior is already asserted in
 *   test/engine/release-publisher-action.test.ts.
 *
 * Existing overlap deliberately not duplicated:
 * - test/structural/test-execution-policy.test.ts proves the default Vitest
 *   config excludes both smoke globs.
 * - test/engine/release-publisher-action.test.ts proves completed-release
 *   idempotence and rejects conflicting tags without mutation.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CONDUCTOR_ROOT, '../..');

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  expect(value, `${label} must be a mapping`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as UnknownRecord;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

function smokeFiles(paths: string[]): string[] {
  return paths
    .map((path) => relative(CONDUCTOR_ROOT, path).replaceAll('\\', '/'))
    .filter((path) => path.startsWith('test/smoke/') || path.endsWith('.smoke.test.ts'))
    .sort();
}

async function releaseWorkflow(): Promise<UnknownRecord> {
  const source = await readFile(resolve(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
  return record(loadYaml(source), 'release workflow');
}

describe('Story 1: one command discovers the complete smoke tier', () => {
  it('routes npm run smoke through an isolated config whose globs select every current smoke file', async () => {
    const packageJson = record(
      JSON.parse(await readFile(resolve(CONDUCTOR_ROOT, 'package.json'), 'utf8')),
      'package.json',
    );
    const scripts = record(packageJson.scripts, 'package.json scripts');

    expect(scripts.smoke).toBe('vitest run --config vitest.smoke.config.ts');

    const config = await readFile(resolve(CONDUCTOR_ROOT, 'vitest.smoke.config.ts'), 'utf8');
    expect(config).toMatch(/include\s*:\s*\[[^\]]*['"]test\/smoke\/\*\*['"][^\]]*['"]\*\*\/\*\.smoke\.test\.ts['"][^\]]*\]/s);
    expect(config).toMatch(/exclude\s*:\s*\[\s*\]/);

    const discovered = smokeFiles(await filesBelow(resolve(CONDUCTOR_ROOT, 'test')));
    expect(discovered).toHaveLength(9);
    expect(new Set(discovered).size).toBe(discovered.length);
  });
});

describe('Story 4: release publication is gated by the live smoke tier', () => {
  it('wires the production workflow as classify -> smoke -> publish for a publishable release', async () => {
    const workflow = await releaseWorkflow();
    const jobs = record(workflow.jobs, 'release workflow jobs');
    const classify = record(jobs.classify, 'classify job');
    const smoke = record(jobs.smoke, 'smoke job');
    const publish = record(jobs.publish, 'publish job');

    expect(record(classify.outputs, 'classify outputs')).toHaveProperty('publishable');
    expect(smoke.needs).toBe('classify');
    expect(String(smoke.if)).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(smoke.uses).toBe('./.github/workflows/live-daemon-e2e.yml');
    expect(smoke.secrets).toBe('inherit');
    expect(record(smoke.with, 'smoke inputs').require_credentials).toBe(true);
    expect(publish.needs).toEqual(expect.arrayContaining(['classify', 'smoke']));
  });

  it('admits publish only after successful smoke and skips paid work for ignored merges', async () => {
    const workflow = await releaseWorkflow();
    const jobs = record(workflow.jobs, 'release workflow jobs');
    const smoke = record(jobs.smoke, 'smoke job');
    const publish = record(jobs.publish, 'publish job');
    const smokeCondition = String(smoke.if);
    const publishCondition = String(publish.if);

    expect(smokeCondition).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(publishCondition).toMatch(/needs\.classify\.outputs\.publishable\s*==\s*'true'/);
    expect(publishCondition).toMatch(/needs\.smoke\.result\s*==\s*'success'/);
    expect(publishCondition).not.toMatch(/failure\(\)|cancelled\(\)|always\(\)/);
  });
});
