import type {
  InvokeOptions,
  InvokeResult,
} from '../execution/llm-provider.js';
import type { ProviderRuntime } from './provider-runtime.js';

/**
 * Invoke exactly one provider runtime through its provider-local availability
 * cache and native model ladder. Candidate selection lives outside this seam.
 */
export function invokeRuntime(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<InvokeResult> {
  return runtime.availability.invokeWithLadder(runtime.provider, options);
}
