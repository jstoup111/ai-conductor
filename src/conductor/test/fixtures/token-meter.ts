import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

/** Test-local provider decorator that records the tokens used by a live smoke run. */
export class TokenMeter implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];
  totalTokens = 0;

  constructor(private readonly provider: LLMProvider) {
    this.supportsSessionResume = provider.supportsSessionResume;
    this.lifecycleCapability = provider.lifecycleCapability;
    this.readiness = provider.readiness?.bind(provider);
    this.prepareSelfHostAuth = provider.prepareSelfHostAuth?.bind(provider);
    this.resolveSelfHostExecutable = provider.resolveSelfHostExecutable?.bind(provider);
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const result = await this.provider.invoke(options);
    this.record(result);
    return result;
  }

  async invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    const result = await this.provider.invokeInteractive(options);
    if (result) this.record(result);
    return result;
  }

  private record(result: InvokeResult): void {
    this.totalTokens += (result.tokenUsage?.input ?? 0) + (result.tokenUsage?.output ?? 0);
  }
}

export function assertTokenCap(totalTokens: number, cap: number): void {
  if (totalTokens > cap) {
    throw new Error(`Token cap ${cap} exceeded: observed ${totalTokens}`);
  }
}
