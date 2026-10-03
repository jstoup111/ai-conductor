// Covers: task:4, task:5, task:6, task:7, task:8
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
    isAttachedTerminal: () => true,
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
  it('reuses the initially selected host executable for a follow-on idea', async () => {
    vi.stubEnv('CODEX_EXECUTABLE', '/hosts/initial-codex');
    const spawnHost = vi.fn(async () => {
      process.env.CODEX_EXECUTABLE = '/hosts/replaced-codex';
      return 0;
    });
    const confirmAnother = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex', idea: 'add retries' },
      {
        ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
        confirmAnother,
      },
    );

    expect({ code, spawnCalls: spawnHost.mock.calls, confirmCalls: confirmAnother.mock.calls }).toEqual({
      code: 0,
      spawnCalls: [
        ['/hosts/initial-codex', ['exec'], process.cwd()],
        ['/hosts/initial-codex', ['exec'], process.cwd()],
      ],
      confirmCalls: [[], []],
    });
  });

  it('returns the first selected-host exit code when follow-on work is declined', async () => {
    const spawnHost = vi.fn(async () => 23);
    const confirmAnother = vi.fn(async () => false);

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      {
        ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
        confirmAnother,
      },
    );

    expect({ code, spawnCalls: spawnHost.mock.calls, confirmCalls: confirmAnother.mock.calls }).toEqual({
      code: 23,
      spawnCalls: [['codex', ['exec'], process.cwd()]],
      confirmCalls: [[]],
    });
  });

  it('refuses a nested codex session before loading config, polling, or spawning', async () => {
    const spawnHost = vi.fn(async () => 0);
    const prePoll = vi.fn(async () => 0);
    const loadLaunchConfig = vi.fn(async () => ({ ok: true as const, config: {}, warnings: [] }));
    const gh = vi.fn(async () => ({ stdout: '' }));
    const print = vi.fn();

    const code = await dispatchEngineer({ kind: 'launch' }, {
      ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost, { CODEX_THREAD_ID: 'thread' }),
      loadLaunchConfig,
      prePoll,
      gh,
      print,
    });

    expect({ code, output: print.mock.calls.flat(), spawnCalls: spawnHost.mock.calls, prePollCalls: prePoll.mock.calls, configCalls: loadLaunchConfig.mock.calls, ghCalls: gh.mock.calls })
      .toEqual({
        code: 0,
        output: expect.arrayContaining([expect.stringContaining('$composer')]),
        spawnCalls: [],
        prePollCalls: [],
        configCalls: [],
        ghCalls: [],
      });
  });

  it.each([
    [{ CLAUDECODE: '1' }, '/composer'],
    [{ CODEX_SESSION_ID: 'session' }, '$composer'],
  ])('refuses each interactive host marker %o before polling or spawning', async (env, invocation) => {
    const spawnHost = vi.fn(async () => 0);
    const prePoll = vi.fn(async () => 0);
    const print = vi.fn();

    const code = await dispatchEngineer({ kind: 'launch' }, {
      ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost, env),
      prePoll,
      print,
    });

    expect({ code, output: print.mock.calls.flat(), spawnCalls: spawnHost.mock.calls, prePollCalls: prePoll.mock.calls })
      .toEqual({
        code: 0,
        output: expect.arrayContaining([expect.stringContaining(invocation)]),
        spawnCalls: [],
        prePollCalls: [],
      });
  });

  it('uses a detected codex marker even when a different provider flag is supplied', async () => {
    const spawnHost = vi.fn(async () => 0);
    const print = vi.fn();

    const code = await dispatchEngineer({ kind: 'launch', provider: 'claude' }, {
      ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost, { CODEX_THREAD_ID: 'thread' }),
      print,
    });

    expect({ code, output: print.mock.calls.flat(), spawnCalls: spawnHost.mock.calls }).toEqual({
      code: 0,
      output: expect.arrayContaining([expect.stringContaining('$composer')]),
      spawnCalls: [],
    });
  });

  it('maps the legacy nested-session seam to the default host marker', async () => {
    const spawnHost = vi.fn(async () => 0);
    const print = vi.fn();

    const code = await dispatchEngineer({ kind: 'launch' }, {
      ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
      insideClaudeSession: true,
      print,
    });

    expect({ code, output: print.mock.calls.flat(), spawnCalls: spawnHost.mock.calls }).toEqual({
      code: 0,
      output: expect.arrayContaining([expect.stringContaining('/composer')]),
      spawnCalls: [],
    });
  });

  it('launches the selected host when no interactive session marker is present', async () => {
    const spawnHost = vi.fn(async () => 0);

    await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
    );

    expect(spawnHost).toHaveBeenCalledTimes(1);
  });

  it('reports a missing selected executable without discovery or fallback', async () => {
    const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const spawnHost = vi.fn(async () => Promise.reject(missing));
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      { ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost), printErr },
    );

    expect({
      code,
      diagnostics: printErr.mock.calls.flat(),
      spawnCalls: spawnHost.mock.calls,
    }).toEqual({
      code: 1,
      diagnostics: expect.arrayContaining([
        'engineer: could not launch codex executable codex (spawn codex ENOENT). ' +
          'Install it or set CODEX_EXECUTABLE; if already in a session, run $composer directly.',
      ]),
      spawnCalls: [['codex', ['exec'], process.cwd()]],
    });
  });

  it('reports the resolved CODEX_EXECUTABLE when it is missing', async () => {
    vi.stubEnv('CODEX_EXECUTABLE', '/opt/missing/codex');
    const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const spawnHost = vi.fn(async () => Promise.reject(missing));
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      { ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost), printErr },
    );

    expect([code, printErr.mock.calls.flat(), spawnHost.mock.calls]).toEqual([
      1,
      expect.arrayContaining([expect.stringContaining('/opt/missing/codex'), expect.stringContaining('CODEX_EXECUTABLE'), expect.stringContaining('$composer')]),
      [['/opt/missing/codex', ['exec'], process.cwd()]],
    ]);
  });

  it('launches the selected host without a discovery or version probe', async () => {
    const spawnHost = vi.fn(async () => 0);

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'claude' },
      launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
    );

    expect({ code, spawnCalls: spawnHost.mock.calls })
      .toEqual({
        code: 0,
        spawnCalls: [['claude', ['--permission-mode', 'default', '/composer'], process.cwd()]],
      });
  });

  it('keeps the selected host when a later loop spawn is missing', async () => {
    const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const spawnHost = vi.fn()
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(missing);
    const confirmAnother = vi.fn(async () => true);
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      {
        ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
        confirmAnother,
        printErr,
      },
    );

    expect({ code, diagnostics: printErr.mock.calls.flat(), spawnCalls: spawnHost.mock.calls, confirmCalls: confirmAnother.mock.calls })
      .toEqual({
        code: 1,
        diagnostics: expect.arrayContaining([
          'engineer: could not launch codex executable codex (spawn codex ENOENT). ' +
            'Install it or set CODEX_EXECUTABLE; if already in a session, run $composer directly.',
        ]),
        spawnCalls: [['codex', ['exec'], process.cwd()], ['codex', ['exec'], process.cwd()]],
        confirmCalls: [[]],
      });
  });

  it('refuses a configured provider without interactive launch capability before spawning', async () => {
    const spawnHost = vi.fn(async () => 0);
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch' },
      { ...launchOptions({ ok: true, config: { llm_provider: 'pi' }, warnings: [] }, spawnHost), printErr },
    );

    expect([code, printErr.mock.calls.flat(), spawnHost.mock.calls.length]).toEqual([
      1,
      expect.arrayContaining([expect.stringContaining('pi'), expect.stringContaining('interactiveLaunch'), expect.stringContaining('#1007')]),
      0,
    ]);
  });

  it('refuses an unknown launch provider before spawning', async () => {
    const spawnHost = vi.fn(async () => 0);
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'gemini' },
      { ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost), printErr },
    );

    expect([code, printErr.mock.calls.flat(), spawnHost.mock.calls.length]).toEqual([
      1,
      expect.arrayContaining([expect.stringContaining('names unknown provider'), expect.stringContaining('gemini')]),
      0,
    ]);
  });

  it.each([
    { type: 'parse_error' as const, message: 'configuration YAML is malformed' },
    { type: 'validation_error' as const, message: 'configuration llm_provider is invalid' },
  ])('reports a $type launch configuration error before spawning', async (error) => {
    const spawnHost = vi.fn(async () => 0);
    const printErr = vi.fn();

    const code = await dispatchEngineer(
      { kind: 'launch' },
      { ...launchOptions({ ok: false, error }, spawnHost), printErr },
    );

    expect([code, printErr.mock.calls.flat(), spawnHost.mock.calls.length]).toEqual([
      1,
      expect.arrayContaining([expect.stringContaining(error.message)]),
      0,
    ]);
  });

  it('normalizes plan permission mode through the selected host descriptor', async () => {
    const spawnHost = vi.fn(async () => 0);

    await dispatchEngineer(
      { kind: 'launch', provider: 'claude' },
      launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost, { CONDUCT_ENGINEER_PERMISSION_MODE: 'plan' }),
    );

    expect(spawnHost).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--permission-mode', 'default']),
      process.cwd(),
    );
  });

  it('launches the host selected by the resolved configuration', async () => {
    const spawnHost = vi.fn(async () => 0);

    await dispatchEngineer(
      { kind: 'launch' },
      launchOptions({ ok: true, config: { llm_provider: 'codex' }, warnings: [] }, spawnHost),
    );

    expect(spawnHost).toHaveBeenCalledWith('codex', ['exec'], process.cwd());
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
      ['codex', ['exec'], process.cwd()],
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
      ['/opt/hosts/codex', ['exec'], process.cwd()],
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
      isAttachedTerminal: () => true,
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
        env: {},
        prePoll: async () => 0,
        confirmAnother: () => false,
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        isAttachedTerminal: () => true,
      });
    } finally {
      process.chdir(originalDirectory);
      await rm(root, { recursive: true, force: true });
    }

    expect(spawnHost).toHaveBeenCalledWith('codex', ['exec'], project);
  });

  it('accepts user-only configuration keys when the launching project has none', async () => {
    const originalDirectory = process.cwd();
    const root = await mkdtemp(join(tmpdir(), 'compose-launch-user-'));
    const project = join(root, 'project');
    const home = join(root, 'home');
    await mkdir(project, { recursive: true });
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), [
      'llm_provider: codex',
      'conductor:',
      '  update_channel: stable',
      'spec_owner: operator',
      'github_bot:',
      '  token_file: ~/bot-token',
      '',
    ].join('\n'));
    vi.stubEnv('HOME', home);
    process.chdir(project);
    const spawnHost = vi.fn(async () => 0);

    try {
      const code = await dispatchEngineer({ kind: 'launch' }, {
        spawnHost,
        env: {},
        prePoll: async () => 0,
        confirmAnother: () => false,
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        isAttachedTerminal: () => true,
      });
      expect(code).toBe(0);
    } finally {
      process.chdir(originalDirectory);
      await rm(root, { recursive: true, force: true });
    }

    expect(spawnHost).toHaveBeenCalledWith('codex', ['exec'], project);
  });

  it.each(['claude', 'codex'] as const)('refuses %s without an attached terminal before configuration, polling, or spawning', async (provider) => {
    const spawnHost = vi.fn(async () => 0);
    const prePoll = vi.fn(async () => 0);
    const loadLaunchConfig = vi.fn(async () => ({ ok: true as const, config: {}, warnings: [] }));
    const printErr = vi.fn();

    const code = await dispatchEngineer({ kind: 'launch', provider }, {
      ...launchOptions({ ok: true, config: {}, warnings: [] }, spawnHost),
      isAttachedTerminal: () => false,
      loadLaunchConfig,
      prePoll,
      printErr,
    });

    expect([code, printErr.mock.calls.flat(), spawnHost.mock.calls, prePoll.mock.calls, loadLaunchConfig.mock.calls]).toEqual([
      1,
      expect.arrayContaining([expect.stringContaining('interactive terminal is required')]),
      [],
      [],
      [],
    ]);
  });
});
