import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa, type Options as ExecaOptions } from 'execa';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  SelfHostAuthContext,
  SelfHostAuthPreparation,
  TokenUsage,
} from './llm-provider.js';
import { enforceFreshSessionOptions } from './fresh-session.js';
import { deriveProviderExitFacts, formatProviderExitFacts } from './provider-diagnostics.js';
import { validateSpawnPermit } from './spawn-permit.js';
import { providerDescriptor } from './provider-catalog.js';
import type { ProviderModelCatalogParseResult } from './provider-catalog.js';
import { withDaemonSessionMarker } from './daemon-session.js';
import { piSubagentsArgs, piSubagentsPackageDir, seedPiSubagentsHome } from './pi-subagents.js';
import { scrubTmuxEnvironment } from './child-environment.js';
import { materializePiHarnessExtension } from './pi-harness-extension.js';
import { preparePiSelfHostAuth, type PiSelfHostAuthRunner } from './pi-self-host-auth.js';
import { applyRateCard, loadRateCard, type RateCard, type RateCardLoader } from './rate-card.js';
import { writeScratchSchema } from '../engine/self-host/provider-scratch.js';
import { composeManagedSessionEnvironment } from './managed-session-context.js';
import { composePreparedManagedSessionEnvironment } from './managed-session-preparation.js';

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

/** Filesystem and process environment Pi uses to locate installed skills. */
export interface PiEnvironment {
  readonly stat: (path: string) => Promise<{ isFile: () => boolean; isDirectory: () => boolean }>;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: () => string;
  readonly cwd: () => string;
}

export type PiSkillResolution = {
  readonly found: true;
  readonly skillPath: string;
  readonly searchedRoots: readonly string[];
} | {
  readonly found: false;
  readonly searchedRoots: readonly string[];
};

const defaultPiEnvironment: PiEnvironment = {
  stat,
  env: process.env,
  homeDir: homedir,
  cwd: process.cwd,
};

async function isFile(path: string, environment: PiEnvironment): Promise<boolean> {
  try {
    return (await environment.stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string, environment: PiEnvironment): Promise<boolean> {
  try {
    return (await environment.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a Pi skill only in the roots loaded by non-interactive Pi sessions.
 * The resolver deliberately stats the conventionally named instruction file;
 * eligibility is Pi's responsibility, so no frontmatter is parsed here.
 */
export async function resolvePiSkill(
  name: string,
  environment: PiEnvironment = defaultPiEnvironment,
): Promise<PiSkillResolution> {
  const descriptor = providerDescriptor('pi');
  const piAgentDirectory = environment.env[descriptor.homeVariable]
    ?? join(environment.homeDir(), descriptor.defaultHome);
  const searchedRoots = [
    join(environment.homeDir(), '.agents', 'skills'),
    join(piAgentDirectory, 'skills'),
    join(environment.cwd(), '.agents', 'skills'),
  ];

  for (const root of searchedRoots) {
    const skillPath = join(root, name, 'SKILL.md');
    if (await isFile(skillPath, environment)) {
      return { found: true, skillPath, searchedRoots };
    }
  }
  return { found: false, searchedRoots };
}

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
    provider?: unknown;
    model?: unknown;
    responseModel?: unknown;
    content?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
    usage?: {
      input?: unknown;
      output?: unknown;
      cacheRead?: unknown;
      cacheWrite?: unknown;
      reasoning?: unknown;
      cost?: { total?: unknown };
    };
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
  if (!homeDir) throw new Error(`requested native schema requires an owned ${piDisplayName()} scratch home`);
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

/** Extract Pi's authoritative terminal assistant message and sum its final per-message usage. */
export function parsePiJsonl(stdout: string, rateCard?: RateCard): {
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
  let providerCostUsd = 0;
  let rateCardCostUsd = 0;
  let hasTokenBearingMessage = false;
  let allTokenBearingMessagesPriced = true;
  let allTokenBearingMessagesRateCardPriced = true;
  let attributedModel: string | undefined;

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
      if (event.type === 'message_end' && event.message?.usage
        && (event.message.role === 'assistant' || event.message.role === 'toolResult')) {
        const { input, output: outputTokens, cacheRead, cacheWrite, reasoning } = event.message.usage;
        if (typeof input === 'number' && Number.isFinite(input)
          && typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
          const model = typeof event.message.responseModel === 'string'
            ? event.message.responseModel
            : typeof event.message.model === 'string'
              ? event.message.model
              : undefined;
          const provider = typeof event.message.provider === 'string'
            ? event.message.provider
            : undefined;
          const validMessageModel = provider !== undefined && model !== undefined;
          if (event.message.role === 'assistant' && validMessageModel) {
            attributedModel = `${provider}/${model}`;
          }
          const hasNonZeroTokens = input !== 0
            || outputTokens !== 0
            || (typeof cacheRead === 'number' && Number.isFinite(cacheRead) && cacheRead !== 0)
            || (typeof cacheWrite === 'number' && Number.isFinite(cacheWrite) && cacheWrite !== 0)
            || (typeof reasoning === 'number' && Number.isFinite(reasoning) && reasoning !== 0);
          if (hasNonZeroTokens) {
            hasTokenBearingMessage = true;
            const cost = event.message.usage.cost?.total;
            if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
              providerCostUsd += cost;
            } else {
              allTokenBearingMessagesPriced = false;
            }
            const messageUsage: TokenUsage = {
              input,
              output: outputTokens,
              ...(typeof cacheRead === 'number' && Number.isFinite(cacheRead) ? { cacheRead } : {}),
              ...(typeof cacheWrite === 'number' && Number.isFinite(cacheWrite) ? { cacheCreation: cacheWrite } : {}),
            };
            const priced = event.message.role === 'assistant' && validMessageModel
              ? applyRateCard(messageUsage, model, rateCard)
              : undefined;
            if (priced?.costSource === 'rate-card' && priced.costUsd !== undefined) {
              rateCardCostUsd += priced.costUsd;
            } else {
              allTokenBearingMessagesRateCardPriced = false;
            }
          }
          const previous = tokenUsage;
          tokenUsage = {
            input: (previous?.input ?? 0) + input,
            output: (previous?.output ?? 0) + outputTokens,
            ...(typeof cacheRead === 'number' && Number.isFinite(cacheRead)
              ? { cacheRead: (previous?.cacheRead ?? 0) + cacheRead }
              : (previous?.cacheRead === undefined ? {} : { cacheRead: previous.cacheRead })),
            ...(typeof cacheWrite === 'number' && Number.isFinite(cacheWrite)
              ? { cacheCreation: (previous?.cacheCreation ?? 0) + cacheWrite }
              : (previous?.cacheCreation === undefined ? {} : { cacheCreation: previous.cacheCreation })),
            ...(typeof reasoning === 'number' && Number.isFinite(reasoning)
              ? { reasoningOutput: (previous?.reasoningOutput ?? 0) + reasoning }
              : (previous?.reasoningOutput === undefined ? {} : { reasoningOutput: previous.reasoningOutput })),
          };
        }
      }
    } catch {
      // Pi reserves stdout for JSONL, but retain valid records when a diagnostic leaks into it.
    }
  }

  if (tokenUsage && (tokenUsage.input !== 0
    || tokenUsage.output !== 0
    || (tokenUsage.cacheRead ?? 0) !== 0
    || (tokenUsage.cacheCreation ?? 0) !== 0)) {
    tokenUsage = {
      ...tokenUsage,
      numTurns: assistantTurns,
      ...(attributedModel === undefined ? {} : { attributedModel }),
      ...(hasTokenBearingMessage && allTokenBearingMessagesPriced
        ? { costUsd: providerCostUsd, costSource: 'provider' as const }
        : hasTokenBearingMessage && allTokenBearingMessagesRateCardPriced
          ? { costUsd: rateCardCostUsd, costSource: 'rate-card' as const }
        : {}),
    };
  } else {
    tokenUsage = undefined;
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
    private readonly environment: PiEnvironment = defaultPiEnvironment,
    private readonly materializeExtension: typeof materializePiHarnessExtension = materializePiHarnessExtension,
    private readonly loadRates: RateCardLoader = loadRateCard,
    private readonly selfHostAuthRunner?: PiSelfHostAuthRunner,
  ) {}

  async resolveSelfHostExecutable(): Promise<string> {
    return this.executable;
  }

  async prepareSelfHostAuth(context: SelfHostAuthContext): Promise<SelfHostAuthPreparation> {
    if (!context.model) throw new TypeError(`${piDisplayName()} self-host auth requires a candidate model.`);
    return preparePiSelfHostAuth({
      executable: this.executable,
      model: context.model,
      homeDir: context.homeDir,
      parentEnv: this.environment.env,
      ...(this.selfHostAuthRunner ? { run: this.selfHostAuthRunner } : {}),
    });
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    options = enforceFreshSessionOptions(options, 'pi');
    const { abortSignal } = options;
    if (abortSignal?.aborted) return abortedInvocationResult();
    const permit = validateSpawnPermit(options.spawnPermit);
    if (!permit.permitted) {
      throw new Error(`${piDisplayName()} process spawn denied: ${permit.reason}`);
    }

    const harnessPath = join(this.environment.homeDir(), '.agents', 'skills', 'HARNESS.md');
    if (!await isFile(harnessPath, this.environment)) {
      const reason = `${piDisplayName()} provider requires HARNESS.md at ${harnessPath}. Run bin/install to provision it.`;
      return {
        success: false,
        output: reason,
        exitCode: 1,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
        providerUnavailableReason: reason,
      };
    }

    // Pi commands are recognized only at the exact start of the first line.
    // Trimming here would turn ordinary prompt text on a later or indented line
    // into an executable skill command.
    const promptCommand = options.prompt.split('\n', 1)[0]?.split(/\s+/, 1)[0];
    const prefix = providerDescriptor('pi').invocationPrefix;
    const cwd = options.cwd ?? this.environment.cwd();
    if (promptCommand?.startsWith(prefix)) {
      const name = promptCommand.slice(prefix.length);
      const resolution = await resolvePiSkill(name, {
        ...this.environment,
        cwd: () => cwd,
      });
      if (!resolution.found) {
        return {
          success: false,
          output: `${piDisplayName()} skill '${name}' was not found. Searched: ${resolution.searchedRoots.join(', ')}`,
          exitCode: 1,
          commandUnresolved: true,
          commandUnresolvedName: name,
        };
      }
    }

    // ADR D18: -na keeps project-local Pi files untrusted unless the operator
    // opts in; a read-only review (D17) always keeps -na.
    const args = ['-p', ...(options.trustProjectFiles === true && !options.readOnlyReview ? [] : ['-na']), '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath];
    const projectSkillsPath = join(cwd, '.agents', 'skills');
    if (await isDirectory(projectSkillsPath, this.environment)) {
      args.push('--skill', projectSkillsPath);
    }
    let schemaFile: string | undefined;
    let extensionPath: string | undefined;
    try {
      if (options.nativeSchema !== undefined) schemaFile = await writePiNativeSchema(options);
      if (options.readOnlyReview || options.nativeSchema !== undefined) {
        extensionPath = await this.materializeExtension({ homeDir: options.selfHost?.env.PI_HOME });
        args.push('-e', extensionPath);
      }
    } catch (error) {
      return { success: false, output: `${piDisplayName()} native schema setup failed: ${error instanceof Error ? error.message : String(error)}`, exitCode: 1 };
    }
    if (options.readOnlyReview) {
      // Read-only review: no discovered extensions, no project resources (whatever
      // trust_project_files says), and a closed tool set whose only git access is git_read.
      args.push('--no-extensions', '--tools', `read,grep,find,ls,git_read${schemaFile ? ',submit_result' : ''}`, '--conduct-git-read');
    }
    if (schemaFile) args.push('--conduct-output-schema', schemaFile);
    // Delegation is for writable work only: a read-only review or a
    // schema-constrained answer never needs a child session.
    let subagentsTempRoot: string | undefined;
    if (options.subagents === true && !options.readOnlyReview && options.nativeSchema === undefined) {
      const descriptor = providerDescriptor('pi');
      const operatorAgentDir = this.environment.env[descriptor.homeVariable]
        ?? join(this.environment.homeDir(), descriptor.defaultHome);
      const packageDir = piSubagentsPackageDir(operatorAgentDir);
      if (!await isFile(join(packageDir, 'package.json'), this.environment)) {
        const reason = `${piDisplayName()} subagents are enabled (llm_providers.pi.subagents) but ${packageDir} is not installed. Run \`pi install npm:pi-subagents\`.`;
        return {
          success: false,
          output: reason,
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: reason,
        };
      }
      args.push(...piSubagentsArgs(packageDir));
      const isolatedAgentDir = options.selfHost?.env[descriptor.homeVariable];
      if (isolatedAgentDir !== undefined) {
        subagentsTempRoot = (await seedPiSubagentsHome(isolatedAgentDir, options.effort)).tempRoot;
      }
    }
    if (options.model) {
      const parsedModel = parsePiModelId(options.model);
      if ('provider' in parsedModel) {
        args.push('--provider', parsedModel.provider, '--model', parsedModel.model);
      }
    }
    if (options.effort) args.push('--thinking', options.effort);
    // Filesystem preflight is asynchronous. An abort that arrives during it
    // must not create an unobservable subprocess after the signal fired.
    if (abortSignal?.aborted) return abortedInvocationResult();

    // Apply the marker after the self-host overlay, then explicitly mask
    // tmux's implicit target variables so execa cannot inherit the daemon
    // pane from its parent environment.
    const environment = scrubTmuxEnvironment(withDaemonSessionMarker({
      ...(options.selfHost?.env ?? {}),
      ...(subagentsTempRoot === undefined ? {} : { PI_SUBAGENTS_TEMP_ROOT: subagentsTempRoot }),
    }));
    const subprocess = this.subprocessFactory(this.executable, args, {
      reject: false,
      input: options.prompt,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      env: options.managedSessionContext
        ? composePreparedManagedSessionEnvironment(options.managedSessionContext, composeManagedSessionEnvironment(options.managedSessionContext, environment))
        : environment,
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
    const parsed = parsePiJsonl(stdout, this.loadRates(options.cwd ?? process.cwd()));

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
      return { success: false, output: `${piDisplayName()} provider parse failure: missing structured result.`, exitCode: 1 };
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
      ...(exitCode === 0 && parsed.tokenUsage !== undefined ? { tokenUsage: parsed.tokenUsage } : {}),
      ...(exitCode === 0 && parsed.finalStructuredResult !== undefined ? { finalStructuredResult: parsed.finalStructuredResult } : {}),
      ...(genericUnclassifiedFailure ? { exitFacts } : {}),
    };
  }

}
