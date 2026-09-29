// Covers: task:4
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import type { ConfigResult } from '../../../src/engine/config.js';

function launchOptions(
  config: ConfigResult,
  spawnHost: NonNullable<DispatchEngineerOpts['spawnHost']>,
  env: NodeJS.ProcessEnv = {},
): DispatchEngineerOpts {
  return {
    loadLaunchConfig: async () => config,
    spawnHost,
    env,
    prePoll: async () => 0,
    confirmAnother: () => false,
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dispatchEngineer interactive host launch', () => {
  it('launches the host selected by the resolved configuration', async () => {
    const spawnHost = vi.fn(async () => 0);

    await dispatchEngineer(
      { kind: 'launch' },
      launchOptions({ ok: true, config: { llm_provider: 'codex' }, warnings: [] }, spawnHost),
    );

    expect(spawnHost).toHaveBeenCalledWith('codex', ['$composer'], process.cwd());
  });

  it.each([
    [{}, 'claude'],
    [{ llm_provider: 'codex' }, 'codex'],
    [{ llm_provider: ['codex', 'claude'] }, 'codex'],
    [{ llm_provider: ['codex', 'claude'], steps: { explore: { llm_provider: 'claude' } } }, 'claude'],
  ])('uses configuration selection %o', async (config, executable) => {
    const spawnHost = vi.fn(async () => 0);

    await dispatchEngineer({ kind: 'launch' }, launchOptions(
      { ok: true, config, warnings: [] }, spawnHost,
    ));

    expect(spawnHost).toHaveBeenCalledWith(executable, expect.any(Array), process.cwd());
  });

  it('lets the launch flag override configuration and shares alias argv behavior', async () => {
    const composeSpawn = vi.fn(async () => 0);
    const engineerSpawn = vi.fn(async () => 0);
    const config = { ok: true as const, config: { steps: { explore: { llm_provider: 'claude' } } }, warnings: [] };

    await dispatchEngineer({ kind: 'launch', provider: 'claude' }, launchOptions(config, composeSpawn));
    await dispatchEngineer(
      { kind: 'launch', provider: 'codex', idea: 'add retries', invokedVerb: 'engineer' },
      launchOptions(config, engineerSpawn),
    );

    expect([composeSpawn.mock.calls[0], engineerSpawn.mock.calls[0]]).toEqual([
      ['claude', ['--permission-mode', 'default', '/composer'], process.cwd()],
      ['codex', ['$composer add retries'], process.cwd()],
    ]);
  });

  it('uses catalog argv and executable overrides for each interactive host', async () => {
    vi.stubEnv('CODEX_EXECUTABLE', '/opt/hosts/codex');
    const codexSpawn = vi.fn(async () => 0);
    const claudeSpawn = vi.fn(async () => 0);

    await dispatchEngineer(
      { kind: 'launch', provider: 'codex', idea: 'add retries' },
      launchOptions({ ok: true, config: {}, warnings: [] }, codexSpawn),
    );
    await dispatchEngineer(
      { kind: 'launch', provider: 'claude' },
      launchOptions({ ok: true, config: {}, warnings: [] }, claudeSpawn, { CONDUCT_ENGINEER_PERMISSION_MODE: 'plan' }),
    );

    expect([codexSpawn.mock.calls[0], claudeSpawn.mock.calls[0]]).toEqual([
      ['/opt/hosts/codex', ['$composer add retries'], process.cwd()],
      ['claude', ['--permission-mode', 'default', '/composer'], process.cwd()],
    ]);
  });

  it('keeps the legacy launch seam ahead of configuration and host spawning', async () => {
    const launchInteractive = vi.fn(async () => 7);
    const spawnHost = vi.fn(async () => 0);

    const code = await dispatchEngineer({ kind: 'launch' }, {
      launchInteractive,
      spawnHost,
      loadLaunchConfig: async () => {
        throw new Error('must not load config for the legacy seam');
      },
      confirmAnother: () => false,
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    });

    expect([code, launchInteractive.mock.calls.length, spawnHost.mock.calls.length]).toEqual([7, 1, 0]);
  });

  it('falls back to user configuration when the launching project has none', async () => {
    const originalDirectory = process.cwd();
    const root = await mkdtemp(join(tmpdir(), 'compose-launch-user-'));
    const project = join(root, 'project');
    const home = join(root, 'home');
    await mkdir(project, { recursive: true });
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), 'llm_provider: codex\n');
    vi.stubEnv('HOME', home);
    process.chdir(project);
    const spawnHost = vi.fn(async () => 0);

    try {
      await dispatchEngineer({ kind: 'launch' }, {
        spawnHost,
        prePoll: async () => 0,
        confirmAnother: () => false,
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      });
    } finally {
      process.chdir(originalDirectory);
      await rm(root, { recursive: true, force: true });
    }

    expect(spawnHost).toHaveBeenCalledWith('codex', ['$composer'], project);
  });
});
