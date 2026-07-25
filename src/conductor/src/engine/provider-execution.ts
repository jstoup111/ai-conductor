import type {
  InvokeOptions,
  InvokeResult,
} from '../execution/llm-provider.js';
import type { ProviderRuntime } from './provider-runtime.js';

export interface ProviderUnavailableClassification {
  scope: 'run';
  reason: string;
}

export function classifyProviderAttempt(
  result: InvokeResult,
): ProviderUnavailableClassification | undefined {
  if (
    result.providerUnavailable !== true ||
    result.providerUnavailableScope !== 'run'
  ) {
    return undefined;
  }
  return {
    scope: 'run',
    reason: result.providerUnavailableReason ?? result.output,
  };
}

/**
 * Invoke exactly one provider runtime through its provider-local availability
 * cache and native model ladder. Candidate selection lives outside this seam.
 */
export async function invokeRuntime(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<InvokeResult> {
  if (runtime.runWideUnavailable) {
    const reason = runtime.runWideUnavailable.reason;
    return {
      success: false,
      output: reason,
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableReason: reason,
      providerUnavailableScope: 'run',
      providerInvocationSkipped: true,
    };
  }

  const result = await runtime.availability.invokeWithLadder(
    runtime.provider,
    options,
  );
  const unavailable = classifyProviderAttempt(result);
  if (unavailable) {
    runtime.runWideUnavailable = { reason: unavailable.reason };
  }
  return result;
}
