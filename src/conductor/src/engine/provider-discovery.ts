import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BUILT_IN_PROVIDERS,
  type BuiltInProviderId,
  type BuiltInProviderDescriptor,
} from '../execution/provider-catalog.js';
import { assertRealExecAllowed } from './tracker-client.js';

const execFile = promisify(execFileCallback);

export const PROVIDER_VERSION_PROBE_TIMEOUT_MS = 5_000;

const realExecGuardErrors = new WeakSet<object>();

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
  /** Maximum time to wait for each provider's version probe. */
  readonly timeoutMs?: number;
}

const productionRunner: ProviderVersionProbeRunner = async (executable, argv) => {
  try {
    assertRealExecAllowed(executable);
  } catch (error) {
    if (typeof error === 'object' && error !== null) realExecGuardErrors.add(error);
    throw error;
  }
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
  switch ((error as NodeJS.ErrnoException | undefined)?.code) {
    case 'ENOENT': return 'not-found';
    case 'EACCES': return 'not-executable';
    default: return 'version-failed';
  }
}

function isRealExecGuardError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && realExecGuardErrors.has(error);
}

type ProviderProbe =
  | { readonly id: BuiltInProviderId; readonly installed: true }
  | {
    readonly id: BuiltInProviderId;
    readonly installed: false;
    readonly reason: ProviderDiscoveryFailureReason;
  };

type ProviderProbeOutcome =
  | { readonly kind: 'completed'; readonly result: ProviderVersionProbeResult }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'timed-out' };

function classifyProbeOutcome(outcome: ProviderProbeOutcome): {
  readonly installed: boolean;
  readonly reason?: ProviderDiscoveryFailureReason;
} {
  switch (outcome.kind) {
    case 'completed':
      return outcome.result.exitCode === 0
        ? { installed: true }
        : { installed: false, reason: 'version-failed' };
    case 'failed':
      if (isRealExecGuardError(outcome.error)) throw outcome.error;
      return { installed: false, reason: discoveryFailureReason(outcome.error) };
    case 'timed-out':
      return { installed: false, reason: 'timeout' };
  }
}

async function probeProvider(
  descriptor: BuiltInProviderDescriptor,
  env: NodeJS.ProcessEnv,
  runner: ProviderVersionProbeRunner,
  timeoutMs: number,
): Promise<ProviderProbe> {
  let cancelTimeout: (() => void) | undefined;
  const attempted = runner(executableFor(descriptor, env), descriptor.versionArgv).then(
    (result): ProviderProbeOutcome => ({ kind: 'completed', result }),
    (error: unknown): ProviderProbeOutcome => ({ kind: 'failed', error }),
  );
  const timedOut = new Promise<ProviderProbeOutcome>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timed-out' }), timeoutMs);
    cancelTimeout = () => clearTimeout(timer);
  });

  try {
    const outcome = await Promise.race([attempted, timedOut]);
    const classification = classifyProbeOutcome(outcome);
    if (classification.installed) {
      return { id: descriptor.id as BuiltInProviderId, installed: true };
    }
    return {
      id: descriptor.id as BuiltInProviderId,
      installed: false,
      reason: classification.reason!,
    };
  } finally {
    cancelTimeout?.();
  }
}

/**
 * Probes every catalogued built-in concurrently. The executable is selected
 * from the supplied environment so callers can use the same discovery result
 * as the provider process they are about to start.
 */
export async function discoverInstalledProviders(
  options: DiscoverInstalledProvidersOptions = {},
): Promise<InstalledProviderDiscovery> {
  const env = options.env ?? process.env;
  const runner = options.runner ?? productionRunner;
  const timeoutMs = options.timeoutMs ?? PROVIDER_VERSION_PROBE_TIMEOUT_MS;
  const probes = await Promise.all(
    BUILT_IN_PROVIDERS.map((descriptor) => probeProvider(descriptor, env, runner, timeoutMs)),
  );

  return {
    installed: probes.filter((probe) => probe.installed).map((probe) => probe.id),
    missing: probes.flatMap((probe) => probe.installed
      ? []
      : [{ id: probe.id, reason: probe.reason }]),
  };
}
