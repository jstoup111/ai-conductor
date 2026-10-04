import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { parsePiModelId } from './pi-provider.js';
import { scrubTmuxEnvironment } from './tmux-environment.js';
import { assertRealExecAllowed } from '../engine/tracker-client.js';
import type { SelfHostAuthPreparation } from './llm-provider.js';

export interface PiSelfHostAuthFs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, contents: string, options: { mode: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export type PiSelfHostAuthRunner = (
  executable: string,
  argv: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string }>;

const realPiSelfHostAuthFs: PiSelfHostAuthFs = {
  mkdir: (path, options) => mkdir(path, options).then(() => undefined),
  writeFile,
  chmod,
};

const realPiSelfHostAuthRunner: PiSelfHostAuthRunner = async (executable, argv, options) => {
  assertRealExecAllowed(executable);
  const result = await execa(executable, [...argv], { ...options, reject: false });
  return { stdout: result.stdout };
};

/** Resolve one Pi provider credential into the isolated Pi home. */
export async function preparePiSelfHostAuth({
  executable,
  model,
  homeDir,
  parentEnv,
  run = realPiSelfHostAuthRunner,
  fs = realPiSelfHostAuthFs,
}: {
  executable: string;
  model: string;
  homeDir: string;
  parentEnv: NodeJS.ProcessEnv;
  run?: PiSelfHostAuthRunner;
  fs?: PiSelfHostAuthFs;
}): Promise<SelfHostAuthPreparation> {
  const parsed = parsePiModelId(model);
  if (!('provider' in parsed)) throw new TypeError(`Invalid Pi model id: ${parsed.reason}`);

  const result = await run(executable, ['auth', 'print-api-key', '--provider', parsed.provider], {
    cwd: homeDir,
    env: scrubTmuxEnvironment(parentEnv),
    timeout: 30_000,
  });
  const authPath = join(homeDir, 'auth.json');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(authPath, JSON.stringify({
    [parsed.provider]: { type: 'api_key', key: result.stdout.trim() },
  }), { mode: 0o600 });
  await fs.chmod(authPath, 0o600);
  return { args: [] };
}
