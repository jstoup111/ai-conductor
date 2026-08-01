import type {
  AuthenticationReadiness,
  LLMProvider,
  ProviderLifecycleCapability,
  SelfHostAuthContext,
  SelfHostAuthPreparation,
  SpawnPermit,
  SpawnPermitDecision,
} from '../execution/llm-provider.js';
import { ModelAvailability } from './model-availability.js';
import {
  hasBuiltInProviderModelPolicy,
  resolveProviderModelPolicy,
  type ProviderModelPolicy,
} from './provider-model-policy.js';
import type { PluginRegistry } from './plugin-registry.js';

export interface ProviderRuntime {
  key: string;
  provider: LLMProvider;
  lifecycleCapability?: ProviderLifecycleCapability;
  policy: ProviderModelPolicy;
  builtIn: boolean;
  availability: ModelAvailability;
  runWideUnavailable?: { reason: string };
}

export class ProviderRuntimeSet {
  private readonly runtimes: Map<string, ProviderRuntime>;

  constructor(runtimes: Iterable<ProviderRuntime>) {
    this.runtimes = new Map(
      Array.from(runtimes, (runtime) => [runtime.key, runtime]),
    );
  }

  keys(): string[] {
    return [...this.runtimes.keys()];
  }

  get(key: string): ProviderRuntime {
    const runtime = this.runtimes.get(key);
    if (!runtime) {
      throw new Error(`Provider runtime not found: ${key}`);
    }
    return runtime;
  }

  /** Resolves the selected adapter's declared lifecycle spawn-fencing capability. */
  lifecycleCapabilityFor(key: string): ProviderLifecycleCapability | undefined {
    const runtime = this.runtimes.get(key);
    return runtime?.lifecycleCapability ?? runtime?.provider.lifecycleCapability;
  }

  /**
   * Return only the failed built-in provider's narrow readiness capability.
   * Custom providers remain compatible without participating in auth recovery.
   */
  readinessFor(
    key: string,
    authentication: AuthenticationReadiness,
  ): (() => Promise<AuthenticationReadiness>) | undefined {
    const runtime = this.runtimes.get(key);
    if (
      !runtime ||
      !runtime.builtIn ||
      runtime.key !== authentication.provider ||
      !runtime.provider.readiness
    ) {
      return undefined;
    }
    return () => runtime.provider.readiness!();
  }

  selfHostAuthFor(
    key: string,
  ): ((context: SelfHostAuthContext) => Promise<SelfHostAuthPreparation>) | undefined {
    const runtime = this.runtimes.get(key);
    return runtime?.provider.prepareSelfHostAuth && runtime.provider.resolveSelfHostExecutable
      ? (context) => runtime.provider.prepareSelfHostAuth!(context)
      : undefined;
  }
}

/**
 * Evaluates a lifecycle-owned permit without awaiting, so adapters can invoke
 * it immediately before their subprocess factory and fail closed on denial.
 */
export function validateSpawnPermit(
  permit: SpawnPermit | undefined,
): SpawnPermitDecision {
  return permit?.() ?? { permitted: true };
}

export function createProviderRuntimeSet(
  registry: PluginRegistry,
  warn?: (message: string) => void,
): ProviderRuntimeSet {
  return new ProviderRuntimeSet(
    registry.list('llm_provider').map((key) => {
      const policy = resolveProviderModelPolicy(key, warn);
      const provider = registry.get<LLMProvider>('llm_provider', key);
      return {
        key,
        provider,
        lifecycleCapability: provider.lifecycleCapability,
        policy,
        builtIn: hasBuiltInProviderModelPolicy(key),
        availability: new ModelAvailability(policy.modelFallbackLadder, warn),
      };
    }),
  );
}
