// ─────────────────────────────────────────────────────────────────────────────
// Acceptance specs — Daemon merged configuration (#967)
//
// Stories: .docs/stories/daemon-merged-config-967.md
// Plan:    .docs/plans/2026-07-26-daemon-merged-config-967.md
//
// TRACK: technical (no PRD in .docs/specs/) — no FR-coverage table applies.
//
// These specs drive the REAL production entry point `runDaemonMode`
// (src/daemon-cli.ts) — NOT `loadMergedConfig` directly. #967 is a REPLACEMENT
// task (swap the daemon composition root's project-only `loadConfig` for the
// merged boundary), so per the acceptance-spec rules a unit test that calls the
// merged loader directly would pass while the daemon still reads project-only
// config. Everything below therefore asserts an OBSERVABLE artifact of a real
// daemon launch: a thrown startup error, the persisted `.daemon/daemon.log`,
// or whether backlog discovery was reached at all.
//
// Production call sites of the daemon's effective-config derivation (§3d):
//   - src/conductor/src/daemon-cli.ts:497  runDaemonMode  (the only one)
//   - src/conductor/src/index.ts:650       main → runDaemonMode (direct launch)
//   - src/conductor/src/engine/daemon-tmux.ts:25 DAEMON_FOREGROUND_COMMAND
//     ('conduct-ts daemon --continuous') — the supervised launch, which routes
//     back through main → runDaemonMode. Covered by the Story 3 spec below.
//
// OBSERVATION TECHNIQUE. The daemon exposes no "print your effective config"
// seam, so effective `llm_provider` / `steps.*.llm_provider` selection is
// observed through the production guard that already reads it before any
// dispatch: `validateRegisteredProviderSelections` throws naming the FIRST
// unregistered provider in the effective selection. Registered built-ins are
// exactly `claude` and `codex` (plugin-loader.ts registerBuiltins), so a
// deliberately-unregistered sentinel name ("ghost-*") placed in one scope makes
// that scope's contribution to the effective config directly observable:
//   - sentinel survives  → that scope's value reached the daemon runtime
//   - sentinel vanishes  → that scope's value was overridden/replaced
// Nested non-provider policy is observed through two other pre-dispatch
// production log lines: the self-host activation line (`harness_self_host`) and
// the memory-provider fallback warning (`memory_provider`).
//
// No LLM, tmux, GitHub, or real backlog work: `ensureFresh` is a no-op and
// `workSource.discover` is a spy returning an empty backlog, so each launch
// drains once and returns.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDaemonMode } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';
import { DAEMON_FOREGROUND_COMMAND } from '../../src/engine/daemon-tmux.js';
import { detectDaemonCommand, detectDaemonSupervisorCommand } from '../../src/engine/daemon-command.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { CodexProvider } from '../../src/execution/codex-provider.js';
import type { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { HarnessConfig } from '../../src/types/index.js';
import type { Options } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

type ExecaLongCall = (file: string, args: readonly string[], options?: Options) => ReturnType<typeof execa>;
const mockExeca = vi.mocked(execa as unknown as ExecaLongCall);

// `HOME` is process-global. The aggregate suite runs test files concurrently,
// so redirect the user-config adapter for this file rather than mutating HOME
// while another daemon test is resolving its own configuration.
const userConfigFixture = vi.hoisted(() => ({ path: '' }));
const codexDoctorTimeouts = vi.hoisted(() => [] as Array<number | undefined>);
const registeredProviderRoots = vi.hoisted(() => [] as PluginRegistry[]);
const daemonResolvedConfigs = vi.hoisted(() => [] as HarnessConfig[]);

vi.mock('../../src/engine/user-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/user-config.js')>();
  return {
    ...actual,
    readUserConfig: (path?: string) => actual.readUserConfig(path ?? userConfigFixture.path),
  };
});

vi.mock('../../src/engine/plugin-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/plugin-loader.js')>();
  return {
    ...actual,
    registerBuiltins: (...args: Parameters<typeof actual.registerBuiltins>) => {
      codexDoctorTimeouts.push(args[4]);
      registeredProviderRoots.push(args[0]);
      return actual.registerBuiltins(...args);
    },
  };
});

vi.mock('../../src/engine/self-host/detector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/self-host/detector.js')>();
  return {
    ...actual,
    classifySelfHost: async (...args: Parameters<typeof actual.classifySelfHost>) => {
      if (args[1]) daemonResolvedConfigs.push(args[1]);
      return actual.classifySelfHost(...args);
    },
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  userConfigFixture.path = '';
  codexDoctorTimeouts.splice(0);
  registeredProviderRoots.splice(0);
  daemonResolvedConfigs.splice(0);
  mockExeca.mockReset();
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/** A temp $HOME carrying (or deliberately lacking) ~/.ai-conductor/config.yml. */
async function makeUserHome(yaml?: string): Promise<string> {
  const home = await tempDir('daemon-967-home-');
  if (yaml !== undefined) {
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), yaml, 'utf8');
  }
  return home;
}

/** A temp project root carrying .ai-conductor/config.yml. */
async function makeProject(yaml: string): Promise<string> {
  const root = await tempDir('daemon-967-project-');
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), yaml, 'utf8');
  return root;
}

interface LaunchResult {
  /** Startup error message, or undefined when the daemon drained cleanly. */
  error?: string;
  /** How many times backlog discovery ran (0 ⇒ failed before dispatch). */
  dispatchCount: number;
  /** Persisted .daemon/daemon.log contents ('' when never opened). */
  log: string;
  /** Console output produced during the launch. */
  console: string;
}

/**
 * Launch the REAL daemon entry point against an isolated user + project config
 * pair and report every observable artifact of that launch.
 */
async function launchDaemon(home: string, projectRoot: string): Promise<LaunchResult> {
  const discover = vi.fn(async () => []);
  const consoleLines: string[] = [];
  const originalLog = console.log;
  console.log = (msg?: unknown) => {
    consoleLines.push(String(msg));
  };
  userConfigFixture.path = join(home, '.ai-conductor', 'config.yml');

  let error: string | undefined;
  try {
    await runDaemonMode({
      projectRoot,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      workSource: { discover },
      watch: false,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    console.log = originalLog;
  }

  const log = await readFile(daemonLogPath(projectRoot), 'utf8').catch(() => '');
  return { error, dispatchCount: discover.mock.calls.length, log, console: consoleLines.join('\n') };
}

// A project config that declares NO runtime policy the specs care about, so the
// user scope is the only contributor. `auto_restart_on_stale_engine` is an inert
// known key that merely makes the project config file present and valid.
const PROJECT_WITHOUT_POLICY = 'auto_restart_on_stale_engine: false\n';

describe('#1039 Story 4 — daemon Codex readiness timeout composition', () => {
  it('passes the resolved doctor timeout without changing provider, invocation, or auth-park timeouts', async () => {
    const home = await makeUserHome('codex_doctor_timeout_seconds: 30\n');
    const project = await makeProject([
      'codex_doctor_timeout_seconds: 2.5',
      'harness_self_host:',
      '  auth_park_timeout_minutes: 7',
      'test_suite:',
      '  command: npm test',
      '  timeout_seconds: 41',
      '',
    ].join('\n'));

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(codexDoctorTimeouts).toEqual([2.5]);
    mockExeca.mockReset();
    const registry = registeredProviderRoots[0];
    expect(registry).toBeDefined();
    const codex = registry!.get<CodexProvider>('llm_provider', 'codex');
    const claude = registry!.get<{ invoke(options: InvokeOptions): Promise<unknown> }>('llm_provider', 'claude');
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          schemaVersion: 1,
          auth: { selectedMode: 'cached-login', configured: true },
          transport: { authenticated: true },
        }),
        stderr: '',
        exitCode: 0,
      } as never)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
        stderr: '',
        exitCode: 0,
      } as never)
      .mockResolvedValueOnce({ stdout: JSON.stringify({ result: 'done' }), stderr: '', exitCode: 0 } as never);

    const invokeOptions: InvokeOptions = {
      prompt: 'composition probe', sessionId: 'daemon-composition', resume: false, cwd: project,
    };
    await codex.invoke(invokeOptions);
    await claude.invoke(invokeOptions);

    expect(mockExeca.mock.calls.map(([command, args, options]) => ({
      command,
      doctor: args.includes('doctor'),
      timeout: options?.timeout,
    }))).toEqual([
      { command: 'codex', doctor: true, timeout: 2_500 },
      { command: 'codex', doctor: false, timeout: undefined },
      { command: 'claude', doctor: false, timeout: undefined },
    ]);
    expect(daemonResolvedConfigs[0]).toMatchObject({
      codex_doctor_timeout_seconds: 2.5,
      harness_self_host: { auth_park_timeout_minutes: 7 },
      test_suite: { timeout_seconds: 41 },
    });
  });
});

describe('#967 Story 1 — daemon inherits machine-scoped runtime policy', () => {
  it('happy: a user-only llm_provider selection reaches daemon provider construction with codex first', async () => {
    // The user selects codex first, with an unregistered sentinel behind it.
    // If the user scope reaches the daemon, provider validation walks the
    // selection IN ORDER: codex is accepted (registered built-in) and the
    // sentinel behind it is what raises — proving both that the user selection
    // was consumed and that codex occupies the leading position.
    const home = await makeUserHome('llm_provider: [codex, ghost-user-tail]\n');
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/llm_provider names unknown provider "ghost-user-tail"/);
    expect(result.error).not.toMatch(/unknown provider "codex"/);
    expect(result.dispatchCount).toBe(0);
  });

  it('happy: user-only nested runtime policy survives into the daemon runtime', async () => {
    // Two independent user-only settings, each with a pre-dispatch production
    // observable: harness_self_host.activation (self-host log line) and
    // memory_provider (uninstalled-provider warning).
    const home = await makeUserHome(
      'harness_self_host:\n  activation: force_on\nmemory_provider: ghost-user-memory\n',
    );
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(result.log).toContain('self-host mode active');
    expect(result.log).toContain('memory_provider "ghost-user-memory" is not installed');
  });

  it('happy: user-only per-step runtime policy reaches the daemon runtime', async () => {
    const home = await makeUserHome('steps:\n  build:\n    llm_provider: ghost-user-step\n');
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(
      /steps\.build\.llm_provider names unknown provider "ghost-user-step"/,
    );
    expect(result.dispatchCount).toBe(0);
  });

  it('negative: malformed user YAML fails before backlog dispatch, naming the user scope', async () => {
    const home = await makeUserHome('bad: yaml:\n  : broken\n');
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/Config error:/);
    expect(result.error).toMatch(/user config parse error/);
    expect(result.dispatchCount).toBe(0);
  });

  it('negative: a user-only unregistered provider is rejected before backlog dispatch, not silently ignored', async () => {
    const home = await makeUserHome('llm_provider: ghost-user-only\n');
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/llm_provider names unknown provider "ghost-user-only"/);
    expect(result.dispatchCount).toBe(0);
  });
});

describe('#967 Story 2 — project policy retains precise precedence', () => {
  it('happy: project provider selection overrides the user selection', async () => {
    // User selects codex; project selects an unregistered sentinel. The daemon
    // must raise on the PROJECT sentinel (project wins) and never fall back to
    // the user's codex selection.
    const home = await makeUserHome('llm_provider: codex\n');
    const project = await makeProject('llm_provider: [ghost-project-first]\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/llm_provider names unknown provider "ghost-project-first"/);
    expect(result.dispatchCount).toBe(0);
  });

  it('happy: project keys override matching user keys inside the same nested object while unrelated user keys survive', async () => {
    // steps.build: both scopes declare it → project's `claude` must win.
    // steps.plan: user only → must survive the merge and raise.
    const home = await makeUserHome(
      'steps:\n  build:\n    llm_provider: ghost-user-build\n  plan:\n    llm_provider: ghost-user-plan\n',
    );
    const project = await makeProject('steps:\n  build:\n    llm_provider: claude\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(
      /steps\.plan\.llm_provider names unknown provider "ghost-user-plan"/,
    );
    expect(result.error).not.toMatch(/ghost-user-build/);
    expect(result.dispatchCount).toBe(0);
  });

  it('negative: a project array replaces the user array rather than concatenating or index-merging it', async () => {
    // User array is entirely unregistered sentinels. If the merge concatenated
    // (either order) or index-merged, a sentinel would survive and startup
    // would fail; clean replacement leaves only registered providers.
    const home = await makeUserHome('llm_provider: [ghost-user-a, ghost-user-b]\n');
    const project = await makeProject('llm_provider: [claude, codex]\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(result.dispatchCount).toBeGreaterThan(0);
  });

  it('negative: a project scalar replaces the user scalar rather than merging with it', async () => {
    const home = await makeUserHome('llm_provider: ghost-user-scalar\n');
    const project = await makeProject('llm_provider: claude\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(result.dispatchCount).toBeGreaterThan(0);
  });

  it('negative: an invalid raw project value is not laundered into a valid effective configuration by the merge', async () => {
    // The project's empty provider array is rejected by raw-project validation.
    // A valid user selection must NOT rescue it via the merge.
    const home = await makeUserHome('llm_provider: [claude]\n');
    const project = await makeProject('llm_provider: []\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/Config error:/);
    expect(result.error).toMatch(/llm_provider.*non-empty/i);
    expect(result.dispatchCount).toBe(0);
  });

  it('negative: the project-scope spec_owner anti-leak guard still fires under merged loading', async () => {
    // spec_owner is legitimate in the USER scope and forbidden in the PROJECT
    // scope. Merging must not relax the source-specific project guard.
    const home = await makeUserHome('spec_owner: user-operator\n');
    const project = await makeProject('spec_owner: project-operator\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/Config error:/);
    expect(result.error).toMatch(/spec_owner must not be set in a project config/);
    expect(result.dispatchCount).toBe(0);
  });
});

describe('#967 Story 3 — every daemon launch uses one effective-config boundary', () => {
  it('happy: the supervised foreground launch resolves to the same daemon run command as a direct launch', async () => {
    // The supervisor starts the daemon by running DAEMON_FOREGROUND_COMMAND in
    // a tmux pane. Parsing that command's argv with the PRODUCTION dispatchers
    // proves it is not intercepted by a management verb and lands on the same
    // `daemon` run command that main() routes into runDaemonMode — i.e. both
    // launch paths converge on one composition root, and therefore on one
    // effective-config boundary.
    const supervisedArgv = ['node', ...DAEMON_FOREGROUND_COMMAND.split(' ')];

    expect(detectDaemonSupervisorCommand(supervisedArgv)).toBeNull();
    const daemonCmd = detectDaemonCommand(supervisedArgv);
    expect(daemonCmd).not.toBeNull();
    expect(daemonCmd?.continuous).toBe(true);

    // The direct launch is the same argv shape without --continuous.
    expect(detectDaemonCommand(['node', 'conduct-ts', 'daemon'])).not.toBeNull();
  });

  it('happy: with no user configuration present, project-only configuration behaves exactly as before', async () => {
    const home = await makeUserHome(); // no ~/.ai-conductor/config.yml at all
    const project = await makeProject('llm_provider: [claude]\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(result.dispatchCount).toBeGreaterThan(0);
  });

  it('happy: with no user configuration present, an invalid project provider still fails before dispatch', async () => {
    const home = await makeUserHome();
    const project = await makeProject('llm_provider: [ghost-project-only]\n');

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/llm_provider names unknown provider "ghost-project-only"/);
    expect(result.dispatchCount).toBe(0);
  });

  it('negative: when neither scope selects an LLM provider the default-provider behavior is unchanged', async () => {
    const home = await makeUserHome('memory_provider: local\n');
    const project = await makeProject(PROJECT_WITHOUT_POLICY);

    const result = await launchDaemon(home, project);

    expect(result.error).toBeUndefined();
    expect(result.dispatchCount).toBeGreaterThan(0);
    expect(result.log).not.toContain('names unknown provider');
  });

  it('negative: the machine-identity source boundary is not converted to merged configuration', async () => {
    // Owner identity is deliberately user-scoped ONLY (daemon-cli.ts ~1177).
    // Merging the runtime config must not make a project-declared spec_owner
    // acceptable — the project-scope guard remains the fail-closed boundary.
    const home = await makeUserHome('spec_owner: machine-operator\n');
    const project = await makeProject(`${PROJECT_WITHOUT_POLICY}spec_owner: repo-operator\n`);

    const result = await launchDaemon(home, project);

    expect(result.error).toMatch(/spec_owner must not be set in a project config/);
    expect(result.dispatchCount).toBe(0);
  });
});
