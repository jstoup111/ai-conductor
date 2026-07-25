import type {
  InvokeOptions,
  InvokeResult,
} from '../execution/llm-provider.js';
import type { ProviderRuntime } from './provider-runtime.js';

interface ClassifiedProviderResult extends InvokeResult {
  providerUnavailable?: boolean;
  providerUnavailableReason?: string;
  providerUnavailableScope?: 'run';
  providerInvocationSkipped?: boolean;
}

/**
 * Invoke exactly one provider runtime through its provider-local availability
 * cache and native model ladder. Candidate selection lives outside this seam.
 */
export async function invokeRuntime(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<ClassifiedProviderResult> {
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
  ) as ClassifiedProviderResult;
  if (
    result.providerUnavailable === true &&
    result.providerUnavailableScope === 'run'
  ) {
    runtime.runWideUnavailable = {
      reason: result.providerUnavailableReason ?? result.output,
    };
  }
  return result;
}
