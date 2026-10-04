// Covers: task:3
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparePiSelfHostAuth } from '../../src/execution/pi-self-host-auth.js';

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
});
