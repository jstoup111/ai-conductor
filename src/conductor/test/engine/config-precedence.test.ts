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

async function makeConfigPair(userYaml: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'config-precedence-project-'));
  const isolatedHome = await mkdtemp(join(tmpdir(), 'config-precedence-home-'));
  tempDirs.push(projectRoot, isolatedHome);

  await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), '{}\n', 'utf8');

  userConfigFixture.path = join(isolatedHome, '.ai-conductor', 'config.yml');
  await mkdir(join(isolatedHome, '.ai-conductor'), { recursive: true });
  await writeFile(userConfigFixture.path, userYaml, 'utf8');

  return projectRoot;
}

describe('loadMergedConfig precedence', () => {
  it.each([
    {
      name: 'ci_watch',
      userYaml: 'ci_watch:\n  enabled: false\n',
      select: (config: Record<string, unknown>) => config.ci_watch,
      expected: { enabled: false },
    },
    {
      name: 'build_review',
      userYaml: 'build_review:\n  enabled: false\n',
      select: (config: Record<string, unknown>) => config.build_review,
      expected: { enabled: false },
    },
    {
      name: 'auto_restart_on_stale_engine',
      userYaml: 'auto_restart_on_stale_engine: true\n',
      select: (config: Record<string, unknown>) =>
        config.auto_restart_on_stale_engine,
      expected: true,
    },
    {
      name: 'engine_refresh_min_interval_seconds',
      userYaml: 'engine_refresh_min_interval_seconds: 42\n',
      select: (config: Record<string, unknown>) =>
        config.engine_refresh_min_interval_seconds,
      expected: 42,
    },
    {
      name: 'attribution_audit_sample_pct',
      userYaml: 'attribution_audit_sample_pct: 25\n',
      select: (config: Record<string, unknown>) =>
        config.attribution_audit_sample_pct,
      expected: 25,
    },
    {
      name: 'build_progress_halt',
      userYaml:
        'build_progress_halt:\n  enabled: false\n  attempt_ceiling: 31\n  dispatch_ceiling: 21\n',
      select: (config: Record<string, unknown>) => config.build_progress_halt,
      expected: {
        enabled: false,
        attempt_ceiling: 31,
        dispatch_ceiling: 21,
      },
    },
    {
      name: 'kickback_escalation',
      userYaml: 'kickback_escalation:\n  enabled: false\n',
      select: (config: Record<string, unknown>) => config.kickback_escalation,
      expected: { enabled: false },
    },
    {
      name: 'retry_routing',
      userYaml: 'retry_routing:\n  enabled: false\n',
      select: (config: Record<string, unknown>) => config.retry_routing,
      expected: { enabled: false },
    },
  ])('preserves user-only $name when the project omits it', async ({ userYaml, select, expected }) => {
    const projectRoot = await makeConfigPair(userYaml);
    const result = await loadMergedConfig(projectRoot);

    expect(result.ok ? select(result.config) : result).toEqual(expected);
  });
});
