import { v7 as uuidv7 } from 'uuid';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

export interface CodexProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
  /** Thread ids minted by this fake for cold Codex exec invocations. */
  threadIds: string[];
}

export type CodexFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

/**
 * Faithful Codex test boundary: Codex owns thread ids and cannot resume a
 * harness-minted session id. It never launches the Codex CLI.
 */
export function createCodexProviderFake(script?: CodexFakeScript): CodexProviderFake {
  const calls: InvokeOptions[] = [];
  const threadIds: string[] = [];

  const invoke = async (options: InvokeOptions): Promise<InvokeResult> => {
    const permit = options.spawnPermit?.();
    if (permit && !permit.permitted) {
      return {
        success: false,
        output: `Codex fake spawn denied: ${permit.reason}`,
        exitCode: 1,
      };
    }
    const call = {
      ...options,
      prompt: options.systemPrompt
        ? `${options.systemPrompt}\n\n${options.prompt}`
        : options.prompt,
    };
    calls.push(call);
    if (call.resume) {
      return {
        success: false,
        output: `no rollout found for thread id ${call.sessionId}`,
        exitCode: 1,
      };
    }

    threadIds.push(uuidv7());
    return script?.(call, calls.length) ?? {
      success: true,
      output: 'Codex fake completed.',
      exitCode: 0,
    };
  };

  return {
    provider: {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
      invokeInteractive: invoke,
    },
    calls,
    threadIds,
  };
}
