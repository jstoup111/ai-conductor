import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

export interface PiProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
}

export type PiFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

/**
 * Faithful Pi test boundary. It declares Pi's execution capabilities,
 * records permitted invocations, and never launches the Pi CLI.
 */
export function createPiProviderFake(script?: PiFakeScript): PiProviderFake {
  const calls: InvokeOptions[] = [];

  const invoke = async (options: InvokeOptions): Promise<InvokeResult> => {
    const permit = options.spawnPermit?.();
    if (permit && !permit.permitted) {
      throw new Error(`Pi fake process spawn denied: ${permit.reason}`);
    }

    calls.push(options);
    try {
      options.onSpawn?.();
    } catch {
      // Spawn observers are observational and must not affect dispatch.
    }

    return script?.(options, calls.length) ?? {
      success: true,
      output: 'Pi fake completed.',
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
