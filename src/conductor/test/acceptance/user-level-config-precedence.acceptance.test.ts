/**
 * RED acceptance specs — User-level configuration precedence (#1000)
 *
 * Stories: .docs/stories/user-level-config-for-8-keys-is-silently-discarded.md
 * Plan: .docs/plans/user-level-config-for-8-keys-is-silently-discarded.md
 * Track: technical (no PRD / FR-coverage table)
 *
 * Story 1 is single-operation validation and is unit-covered by plan Tasks 1-3.
 * Story 3's ordinary loadConfig defaults are likewise single-operation and unit-covered by
 * Tasks 4/12. Its project-source spec_owner rejection and the generic object/scalar/array merge
 * contract are already acceptance-covered by daemon-merged-config-967.acceptance.test.ts.
 *
 * This file covers Story 2's composed effective-loading flow through the real public boundary:
 * loadMergedConfig reads and validates the project source, reads the user source through its
 * production adapter, merges project over user, and validates the effective result. No daemon,
 * process, network, or third-party boundary is needed to observe the returned effective config.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessConfig } from '../../src/types/config.js';

const userConfigFixture = vi.hoisted(() => ({ path: '' }));

vi.mock('../../src/engine/user-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/user-config.js')>();
  return {
    ...actual,
    readUserConfig: (path?: string) => actual.readUserConfig(path ?? userConfigFixture.path),
  };
});

import { loadMergedConfig } from '../../src/engine/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  userConfigFixture.path = '';
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeConfigPair(
  userYaml: string | undefined,
  projectYaml = '{}\n',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'config-precedence-project-'));
  const home = await mkdtemp(join(tmpdir(), 'config-precedence-home-'));
  tempDirs.push(root, home);

  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), projectYaml, 'utf8');

  userConfigFixture.path = join(home, '.ai-conductor', 'config.yml');
  if (userYaml !== undefined) {
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(userConfigFixture.path, userYaml, 'utf8');
  }

  return root;
}

type AffectedCase = {
  name: string;
  userYaml: string;
  projectYaml: string;
  select: (config: HarnessConfig) => unknown;
  userValue: unknown;
  projectValue: unknown;
  defaultValue: unknown;
};

const AFFECTED_CASES: AffectedCase[] = [
  {
    name: 'ci_watch',
    userYaml: 'ci_watch:\n  enabled: false\n',
    projectYaml: 'ci_watch:\n  enabled: true\n',
    select: (config) => config.ci_watch,
    userValue: { enabled: false },
    projectValue: { enabled: true },
    defaultValue: { enabled: true },
  },
  {
    name: 'build_review',
    userYaml: 'build_review:\n  rubrics:\n    testQuality:\n      enabled: false\n      effort: high\n',
    projectYaml: 'build_review:\n  rubrics:\n    testQuality:\n      enabled: true\n      effort: low\n',
    select: (config) => config.build_review,
    userValue: { enabled: true, maxParallel: 1, rubrics: { testQuality: { enabled: false, effort: 'high' } } },
    projectValue: { enabled: true, maxParallel: 1, rubrics: { testQuality: { enabled: true, effort: 'low' } } },
    defaultValue: { enabled: true, maxParallel: 1, rubrics: { testQuality: { enabled: false } } },
  },
  {
    name: 'auto_restart_on_stale_engine',
    userYaml: 'auto_restart_on_stale_engine: true\n',
    projectYaml: 'auto_restart_on_stale_engine: false\n',
    select: (config) => config.auto_restart_on_stale_engine,
    userValue: true,
    projectValue: false,
    defaultValue: false,
  },
  {
    name: 'engine_refresh_min_interval_seconds',
    userYaml: 'engine_refresh_min_interval_seconds: 45\n',
    projectYaml: 'engine_refresh_min_interval_seconds: 600\n',
    select: (config) => config.engine_refresh_min_interval_seconds,
    userValue: 45,
    projectValue: 600,
    defaultValue: 300,
  },
  {
    name: 'attribution_audit_sample_pct',
    userYaml: 'attribution_audit_sample_pct: 25\n',
    projectYaml: 'attribution_audit_sample_pct: 75\n',
    select: (config) => config.attribution_audit_sample_pct,
    userValue: 25,
    projectValue: 75,
    defaultValue: 10,
  },
  {
    name: 'build_progress_halt',
    userYaml:
      'build_progress_halt:\n  enabled: false\n  attempt_ceiling: 31\n  dispatch_ceiling: 21\n',
    projectYaml:
      'build_progress_halt:\n  enabled: true\n  attempt_ceiling: 35\n  dispatch_ceiling: 25\n',
    select: (config) => config.build_progress_halt,
    userValue: { enabled: false, attempt_ceiling: 31, dispatch_ceiling: 21 },
    projectValue: { enabled: true, attempt_ceiling: 35, dispatch_ceiling: 25 },
    defaultValue: { enabled: true, attempt_ceiling: 30, dispatch_ceiling: 20 },
  },
  {
    name: 'kickback_escalation',
    userYaml: 'kickback_escalation:\n  enabled: false\n',
    projectYaml: 'kickback_escalation:\n  enabled: true\n',
    select: (config) => config.kickback_escalation,
    userValue: { enabled: false },
    projectValue: { enabled: true },
    defaultValue: { enabled: true },
  },
  {
    name: 'retry_routing',
    userYaml: 'retry_routing:\n  enabled: false\n',
    projectYaml: 'retry_routing:\n  enabled: true\n',
    select: (config) => config.retry_routing,
    userValue: { enabled: false },
    projectValue: { enabled: true },
    defaultValue: { enabled: true },
  },
];

describe('Story 2 — affected keys obey explicit project-over-user precedence', () => {
  it.each(AFFECTED_CASES)(
    'inherits a user-only $name value when the project omits it',
    async ({ userYaml, select, userValue }) => {
      const root = await makeConfigPair(userYaml);

      const result = await loadMergedConfig(root);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(select(result.config)).toEqual(userValue);
    },
  );

  it.each(AFFECTED_CASES)(
    'uses a project-only $name value',
    async ({ projectYaml, select, projectValue }) => {
      const root = await makeConfigPair(undefined, projectYaml);

      const result = await loadMergedConfig(root);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(select(result.config)).toEqual(projectValue);
    },
  );

  it.each(AFFECTED_CASES)(
    'lets an explicit project $name value override a distinct user value',
    async ({ userYaml, projectYaml, select, projectValue }) => {
      const root = await makeConfigPair(userYaml, projectYaml);

      const result = await loadMergedConfig(root);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(select(result.config)).toEqual(projectValue);
    },
  );

  it.each(AFFECTED_CASES)(
    'materializes the existing $name default when both scopes omit it',
    async ({ select, defaultValue }) => {
      const root = await makeConfigPair(undefined);

      const result = await loadMergedConfig(root);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(select(result.config)).toEqual(defaultValue);
    },
  );
});

describe('Story 2 — malformed values keep their existing source-aware contracts', () => {
  it('rejects a malformed user-only retry_routing value during effective validation', async () => {
    const root = await makeConfigPair('retry_routing:\n  enabled: yes\n');

    const result = await loadMergedConfig(root);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('retry_routing.enabled must be a boolean');
  });

  it('applies and warns for a malformed user-only fallback value after merge', async () => {
    const root = await makeConfigPair('engine_refresh_min_interval_seconds: 0\n');

    const result = await loadMergedConfig(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings).toEqual([
      'engine_refresh_min_interval_seconds has invalid value 0, falling back to 300.',
    ]);
  });

  it('keeps a warning-producing project fallback authoritative over a valid user value', async () => {
    const root = await makeConfigPair(
      'engine_refresh_min_interval_seconds: 45\n',
      'engine_refresh_min_interval_seconds: 0\n',
    );

    const result = await loadMergedConfig(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings).toEqual([
      'engine_refresh_min_interval_seconds has invalid value 0, falling back to 300.',
    ]);
  });

  it('emits one project normalization warning rather than duplicating it after merge', async () => {
    const root = await makeConfigPair(
      'attribution_audit_sample_pct: 25\n',
      'attribution_audit_sample_pct: 150\n',
    );

    const result = await loadMergedConfig(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.attribution_audit_sample_pct).toBe(100);
    expect(result.warnings).toEqual([
      'attribution_audit_sample_pct out of range [0, 100]; clamped to 100.',
    ]);
  });
});
