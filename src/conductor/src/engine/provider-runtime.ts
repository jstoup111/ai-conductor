import type { LLMProvider } from '../execution/llm-provider.js';
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
  policy: ProviderModelPolicy;
  builtIn: boolean;
  availability: ModelAvailability;
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
}

export function createProviderRuntimeSet(
  registry: PluginRegistry,
  warn?: (message: string) => void,
): ProviderRuntimeSet {
  return new ProviderRuntimeSet(
    registry.list('llm_provider').map((key) => {
      const policy = resolveProviderModelPolicy(key, warn);
      return {
        key,
        provider: registry.get<LLMProvider>('llm_provider', key),
        policy,
        builtIn: hasBuiltInProviderModelPolicy(key),
        availability: new ModelAvailability(policy.modelFallbackLadder, warn),
      };
    }),
  );
}
