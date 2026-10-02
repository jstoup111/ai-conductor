import { execa } from 'execa';
import {
  BUILT_IN_PROVIDERS,
  type BuiltInProviderDescriptor,
} from '../execution/provider-catalog.js';
import type { HarnessConfig } from '../types/config.js';
import { collectProviderModelSelections } from './provider-model-config.js';
import type { InstalledProviderDiscovery } from './provider-discovery.js';
import { assertRealExecAllowed } from './tracker-client.js';

export const PROVIDER_MODEL_PROBE_TIMEOUT_MS = 5_000;

export interface ProviderModelProbeResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Injectable process boundary for provider-owned model catalog probes. */
export type ProviderModelProbeRunner = (
  executable: string,
  argv: readonly string[],
) => Promise<ProviderModelProbeResult>;

export class ProviderModelUnknownError extends Error {
  constructor(
    readonly providerName: string,
    readonly kind: 'unknown-provider' | 'unknown-model',
    readonly modelId: string,
    readonly configPath: string,
    readonly step?: string,
  ) {
    const subject = kind === 'unknown-provider'
      ? `unknown ${providerName} provider`
      : `unknown ${providerName} model`;
    super(
      `${subject} for configured id "${modelId}" at ${configPath}`
      + (step === undefined ? '' : ` (step: ${step})`),
    );
    this.name = 'ProviderModelUnknownError';
  }
}

function executableFor(descriptor: BuiltInProviderDescriptor): string {
  return process.env[descriptor.executableOverrideEnv] ?? descriptor.defaultExecutable;
}

const productionRunner: ProviderModelProbeRunner = async (executable, argv) => {
  assertRealExecAllowed(executable);
  const result = await execa(executable, [...argv], { reject: false });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout };
};

async function runWithTimeout(
  runner: ProviderModelProbeRunner,
  executable: string,
  argv: readonly string[],
  timeoutMs: number,
  providerName: string,
): Promise<ProviderModelProbeResult> {
  let cancelTimeout: (() => void) | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${providerName} model listing timed out.`)), timeoutMs);
    cancelTimeout = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([runner(executable, argv), timedOut]);
  } finally {
    cancelTimeout?.();
  }
}

/**
 * Validates configured provider-native model ids against the authoritative
 * provider catalog before a dispatching boot path can start a provider.
 */
export async function validateConfiguredProviderModels({
  config,
  discovery,
  runner = productionRunner,
  timeoutMs = PROVIDER_MODEL_PROBE_TIMEOUT_MS,
}: {
  readonly config: HarnessConfig;
  readonly discovery: InstalledProviderDiscovery;
  readonly runner?: ProviderModelProbeRunner;
  readonly timeoutMs?: number;
}): Promise<void> {
  const selections = collectProviderModelSelections(config);
  const installed = new Set(discovery.installed);

  for (const descriptor of BUILT_IN_PROVIDERS) {
    if (!installed.has(descriptor.id) || descriptor.modelCatalog === undefined) continue;
    const selection = selections[descriptor.id];
    // A provider selection without a concrete model has nothing for this
    // catalog probe to validate. In particular, do not turn an otherwise
    // valid non-Pi boot into a Pi subprocess call merely because Pi occurs in
    // a fallback/provider selection without an associated model.
    if (!selection?.configured || selection.models.length === 0) continue;

    const result = await runWithTimeout(
      runner,
      executableFor(descriptor),
      descriptor.modelCatalog.argv,
      timeoutMs,
      descriptor.displayName,
    );
    const parsed = descriptor.modelCatalog.parse(result.stdout);
    if (result.exitCode !== 0 || parsed.kind === 'unparseable') {
      const firstLine = parsed.kind === 'unparseable'
        ? parsed.firstLine
        : (result.stdout.split(/\r?\n/, 1)[0] ?? '');
      throw new Error(`${descriptor.displayName} model listing is unparseable: "${firstLine}".`);
    }

    const listed = new Set(parsed.modelIds);
    const listedProviders = new Set(parsed.modelIds.map((modelId) => modelId.split('/', 1)[0]!));
    for (const model of selection.models) {
      if (listed.has(model.model)) continue;
      const provider = model.model.split('/', 1)[0]!;
      throw new ProviderModelUnknownError(
        descriptor.displayName,
        listedProviders.has(provider) ? 'unknown-model' : 'unknown-provider',
        model.model,
        model.configPath,
        model.step,
      );
    }
  }
}
