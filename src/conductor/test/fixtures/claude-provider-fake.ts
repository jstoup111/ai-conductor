import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

export interface ClaudeProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
}

export type ClaudeFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

/**
 * Faithful Claude test boundary. It declares Claude's execution capabilities,
 * records permitted invocations, and never launches the Claude CLI.
 */
export function createClaudeProviderFake(script?: ClaudeFakeScript): ClaudeProviderFake {
  const calls: InvokeOptions[] = [];

  const invoke = async (options: InvokeOptions): Promise<InvokeResult> => {
    const permit = options.spawnPermit?.();
    if (permit && !permit.permitted) {
      throw new Error(`Claude fake process spawn denied: ${permit.reason}`);
    }

    calls.push(options);
    try {
      options.onSpawn?.();
    } catch {
      // Spawn observers are observational and must not affect dispatch.
    }

    return script?.(options, calls.length) ?? {
      success: true,
      output: 'Claude fake completed.',
      exitCode: 0,
      ...(options.nativeSchema === undefined ? {} : { finalStructuredResult: {} }),
    };
  };

  return {
    provider: {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      systemPromptCapability: { deliversSystemPrompt: true },
      invoke,
    },
    calls,
  };
}
