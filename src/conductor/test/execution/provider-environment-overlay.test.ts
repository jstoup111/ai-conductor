// Covers: task:1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import type { InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import { PiProvider, type PiEnvironment } from '../../src/execution/pi-provider.js';

const noGitGuard = async () => null;

const piEnvironment: PiEnvironment = {
  stat: async (path) => ({
    isFile: () => path === '/test-home/.agents/skills/HARNESS.md',
    isDirectory: () => false,
  }),
  access: async () => {},
  env: {},
  homeDir: () => '/test-home',
  cwd: () => '/test-project',
};

const baseOptions: InvokeOptions = {
  prompt: 'Run.',
  sessionId: 'session',
  resume: false,
};

const selfHost = {
  executable: 'isolated-provider',
  env: { GIT_CONFIG_KEY_0: 'self-host-value' },
  args: [],
  teardown: async () => {},
} as const;

type ProviderFixture = {
  provider: LLMProvider;
  spawnedEnvironment: () => NodeJS.ProcessEnv | undefined;
};

function createFixtures(): readonly ProviderFixture[] {
  const claudeEnvironments: NodeJS.ProcessEnv[] = [];
  const codexEnvironments: NodeJS.ProcessEnv[] = [];
  const piEnvironments: NodeJS.ProcessEnv[] = [];

  return [
    {
      provider: new ClaudeProvider(noGitGuard, undefined, ((_file: string, _args: string[], launch: ExecaOptions) => {
        claudeEnvironments.push(launch.env ?? {});
        return Promise.resolve({ stdout: JSON.stringify({ type: 'result', result: 'done' }), stderr: '', exitCode: 0, failed: false });
      }) as never),
      spawnedEnvironment: () => claudeEnvironments[0],
    },
    {
      provider: new CodexProvider(
        noGitGuard,
        (async () => ({
          stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
          exitCode: 0,
        })) as never,
        'codex',
        undefined,
        ((_file: string, _args: readonly string[], launch: ExecaOptions) => {
          codexEnvironments.push(launch.env ?? {});
          return Promise.resolve({
            stdout: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } })}\n${JSON.stringify({ type: 'turn.completed' })}`,
            stderr: '',
            exitCode: 0,
            failed: false,
          });
        }) as never,
      ),
      spawnedEnvironment: () => codexEnvironments[0],
    },
    {
      provider: new PiProvider(noGitGuard, 'pi', ((_file: string, _args: readonly string[], launch: ExecaOptions) => {
        piEnvironments.push(launch.env ?? {});
        return Promise.resolve({
          stdout: JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
          stderr: '',
          exitCode: 0,
        });
      }) as never, piEnvironment),
      spawnedEnvironment: () => piEnvironments[0],
    },
  ];
}

describe('provider environment overlays', () => {
  const originalGitConfigKey = process.env.GIT_CONFIG_KEY_0;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GIT_CONFIG_KEY_0;
  });

  afterEach(() => {
    if (originalGitConfigKey === undefined) delete process.env.GIT_CONFIG_KEY_0;
    else process.env.GIT_CONFIG_KEY_0 = originalGitConfigKey;
  });

  it('passes the environment overlay to every provider child after the self-host environment', async () => {
    for (const { provider, spawnedEnvironment } of createFixtures()) {
      await provider.invoke({
        ...baseOptions,
        selfHost,
        environmentOverlay: { GIT_CONFIG_KEY_0: 'core.hooksPath' },
      });

      expect(spawnedEnvironment()?.GIT_CONFIG_KEY_0).toBe('core.hooksPath');
    }
  });

  it('keeps the session marker and tmux masks authoritative over an environment overlay', async () => {
    for (const { provider, spawnedEnvironment } of createFixtures()) {
      await provider.invoke({
        ...baseOptions,
        environmentOverlay: {
          [DAEMON_SESSION_MARKER]: 'forged',
          TMUX: '/tmp/forged-tmux',
          TMUX_PANE: '%99',
        },
      });

      expect(spawnedEnvironment()).toMatchObject({
        [DAEMON_SESSION_MARKER]: '1',
        TMUX: undefined,
        TMUX_PANE: undefined,
      });
    }
  });

  it('does not add a Git config environment variable without an overlay', async () => {
    for (const { provider, spawnedEnvironment } of createFixtures()) {
      await provider.invoke(baseOptions);

      expect(spawnedEnvironment()?.GIT_CONFIG_KEY_0).toBeUndefined();
    }
  });
});
