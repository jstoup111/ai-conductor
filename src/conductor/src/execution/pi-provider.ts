import { execa, type Options as ExecaOptions } from 'execa';
import type { InvokeOptions, InvokeResult, LLMProvider, TokenUsage } from './llm-provider.js';
import { enforceFreshSessionOptions } from './fresh-session.js';
import { deriveProviderExitFacts, formatProviderExitFacts } from './provider-diagnostics.js';
import { validateSpawnPermit } from './spawn-permit.js';
import { providerDescriptor } from './provider-catalog.js';
import type { ProviderModelCatalogParseResult } from './provider-catalog.js';
import { withDaemonSessionMarker } from './daemon-session.js';
import { scrubTmuxEnvironment } from './child-environment.js';
import { materializePiHarnessExtension } from './pi-harness-extension.js';
import { writeScratchSchema } from '../engine/self-host/provider-scratch.js';

export type PiSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => Promise<{
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
  signal?: unknown;
}>;

/**
 * This is the one Pi diagnostic verified against the CLI. Keep it anchored:
 * similar prose is not sufficient evidence that a model recovery can proceed.
 */
export const PI_MODEL_UNAVAILABLE_RE =
  /^Error: Model "[^"\r\n]+" not found\. Use --list-models to see available models\.$/;

export type PiModelIdParseFailureReason =
  | 'missing-separator'
  | 'empty-provider'
  | 'empty-model'
  | 'whitespace';

export type PiModelIdParseResult =
  | { readonly provider: string; readonly model: string }
  | { readonly reason: PiModelIdParseFailureReason };

/** Parse Pi's canonical provider/model identifier without rewriting its model suffix. */
export function parsePiModelId(modelId: string): PiModelIdParseResult {
  if (/\s/.test(modelId)) return { reason: 'whitespace' };

  const separator = modelId.indexOf('/');
  if (separator === -1) return { reason: 'missing-separator' };

  const provider = modelId.slice(0, separator);
  if (!provider) return { reason: 'empty-provider' };

  const model = modelId.slice(separator + 1);
  if (!model) return { reason: 'empty-model' };

  return { provider, model };
}

/** Parse Pi's whitespace-aligned --list-models table into canonical ids. */
export function parsePiModelListing(stdout: string): ProviderModelCatalogParseResult {
  const lines = stdout.split(/\r?\n/);
  const firstLine = lines[0] ?? '';
  const columns = (line: string) => line.trim().split(/\s{2,}/);
  const headerIndex = lines.findIndex((line) => {
    const header = columns(line);
    return header.includes('provider') && header.includes('model');
  });

  if (headerIndex === -1) return { kind: 'unparseable', firstLine };

  const header = columns(lines[headerIndex]!);
  const providerIndex = header.indexOf('provider');
  const modelIndex = header.indexOf('model');
  const modelIds = lines.slice(headerIndex + 1)
    .filter((line) => line.trim())
    .flatMap((line) => {
      const row = columns(line);
      const provider = row[providerIndex];
      const model = row[modelIndex];
      return provider && model ? [`${provider}/${model}`] : [];
    });

  return { kind: 'parsed', modelIds };
}

type PiJsonEvent = {
  type?: unknown;
  toolName?: unknown;
  isError?: unknown;
  result?: { details?: unknown };
  message?: {
    role?: unknown;
    content?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
  };
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
};

/** Resolve lazily because the catalog constructs this adapter. */
function piDisplayName(): string {
  return providerDescriptor('pi').displayName;
}

function abortedInvocationResult(): InvokeResult {
  return {
    success: false,
    output: `${piDisplayName()} invocation aborted.`,
    exitCode: 1,
  };
}

async function writePiNativeSchema(options: InvokeOptions): Promise<string> {
  const homeDir = options.nativeSchemaScratchHome ?? options.selfHost?.env.PI_HOME;
  if (!homeDir) throw new Error('requested native schema requires an owned Pi scratch home');
  return writeScratchSchema({
    worktreeRoot: (options.nativeSchemaScratchHome === undefined ? undefined : options.nativeSchemaScratchRoot) ?? options.cwd ?? process.cwd(),
    homeDir,
    schema: options.nativeSchema!,
  });
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
  terminalAssistantStopReason?: string;
  terminalAssistantErrorMessage?: string;
  finalStructuredResult?: unknown;
} {
  let output = '';
  let tokenUsage: TokenUsage | undefined;
  let hasTerminalAssistantMessage = false;
  let terminalAssistantStopReason: string | undefined;
  let terminalAssistantErrorMessage: string | undefined;
  let assistantTurns = 0;
  let finalStructuredResult: unknown;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as PiJsonEvent;
      if (event.type === 'tool_execution_end' && event.toolName === 'submit_result' && event.isError === false) {
        finalStructuredResult = event.result?.details;
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        hasTerminalAssistantMessage = true;
        assistantTurns += 1;
        output = terminalAssistantText(event.message.content);
        terminalAssistantStopReason = typeof event.message.stopReason === 'string'
          ? event.message.stopReason
          : undefined;
        terminalAssistantErrorMessage = typeof event.message.errorMessage === 'string'
          ? event.message.errorMessage
          : undefined;
      }
      if ((event.type === 'message_update'
        || (event.type === 'message_end' && event.message?.role === 'assistant')) && event.usage) {
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

  if (assistantTurns > 0) {
    tokenUsage = { ...(tokenUsage ?? { input: 0, output: 0 }), numTurns: assistantTurns };
  }

  return {
    output,
    tokenUsage,
    hasTerminalAssistantMessage,
    ...(terminalAssistantStopReason ? { terminalAssistantStopReason } : {}),
    ...(terminalAssistantErrorMessage ? { terminalAssistantErrorMessage } : {}),
    ...(finalStructuredResult === undefined ? {} : { finalStructuredResult }),
  };
}

/** One-shot Pi adapter. */
export class PiProvider implements LLMProvider {
  readonly supportsSessionResume = false;
  readonly lifecycleCapability = { synchronousSpawnPermit: true } as const;
  readonly nativeSchemaCapability = { nativeOutputSchema: true } as const;

  constructor(
    private readonly executable = 'pi',
    private readonly subprocessFactory: PiSubprocessFactory = execa,
    private readonly materializeExtension: typeof materializePiHarnessExtension = materializePiHarnessExtension,
  ) {}

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    options = enforceFreshSessionOptions(options, 'pi');
    const { abortSignal } = options;
    if (abortSignal?.aborted) return abortedInvocationResult();
    const permit = validateSpawnPermit(options.spawnPermit);
    if (!permit.permitted) {
      throw new Error(`${piDisplayName()} process spawn denied: ${permit.reason}`);
    }

    const args = ['-p', '--no-session', '--mode', 'json'];
    let schemaFile: string | undefined;
    let extensionPath: string | undefined;
    try {
      if (options.nativeSchema !== undefined) schemaFile = await writePiNativeSchema(options);
      if (options.readOnlyReview || options.nativeSchema !== undefined) {
        extensionPath = await this.materializeExtension({ homeDir: options.selfHost?.env.PI_HOME });
        args.push('-e', extensionPath);
      }
    } catch (error) {
      return { success: false, output: `Pi native schema setup failed: ${error instanceof Error ? error.message : String(error)}`, exitCode: 1 };
    }
    if (options.readOnlyReview) {
      args.push('--no-extensions', '-na', '--tools', `read,grep,find,ls,git_read${schemaFile ? ',submit_result' : ''}`, '--conduct-git-read');
    } else if (options.trustProjectFiles !== true) {
      args.push('-na');
    }
    if (schemaFile) args.push('--conduct-output-schema', schemaFile);
    if (options.model) {
      const parsedModel = parsePiModelId(options.model);
      if ('provider' in parsedModel) {
        args.push('--provider', parsedModel.provider, '--model', parsedModel.model);
      }
    }
    if (options.effort) args.push('--thinking', options.effort);

    const subprocess = this.subprocessFactory(this.executable, args, {
      reject: false,
      input: options.prompt,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      // Apply the marker after the self-host overlay, then explicitly mask
      // tmux's implicit target variables so execa cannot inherit the daemon
      // pane from its parent environment.
      env: scrubTmuxEnvironment(withDaemonSessionMarker({
        ...(options.selfHost?.env ?? {}),
      })),
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
    const exitFacts = deriveProviderExitFacts(result);
    const exitCode = result.exitCode ?? 1;
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const parsed = parsePiJsonl(stdout);

    // Missing-binary classification is anchored to structural process signals.
    // Never infer provider-wide unavailability from arbitrary stderr prose.
    if (result.code === 'ENOENT' || exitCode === 127) {
      const reason = `LLM provider '${piDisplayName().toLowerCase()}' not found. Install it or check your PATH.`;
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
        output: `${piDisplayName()} provider parse failure: missing terminal assistant message.`,
        exitCode,
      };
    }
    if (exitCode === 0 && options.nativeSchema !== undefined && parsed.finalStructuredResult === undefined) {
      return { success: false, output: 'Pi provider parse failure: missing structured result.', exitCode: 1 };
    }

    if (exitCode === 0 && parsed.terminalAssistantStopReason === 'error') {
      return {
        success: false,
        output: parsed.terminalAssistantErrorMessage || `${piDisplayName()} reported an error stop with no message`,
        exitCode,
      };
    }

    const output = stderr ? `${parsed.output}\n${stderr}`.trim() : parsed.output;
    // Pi authentication and rate-limit diagnostics do not have a verified,
    // stable signature yet, so they deliberately remain ordinary step failures.
    const modelUnavailable = exitCode !== 0 && PI_MODEL_UNAVAILABLE_RE.test(stderr);
    const genericUnclassifiedFailure = exitCode !== 0 && !modelUnavailable;
    if (genericUnclassifiedFailure) {
      options.diagnosticLog?.(formatProviderExitFacts('pi', exitFacts));
    }

    return {
      success: exitCode === 0,
      output,
      exitCode,
      ...(modelUnavailable ? { modelUnavailable: true } : {}),
      tokenUsage: exitCode === 0 ? parsed.tokenUsage : undefined,
      ...(exitCode === 0 && parsed.finalStructuredResult !== undefined ? { finalStructuredResult: parsed.finalStructuredResult } : {}),
      ...(genericUnclassifiedFailure ? { exitFacts } : {}),
    };
  }

}
