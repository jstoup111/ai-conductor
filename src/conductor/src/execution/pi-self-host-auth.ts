import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { parsePiModelId } from './pi-provider.js';
import { PI_PROVIDER, providerDescriptor } from './provider-catalog.js';
import { scrubTmuxEnvironment } from './tmux-environment.js';
import { assertRealExecAllowed } from '../engine/tracker-client.js';
import { ProviderSetupUnavailableError } from '../engine/provider-setup-failure.js';
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
) => Promise<{
  stdout: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
}>;

const realPiSelfHostAuthFs: PiSelfHostAuthFs = {
  mkdir: (path, options) => mkdir(path, options).then(() => undefined),
  writeFile,
  chmod,
};

const realPiSelfHostAuthRunner: PiSelfHostAuthRunner = async (executable, argv, options) => {
  assertRealExecAllowed(executable);
  const result = await execa(executable, [...argv], { ...options, reject: false });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
};

/**
 * Catalog display name; diagnostics render it rather than restating the
 * provider. Read lazily: the catalog and Pi adapter import each other.
 */
function piDisplayName(): string {
  return providerDescriptor(PI_PROVIDER).displayName;
}

const UNKNOWN_PROVIDER_RE = /\bunknown provider\b/i;

function isTimedOut(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { timedOut?: unknown }).timedOut === true;
}

function resolverOutputNamesUnknownProvider(result: { stdout?: unknown; stderr?: unknown }): boolean {
  return [result.stdout, result.stderr].some((value) => typeof value === 'string' && UNKNOWN_PROVIDER_RE.test(value));
}

function setupUnavailable(providerSegment: string, reason: string): ProviderSetupUnavailableError {
  return new ProviderSetupUnavailableError({
    provider: PI_PROVIDER,
    capability: 'self-host-isolation',
    reason,
    recoveryAction: `Configure an API key for ${piDisplayName()} provider ${providerSegment} in the operator ${piDisplayName()} home, then retry.`,
  });
}

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
  if (!('provider' in parsed)) throw new TypeError(`Invalid ${piDisplayName()} model id: ${parsed.reason}`);

  let result: Awaited<ReturnType<PiSelfHostAuthRunner>>;
  try {
    result = await run(executable, ['auth', 'print-api-key', '--provider', parsed.provider], {
      cwd: homeDir,
      env: scrubTmuxEnvironment(parentEnv),
      timeout: 30_000,
    });
  } catch (error) {
    if (isTimedOut(error)) {
      throw setupUnavailable(parsed.provider, `${piDisplayName()} self-host credential resolution for ${parsed.provider} timed out.`);
    }
    throw setupUnavailable(parsed.provider, `${piDisplayName()} self-host credential resolution for ${parsed.provider} failed before reporting an exit status.`);
  }

  if (result.timedOut === true) {
    throw setupUnavailable(parsed.provider, `${piDisplayName()} self-host credential resolution for ${parsed.provider} timed out.`);
  }

  const exitCode = result.exitCode ?? 0;
  if (exitCode !== 0) {
    const classification = resolverOutputNamesUnknownProvider(result) ? ' reported an unknown provider' : '';
    throw setupUnavailable(parsed.provider, `${piDisplayName()} self-host credential resolution for ${parsed.provider}${classification} with exit status ${exitCode}.`);
  }

  const key = result.stdout.trim();
  if (!key) {
    throw setupUnavailable(parsed.provider, `${piDisplayName()} self-host credential resolution for ${parsed.provider} returned empty output with exit status ${exitCode}.`);
  }

  const authPath = join(homeDir, 'auth.json');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(authPath, JSON.stringify({
    [parsed.provider]: { type: 'api_key', key },
  }), { mode: 0o600 });
  await fs.chmod(authPath, 0o600);
  return { args: [] };
}
