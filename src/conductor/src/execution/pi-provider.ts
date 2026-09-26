import { execa, type Options as ExecaOptions } from 'execa';
import type { InvokeOptions, InvokeResult, LLMProvider, TokenUsage } from './llm-provider.js';
import { enforceFreshSessionOptions } from './fresh-session.js';
import { validateSpawnPermit } from './spawn-permit.js';

export type PiSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => Promise<{
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
}>;

/**
 * This is the one Pi diagnostic verified against the CLI. Keep it anchored:
 * similar prose is not sufficient evidence that a model recovery can proceed.
 */
export const PI_MODEL_UNAVAILABLE_RE =
  /^Error: Model "[^"\r\n]+" not found\. Use --list-models to see available models\.$/;

type PiJsonEvent = {
  type?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
  };
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
};

type PiInvokeOptions = InvokeOptions & { abortSignal?: AbortSignal };

function abortedInvocationResult(): InvokeResult {
  return {
    success: false,
    output: 'Pi invocation aborted.',
    exitCode: 1,
  };
}

function terminalAssistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''
    ))
    .join('');
}

/** Extract Pi's authoritative terminal assistant message and latest cumulative usage. */
export function parsePiJsonl(stdout: string): {
  output: string;
  tokenUsage?: TokenUsage;
  hasTerminalAssistantMessage: boolean;
} {
  let output = '';
  let tokenUsage: TokenUsage | undefined;
  let hasTerminalAssistantMessage = false;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as PiJsonEvent;
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        hasTerminalAssistantMessage = true;
        output = terminalAssistantText(event.message.content);
      }
      if (event.type === 'message_update' && event.usage) {
        const { input, output: outputTokens, cacheRead, cacheWrite } = event.usage;
        if (typeof input === 'number' && Number.isFinite(input)
          && typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
          tokenUsage = {
            input,
            output: outputTokens,
            ...(typeof cacheRead === 'number' && Number.isFinite(cacheRead) ? { cacheRead } : {}),
            ...(typeof cacheWrite === 'number' && Number.isFinite(cacheWrite) ? { cacheCreation: cacheWrite } : {}),
          };
        }
      }
    } catch {
      // Pi reserves stdout for JSONL, but retain valid records when a diagnostic leaks into it.
    }
  }

  return { output, tokenUsage, hasTerminalAssistantMessage };
}

/** One-shot Pi adapter. */
export class PiProvider implements LLMProvider {
  readonly supportsSessionResume = false;
  readonly lifecycleCapability = { synchronousSpawnPermit: true } as const;

  constructor(
    private readonly executable = 'pi',
    private readonly subprocessFactory: PiSubprocessFactory = execa,
  ) {}

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    options = enforceFreshSessionOptions(options, 'pi');
    const abortSignal = (options as PiInvokeOptions).abortSignal;
    if (abortSignal?.aborted) return abortedInvocationResult();
    const permit = validateSpawnPermit(options.spawnPermit);
    if (!permit.permitted) {
      throw new Error(`Pi process spawn denied: ${permit.reason}`);
    }

    const subprocess = this.subprocessFactory(this.executable, ['-p', '--no-session', '--mode', 'json'], {
      reject: false,
      input: options.prompt,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
    });
    let aborted = false;
    const abort = () => {
      aborted = true;
      (subprocess as typeof subprocess & { kill?: () => void }).kill?.();
    };
    abortSignal?.addEventListener('abort', abort, { once: true });
    let result: Awaited<typeof subprocess>;
    try {
      result = await subprocess;
    } finally {
      abortSignal?.removeEventListener('abort', abort);
    }
    if (aborted || abortSignal?.aborted) return abortedInvocationResult();
    const exitCode = result.exitCode ?? 1;
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const parsed = parsePiJsonl(stdout);

    // Missing-binary classification is anchored to structural process signals.
    // Never infer provider-wide unavailability from arbitrary stderr prose.
    if (result.code === 'ENOENT' || exitCode === 127) {
      const reason = "LLM provider 'pi' not found. Install it or check your PATH.";
      return {
        success: false,
        output: reason,
        exitCode,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
        providerUnavailableReason: reason,
      };
    }

    if (exitCode === 0 && !parsed.hasTerminalAssistantMessage) {
      return {
        success: false,
        output: 'Pi provider parse failure: missing terminal assistant message.',
        exitCode,
      };
    }

    const output = stderr ? `${parsed.output}\n${stderr}`.trim() : parsed.output;
    // Pi authentication and rate-limit diagnostics do not have a verified,
    // stable signature yet, so they deliberately remain ordinary step failures.
    const modelUnavailable = exitCode !== 0 && PI_MODEL_UNAVAILABLE_RE.test(stderr);

    return {
      success: exitCode === 0,
      output,
      exitCode,
      ...(modelUnavailable ? { modelUnavailable: true } : {}),
      tokenUsage: exitCode === 0 ? parsed.tokenUsage : undefined,
    };
  }
}
