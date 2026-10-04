// Covers: task:3, task:4
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparePiSelfHostAuth } from '../../src/execution/pi-self-host-auth.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';

describe('preparePiSelfHostAuth', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it('resolves one Pi provider key into an isolated mode-0600 auth file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-self-host-auth-'));
    directories.push(root);
    const homeDir = join(root, 'isolated-home');
    const operatorHome = join(root, 'operator-home');
    await mkdir(operatorHome);
    await writeFile(join(operatorHome, 'auth.json'), JSON.stringify({
      anthropic: { type: 'api_key', key: 'a' },
      deepseek: { type: 'api_key', key: 'd' },
      google: { type: 'api_key', key: 'g' },
      openai: { type: 'api_key', key: 'o' },
      openrouter: { type: 'api_key', key: 'r' },
    }));
    const calls: Array<{ executable: string; argv: readonly string[]; options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number } }> = [];

    const preparation = await preparePiSelfHostAuth({
      executable: 'pi',
      model: 'openrouter/some-model',
      homeDir,
      parentEnv: { PI_CODING_AGENT_DIR: operatorHome, TMUX: '/tmp/tmux-1/default,123,0' },
      run: async (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return { stdout: 'K' };
      },
    });
    const authPath = join(homeDir, 'auth.json');

    expect({
      preparation,
      auth: JSON.parse(await readFile(authPath, 'utf8')),
      mode: (await stat(authPath)).mode & 0o777,
      calls,
    }).toEqual({
      preparation: { args: [] },
      auth: { openrouter: { type: 'api_key', key: 'K' } },
      mode: 0o600,
      calls: [{
        executable: 'pi',
        argv: ['auth', 'print-api-key', '--provider', 'openrouter'],
        options: {
          cwd: homeDir,
          env: { PI_CODING_AGENT_DIR: operatorHome, TMUX: undefined },
          timeout: 30_000,
        },
      }],
    });
  });

  it('refuses unresolvable providers without persisting or exposing resolver output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-self-host-auth-'));
    directories.push(root);
    const key = 'K_NOT_FOR_DIAGNOSTICS';
    const cases = [
      { name: 'failed exit', model: 'openrouter/m', result: { stdout: '', stderr: '', exitCode: 1 }, reason: 'openrouter' },
      { name: 'unknown extension provider', model: 'qoder/m', result: { stdout: 'Error: Unknown provider "qoder".', stderr: '', exitCode: 1 }, reason: 'qoder.*unknown provider' },
      { name: 'empty output', model: 'openrouter/m', result: { stdout: '', stderr: '', exitCode: 0 }, reason: 'openrouter' },
      { name: 'whitespace output', model: 'openrouter/m', result: { stdout: ' \n\t ', stderr: '', exitCode: 0 }, reason: 'openrouter' },
      { name: 'timeout', model: 'openrouter/m', result: { stdout: '', stderr: '', exitCode: 1, timedOut: true }, reason: 'openrouter.*timed out' },
      { name: 'secret stderr', model: 'openrouter/m', result: { stdout: '', stderr: key, exitCode: 1 }, reason: 'openrouter' },
    ] as const;

    const observations = await Promise.all(cases.map(async ({ name, model, result, reason }) => {
      const homeDir = join(root, name.replaceAll(' ', '-'));
      let error: unknown;
      try {
        await preparePiSelfHostAuth({
          executable: 'pi', model, homeDir, parentEnv: {}, run: async () => result,
        });
      } catch (caught) {
        error = caught;
      }
      const refusal = error instanceof ProviderSetupUnavailableError ? error : undefined;
      let authExists = true;
      try {
        await access(join(homeDir, 'auth.json'));
      } catch {
        authExists = false;
      }
      return {
        authExists,
        capability: refusal?.setupUnavailable.capability,
        message: refusal?.message,
        provider: refusal?.setupUnavailable.provider,
        reason: refusal?.setupUnavailable.reason,
        recoveryAction: refusal?.setupUnavailable.recoveryAction,
        expectedReason: reason,
      };
    }));

    expect(observations).toEqual(cases.map(({ reason }) => expect.objectContaining({
      authExists: false,
      capability: 'self-host-isolation',
      provider: 'pi',
      expectedReason: reason,
      message: expect.not.stringContaining(key),
      reason: expect.stringMatching(new RegExp(reason, 'i')),
      recoveryAction: expect.not.stringContaining(key),
    })));
  });
});
