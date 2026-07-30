import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const DEFAULT_CASES = [
  {
    name: 'ci_watch',
    select: (config: Record<string, unknown>) => config.ci_watch,
    expected: { enabled: true },
  },
  {
    name: 'build_review',
    select: (config: Record<string, unknown>) => config.build_review,
    expected: { enabled: true },
  },
  {
    name: 'auto_restart_on_stale_engine',
    select: (config: Record<string, unknown>) => config.auto_restart_on_stale_engine,
    expected: false,
  },
  {
    name: 'engine_refresh_min_interval_seconds',
    select: (config: Record<string, unknown>) =>
      config.engine_refresh_min_interval_seconds,
    expected: 300,
  },
  {
    name: 'attribution_audit_sample_pct',
    select: (config: Record<string, unknown>) => config.attribution_audit_sample_pct,
    expected: 10,
  },
  {
    name: 'build_progress_halt',
    select: (config: Record<string, unknown>) => config.build_progress_halt,
    expected: {
      enabled: true,
      attempt_ceiling: 30,
      dispatch_ceiling: 20,
    },
  },
  {
    name: 'kickback_escalation',
    select: (config: Record<string, unknown>) => config.kickback_escalation,
    expected: { enabled: true },
  },
  {
    name: 'retry_routing',
    select: (config: Record<string, unknown>) => config.retry_routing,
    expected: { enabled: true },
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

  it.each(DEFAULT_CASES)(
    'materializes the effective $name default when both scopes omit it',
    async ({ select, expected }) => {
      const projectRoot = await makeConfigPair(undefined);
      const result = await loadMergedConfig(projectRoot);

      expect(result.ok ? select(result.config) : result).toEqual(expected);
    },
  );

  it('emits a project normalization warning only once across both validation passes', async () => {
    const projectRoot = await makeConfigPair(
      undefined,
      'attribution_audit_sample_pct: 150\n',
    );

    const result = await loadMergedConfig(projectRoot);

    expect(
      result.ok
        ? {
            value: result.config.attribution_audit_sample_pct,
            warnings: result.warnings,
          }
        : result,
    ).toEqual({
      value: 100,
      warnings: [
        'attribution_audit_sample_pct out of range [0, 100]; clamped to 100.',
      ],
    });
  });

  it('rejects a malformed user-only retry_routing value', async () => {
    const projectRoot = await makeConfigPair(
      'retry_routing:\n  enabled: banana\n',
    );

    const result = await loadMergedConfig(projectRoot);

    expect(
      result.ok
        ? result.config.retry_routing
        : {
            type: result.error.type,
            message: result.error.message,
          },
    ).toEqual({
      type: 'validation_error',
      message: 'retry_routing.enabled must be a boolean',
    });
  });

  it('clamps a malformed user-only attribution sample with one warning', async () => {
    const projectRoot = await makeConfigPair(
      'attribution_audit_sample_pct: 150\n',
    );

    const result = await loadMergedConfig(projectRoot);

    expect(
      result.ok
        ? {
            value: result.config.attribution_audit_sample_pct,
            warnings: result.warnings,
          }
        : result,
    ).toEqual({
      value: 100,
      warnings: [
        'attribution_audit_sample_pct out of range [0, 100]; clamped to 100.',
      ],
    });
  });

  it('rejects malformed project retry_routing before it can expose the user value', async () => {
    const userYaml = 'retry_routing:\n  enabled: false\n';
    const projectYaml = 'retry_routing:\n  enabled: banana\n';
    const projectRoot = await makeConfigPair(userYaml, projectYaml);

    const result = await loadMergedConfig(projectRoot);
    const [projectAfter, userAfter] = await Promise.all([
      readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8'),
      readFile(userConfigFixture.path, 'utf8'),
    ]);

    expect({
      outcome: result.ok
        ? { effective: result.config.retry_routing }
        : {
            type: result.error.type,
            message: result.error.message,
          },
      sources: { projectAfter, userAfter },
    }).toEqual({
      outcome: {
        type: 'validation_error',
        message: 'retry_routing.enabled must be a boolean',
      },
      sources: {
        projectAfter: projectYaml,
        userAfter: userYaml,
      },
    });
  });

  it('keeps a normalized project attribution clamp authoritative over the user value', async () => {
    const userYaml = 'attribution_audit_sample_pct: 25\n';
    const projectYaml = 'attribution_audit_sample_pct: 150\n';
    const projectRoot = await makeConfigPair(userYaml, projectYaml);

    const result = await loadMergedConfig(projectRoot);
    const [projectAfter, userAfter] = await Promise.all([
      readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8'),
      readFile(userConfigFixture.path, 'utf8'),
    ]);

    expect({
      outcome: result.ok
        ? {
            value: result.config.attribution_audit_sample_pct,
            warnings: result.warnings,
          }
        : result,
      sources: { projectAfter, userAfter },
    }).toEqual({
      outcome: {
        value: 100,
        warnings: [
          'attribution_audit_sample_pct out of range [0, 100]; clamped to 100.',
        ],
      },
      sources: {
        projectAfter: projectYaml,
        userAfter: userYaml,
      },
    });
  });

  it('preserves deep-merge semantics alongside project block normalization', async () => {
    const projectRoot = await makeConfigPair(
      [
        'defaults:',
        '  effort: low',
        '  max_retries: 2',
        'validation_concurrency: 1',
        'model_fallback_ladder: [fable, opus]',
        'ci_watch:',
        '  enabled: false',
        '',
      ].join('\n'),
      [
        'defaults:',
        '  model: opus',
        '  effort: high',
        'validation_concurrency: 3',
        'model_fallback_ladder: [sonnet]',
        'ci_watch: {}',
        '',
      ].join('\n'),
    );

    const result = await loadMergedConfig(projectRoot);

    expect(
      result.ok
        ? {
            defaults: result.config.defaults,
            validation_concurrency: result.config.validation_concurrency,
            model_fallback_ladder: result.config.model_fallback_ladder,
            ci_watch: result.config.ci_watch,
          }
        : result,
    ).toEqual({
      defaults: {
        effort: 'high',
        max_retries: 2,
        model: 'opus',
      },
      validation_concurrency: 3,
      model_fallback_ladder: ['sonnet'],
      ci_watch: { enabled: true },
    });
  });

  it('rejects project spec_owner before merge without mutating either source', async () => {
    const userYaml = 'spec_owner: user-owner\n';
    const projectYaml = 'spec_owner: project-owner\n';
    const projectRoot = await makeConfigPair(userYaml, projectYaml);

    const result = await loadMergedConfig(projectRoot);
    const [projectAfter, userAfter] = await Promise.all([
      readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8'),
      readFile(userConfigFixture.path, 'utf8'),
    ]);

    expect({
      outcome: result.ok
        ? { effectiveOwner: result.config.spec_owner }
        : {
            type: result.error.type,
            message: result.error.message,
          },
      sources: { projectAfter, userAfter },
    }).toEqual({
      outcome: {
        type: 'validation_error',
        message:
          `spec_owner must not be set in a project config (${join(projectRoot, '.ai-conductor', 'config.yml')}): ` +
          'it would leak your operator identity to everyone who pulls the repo. ' +
          'Move spec_owner to your user config at ~/.ai-conductor/config.yml.',
      },
      sources: {
        projectAfter: projectYaml,
        userAfter: userYaml,
      },
    });
  });
});
