import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BUILT_IN_PROVIDERS,
  type BuiltInProviderId,
  type BuiltInProviderDescriptor,
} from '../execution/provider-catalog.js';
import { assertRealExecAllowed } from './tracker-client.js';

const execFile = promisify(execFileCallback);

export type ProviderDiscoveryFailureReason =
  | 'not-found'
  | 'not-executable'
  | 'version-failed'
  | 'timeout';

export interface ProviderVersionProbeResult {
  readonly exitCode: number;
}

/** Injectable process boundary for provider version probes. */
export type ProviderVersionProbeRunner = (
  executable: string,
  argv: readonly string[],
) => Promise<ProviderVersionProbeResult>;

export interface InstalledProviderDiscovery {
  readonly installed: BuiltInProviderId[];
  readonly missing: Array<{
    readonly id: BuiltInProviderId;
    readonly reason: ProviderDiscoveryFailureReason;
  }>;
}

export interface DiscoverInstalledProvidersOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runner?: ProviderVersionProbeRunner;
  /** Reserved for the bounded probe race added with failure classification. */
  readonly timeoutMs?: number;
}

const productionRunner: ProviderVersionProbeRunner = async (executable, argv) => {
  assertRealExecAllowed(executable);
  await execFile(executable, [...argv]);
  return { exitCode: 0 };
};

function executableFor(
  descriptor: BuiltInProviderDescriptor,
  env: NodeJS.ProcessEnv,
): string {
  return env[descriptor.executableOverrideEnv] ?? descriptor.defaultExecutable;
}

function discoveryFailureReason(error: unknown): ProviderDiscoveryFailureReason {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
    ? 'not-found'
    : 'version-failed';
}

type ProviderProbe =
  | { readonly id: BuiltInProviderId; readonly installed: true }
  | {
    readonly id: BuiltInProviderId;
    readonly installed: false;
    readonly reason: ProviderDiscoveryFailureReason;
  };

async function probeProvider(
  descriptor: BuiltInProviderDescriptor,
  env: NodeJS.ProcessEnv,
  runner: ProviderVersionProbeRunner,
): Promise<ProviderProbe> {
  try {
    const result = await runner(executableFor(descriptor, env), descriptor.versionArgv);
    if (result.exitCode === 0) return { id: descriptor.id as BuiltInProviderId, installed: true };
    return { id: descriptor.id as BuiltInProviderId, installed: false, reason: 'version-failed' };
  } catch (error) {
    return {
      id: descriptor.id as BuiltInProviderId,
      installed: false,
      reason: discoveryFailureReason(error),
    };
  }
}

/**
 * Probes every catalogued built-in concurrently. The executable is selected
 * from the supplied environment so callers can use the same discovery result
 * as the provider process they are about to start.
 */
export async function discoverInstalledProviders(
  { env = process.env, runner = productionRunner }: DiscoverInstalledProvidersOptions = {},
): Promise<InstalledProviderDiscovery> {
  const probes = await Promise.all(
    BUILT_IN_PROVIDERS.map((descriptor) => probeProvider(descriptor, env, runner)),
  );

  return {
    installed: probes.filter((probe) => probe.installed).map((probe) => probe.id),
    missing: probes.flatMap((probe) => probe.installed
      ? []
      : [{ id: probe.id, reason: probe.reason }]),
  };
}
