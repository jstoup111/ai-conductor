import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const projectRoot = await mkdtemp(join(tmpdir(), 'config-precedence-project-'));
  const isolatedHome = await mkdtemp(join(tmpdir(), 'config-precedence-home-'));
  tempDirs.push(projectRoot, isolatedHome);

  await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), projectYaml, 'utf8');

  userConfigFixture.path = join(isolatedHome, '.ai-conductor', 'config.yml');
  if (userYaml !== undefined) {
    await mkdir(join(isolatedHome, '.ai-conductor'), { recursive: true });
    await writeFile(userConfigFixture.path, userYaml, 'utf8');
  }

  return projectRoot;
}

const PRECEDENCE_CASES = [
  {
    name: 'ci_watch',
    userYaml: 'ci_watch:\n  enabled: false\n',
    projectYaml: 'ci_watch:\n  enabled: true\n',
    select: (config: Record<string, unknown>) => config.ci_watch,
    userExpected: { enabled: false },
    projectExpected: { enabled: true },
  },
  {
    name: 'build_review',
    userYaml: 'build_review:\n  enabled: false\n',
    projectYaml: 'build_review:\n  enabled: true\n',
    select: (config: Record<string, unknown>) => config.build_review,
    userExpected: { enabled: false },
    projectExpected: { enabled: true },
  },
  {
    name: 'auto_restart_on_stale_engine',
    userYaml: 'auto_restart_on_stale_engine: true\n',
    projectYaml: 'auto_restart_on_stale_engine: false\n',
    select: (config: Record<string, unknown>) => config.auto_restart_on_stale_engine,
    userExpected: true,
    projectExpected: false,
  },
  {
    name: 'engine_refresh_min_interval_seconds',
    userYaml: 'engine_refresh_min_interval_seconds: 42\n',
    projectYaml: 'engine_refresh_min_interval_seconds: 84\n',
    select: (config: Record<string, unknown>) =>
      config.engine_refresh_min_interval_seconds,
    userExpected: 42,
    projectExpected: 84,
  },
  {
    name: 'attribution_audit_sample_pct',
    userYaml: 'attribution_audit_sample_pct: 25\n',
    projectYaml: 'attribution_audit_sample_pct: 75\n',
    select: (config: Record<string, unknown>) => config.attribution_audit_sample_pct,
    userExpected: 25,
    projectExpected: 75,
  },
  {
    name: 'build_progress_halt',
    userYaml:
      'build_progress_halt:\n  enabled: false\n  attempt_ceiling: 31\n  dispatch_ceiling: 21\n',
    projectYaml:
      'build_progress_halt:\n  enabled: true\n  attempt_ceiling: 32\n  dispatch_ceiling: 22\n',
    select: (config: Record<string, unknown>) => config.build_progress_halt,
    userExpected: {
      enabled: false,
      attempt_ceiling: 31,
      dispatch_ceiling: 21,
    },
    projectExpected: {
      enabled: true,
      attempt_ceiling: 32,
      dispatch_ceiling: 22,
    },
  },
  {
    name: 'kickback_escalation',
    userYaml: 'kickback_escalation:\n  enabled: false\n',
    projectYaml: 'kickback_escalation:\n  enabled: true\n',
    select: (config: Record<string, unknown>) => config.kickback_escalation,
    userExpected: { enabled: false },
    projectExpected: { enabled: true },
  },
  {
    name: 'retry_routing',
    userYaml: 'retry_routing:\n  enabled: false\n',
    projectYaml: 'retry_routing:\n  enabled: true\n',
    select: (config: Record<string, unknown>) => config.retry_routing,
    userExpected: { enabled: false },
    projectExpected: { enabled: true },
  },
];

describe('loadMergedConfig precedence', () => {
  it.each(PRECEDENCE_CASES)(
    'preserves user-only $name when the project omits it',
    async ({ userYaml, select, userExpected }) => {
      const projectRoot = await makeConfigPair(userYaml);
      const result = await loadMergedConfig(projectRoot);

      expect(result.ok ? select(result.config) : result).toEqual(userExpected);
    },
  );

  it.each(PRECEDENCE_CASES)(
    'uses project-only $name when the user omits it',
    async ({ projectYaml, select, projectExpected }) => {
      const projectRoot = await makeConfigPair(undefined, projectYaml);
      const result = await loadMergedConfig(projectRoot);

      expect(result.ok ? select(result.config) : result).toEqual(projectExpected);
    },
  );

  it.each(PRECEDENCE_CASES)(
    'lets explicit project $name win when both scopes set it',
    async ({ userYaml, projectYaml, select, projectExpected }) => {
      const projectRoot = await makeConfigPair(userYaml, projectYaml);
      const result = await loadMergedConfig(projectRoot);

      expect(result.ok ? select(result.config) : result).toEqual(projectExpected);
    },
  );
});
