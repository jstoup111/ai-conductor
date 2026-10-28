import { ClaudeProvider } from './claude-provider.js';
import { CodexProvider } from './codex-provider.js';
import {
  parsePiModelId,
  parsePiModelListing,
  PiProvider,
  type PiModelIdParseResult,
} from './pi-provider.js';
import type { DispatchGitGuard, LLMProvider } from './llm-provider.js';
import type { StepName } from '../types/steps.js';
import type { EffortLevel } from '../types/config.js';
import type { ProviderId } from '../types/provider.js';
import {
  extractClaudeFinalAssistantMessage,
  extractCodexFinalAssistantMessage,
  extractPiFinalAssistantMessage,
  type FinalAssistantMessageExtractor,
} from './transcript-format.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from './provider-model-policy-defaults.js';
import {
  BUILT_IN_PROVIDER_IDENTITIES,
  CLAUDE_DISPLAY_NAME,
  CLAUDE_PROVIDER,
  CODEX_DISPLAY_NAME,
  CODEX_PROVIDER,
  PI_DISPLAY_NAME,
  PI_PROVIDER,
} from './provider-catalog-identities.js';

/** Provider-specific behavior that must be declared rather than inferred. */
export type ProviderCapability =
  | 'readiness'
  | 'selfHost'
  | 'interactiveLaunch'
  | 'readOnlyReview'
  | 'reviewPolicyCatalog'
  | 'supportsSessionResume'
  | 'costSelfReporting'
  | 'writeFence'
  | 'nativeSchema';

export type ProviderCapabilityFlags = Readonly<Partial<Record<ProviderCapability, boolean>>>;

/** The provider-owned installed-policy discovery mechanism, when supported. */
export type ReviewPolicyCatalogDiscovery = 'claude-metadata' | 'codex-app-server';
export type ProviderDiagnosticEnvelope = 'claude-json' | 'codex-jsonl';

/** Follow-up intakes that own capability-specific provider behavior. */
export const PROVIDER_CAPABILITY_OWNERS = {
  interactiveLaunch: '#1007',
  readOnlyReview: '#1886',
  reviewPolicyCatalog: '#2852',
} as const satisfies Partial<Record<ProviderCapability, string>>;

export interface ProviderFactoryOptions {
  readonly dispatchGitGuard: DispatchGitGuard;
  readonly codexDoctorTimeoutMs?: number;
}

export interface InteractiveLaunch {
  readonly sessionMarkers: readonly string[];
  readonly acceptedEfforts: readonly EffortLevel[];
  /** The operator-typed command that ends the interactive session. */
  readonly quitInstruction?: string;
  readonly argv: (options: InteractiveLaunchArgvOptions) => string[];
}

export interface InteractiveLaunchArgvOptions {
  readonly prompt: string;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
}

/** Result of parsing a provider-owned model listing command. */
export type ProviderModelCatalogParseResult =
  | { readonly kind: 'parsed'; readonly modelIds: readonly string[] }
  | { readonly kind: 'unparseable'; readonly firstLine: string };

/** Provider-owned command and parser for listing its available model ids. */
export interface ProviderModelCatalog {
  readonly argv: readonly string[];
  readonly parse: (stdout: string) => ProviderModelCatalogParseResult;
}

export interface SelfHostShape {
  readonly isolation: 'claude-config-sandbox' | 'provider-home';
  readonly selectedAuthPath: string;
  readonly transcripts: {
    readonly globs: readonly string[];
    /** Layout used by `ai-conductor transcripts --show` to locate a session file. */
    readonly sessionFile: {
      readonly root: string;
      readonly excludedPathSegments?: readonly string[];
    };
    readonly extractFinalAssistantMessage: FinalAssistantMessageExtractor;
  };
  readonly claudeBuildPreflights: boolean;
  readonly agentsSkillsLink: boolean;
  readonly scrubVariables: readonly string[];
}

interface BuiltInProviderDescriptorBase {
  readonly id: string;
  /** Human-readable name for diagnostics and operator-facing status. */
  readonly displayName: string;
  readonly createAdapter: (options: ProviderFactoryOptions) => LLMProvider;
  readonly defaultExecutable: string;
  readonly executableOverrideEnv: string;
  readonly versionArgv: readonly string[];
  readonly invocationPrefix: string;
  readonly environmentPrefix: string;
  readonly homeVariable: string;
  readonly defaultHome: string;
  readonly modelPolicy: ProviderModelPolicy;
  /** Parses provider-native model ids when the provider defines model-id grammar. */
  readonly parseModelId?: (modelId: string) => PiModelIdParseResult;
  /** Lists provider-native models when the provider supports an authoritative catalog. */
  readonly modelCatalog?: ProviderModelCatalog;
  /** Additional provider-owned model ids to include in rate-card refreshes. */
  readonly optInModelIds: readonly string[];
  /** Whether unattended provider commands run in an OS sandbox. */
  readonly osSandbox: boolean;
  /** This provider has an explicit opt-in for project-owned provider files. */
  readonly projectFileTrust?: boolean;
  /** This provider can load an operator-installed subagent extension for writable dispatches. */
  readonly subagentExtension?: boolean;
  /** Provider-native mechanics for launching an interactive composer session. */
  readonly interactiveLaunch?: InteractiveLaunch;
  /** Known machine-envelope formats, ordered by the adapter's native output. */
  readonly diagnosticEnvelopes: readonly ProviderDiagnosticEnvelope[];
  /** Registered discovery mechanism for installed build-review policies. */
  readonly reviewPolicyCatalog?: ReviewPolicyCatalogDiscovery;
}

/** A provider declaring self-host support must declare its isolation shape. */
export type BuiltInProviderDescriptor = BuiltInProviderDescriptorBase & (
  | {
    readonly capabilities: ProviderCapabilityFlags & { readonly selfHost: true };
    readonly selfHostShape: SelfHostShape;
  }
  | {
    readonly capabilities: ProviderCapabilityFlags & { readonly selfHost?: false | undefined };
    readonly selfHostShape?: undefined;
  }
);

/** Pi owns its configured default model, so no harness model id is selected. */
const PI_MODEL_POLICY: ProviderModelPolicy = {
  requiresConfiguredModels: true,
  stepModels: Object.fromEntries(
    Object.keys(CLAUDE_MODEL_POLICY.stepModels).map((step) => [step, '']),
  ) as Readonly<Record<StepName, string>>,
  stepEfforts: CLAUDE_MODEL_POLICY.stepEfforts,
  stepTierOverrides: {},
  effortOrder: CLAUDE_MODEL_POLICY.effortOrder,
  modelEscalationOrder: [],
  modelFallbackLadder: [],
};

/**
 * The built-in provider source of truth.  New built-ins belong here before a
 * consumer can select or branch on them.
 */
export const BUILT_IN_PROVIDERS = [
  {
    id: CLAUDE_PROVIDER,
    displayName: CLAUDE_DISPLAY_NAME,
    createAdapter: (options): LLMProvider => new ClaudeProvider(
      options.dispatchGitGuard,
      undefined,
      undefined,
      resolveProviderExecutable(CLAUDE_PROVIDER),
    ),
    defaultExecutable: BUILT_IN_PROVIDER_IDENTITIES[0].defaultExecutable,
    executableOverrideEnv: BUILT_IN_PROVIDER_IDENTITIES[0].executableOverrideEnv,
    versionArgv: ['--version'],
    invocationPrefix: '/',
    environmentPrefix: 'CLAUDE_',
    homeVariable: 'CLAUDE_CONFIG_DIR',
    defaultHome: '.claude',
    modelPolicy: CLAUDE_MODEL_POLICY,
    parseModelId: undefined,
    modelCatalog: undefined,
    optInModelIds: [],
    osSandbox: false,
    capabilities: {
      selfHost: true,
      interactiveLaunch: true,
      readOnlyReview: true,
      reviewPolicyCatalog: true,
      supportsSessionResume: false,
      costSelfReporting: true,
      writeFence: true,
      nativeSchema: true,
    } as const satisfies ProviderCapabilityFlags,
    selfHostShape: {
      isolation: 'claude-config-sandbox',
      selectedAuthPath: '.credentials.json',
      transcripts: {
        globs: ['projects/**/*.jsonl'],
        sessionFile: { root: 'projects', excludedPathSegments: ['subagents'] },
        extractFinalAssistantMessage: extractClaudeFinalAssistantMessage,
      },
      claudeBuildPreflights: true,
      agentsSkillsLink: false,
      scrubVariables: ['CLAUDE_CODE_OAUTH_TOKEN'],
    },
    interactiveLaunch: {
      sessionMarkers: ['CLAUDECODE'],
      acceptedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      quitInstruction: '/quit',
      argv: ({ prompt, permissionMode = 'default', model, effort }) => {
        return [
          '--permission-mode', permissionMode,
          ...(model === undefined ? [] : ['--model', model]),
          ...(effort === undefined ? [] : ['--effort', effort]),
          prompt,
        ];
      },
    },
    diagnosticEnvelopes: ['claude-json', 'codex-jsonl'],
    reviewPolicyCatalog: 'claude-metadata',
  },
  {
    id: CODEX_PROVIDER,
    displayName: CODEX_DISPLAY_NAME,
    createAdapter: (options): LLMProvider => new CodexProvider(
      options.dispatchGitGuard,
      undefined,
      resolveProviderExecutable(CODEX_PROVIDER),
      undefined,
      undefined,
      options.codexDoctorTimeoutMs,
    ),
    defaultExecutable: BUILT_IN_PROVIDER_IDENTITIES[1].defaultExecutable,
    executableOverrideEnv: BUILT_IN_PROVIDER_IDENTITIES[1].executableOverrideEnv,
    versionArgv: ['--version'],
    invocationPrefix: '$',
    environmentPrefix: 'CODEX_',
    homeVariable: 'CODEX_HOME',
    defaultHome: '.codex',
    modelPolicy: CODEX_MODEL_POLICY,
    parseModelId: undefined,
    modelCatalog: undefined,
    optInModelIds: ['gpt-6-astra'],
    osSandbox: true,
    capabilities: {
      readiness: true,
      selfHost: true,
      interactiveLaunch: true,
      readOnlyReview: true,
      reviewPolicyCatalog: true,
      supportsSessionResume: false,
      nativeSchema: true,
    } as const satisfies ProviderCapabilityFlags,
    selfHostShape: {
      isolation: 'provider-home',
      selectedAuthPath: 'auth.json',
      transcripts: {
        globs: ['sessions/**/*.jsonl'],
        sessionFile: { root: 'sessions' },
        extractFinalAssistantMessage: extractCodexFinalAssistantMessage,
      },
      claudeBuildPreflights: false,
      agentsSkillsLink: true,
      scrubVariables: [],
    },
    interactiveLaunch: {
      sessionMarkers: ['CODEX_THREAD_ID', 'CODEX_SESSION_ID'],
      acceptedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      quitInstruction: '/quit',
      argv: ({ prompt, model, effort }) => [
        ...(model === undefined ? [] : ['--model', model]),
        ...(effort === undefined ? [] : ['--config', `model_reasoning_effort="${effort}"`]),
        prompt,
      ],
    },
    diagnosticEnvelopes: ['codex-jsonl', 'claude-json'],
    reviewPolicyCatalog: 'codex-app-server',
  },
  {
    id: PI_PROVIDER,
    displayName: BUILT_IN_PROVIDER_IDENTITIES[2].displayName,
    createAdapter: (options): LLMProvider => new PiProvider(options.dispatchGitGuard, resolveProviderExecutable(PI_PROVIDER)),
    defaultExecutable: BUILT_IN_PROVIDER_IDENTITIES[2].defaultExecutable,
    executableOverrideEnv: BUILT_IN_PROVIDER_IDENTITIES[2].executableOverrideEnv,
    versionArgv: ['--version'],
    invocationPrefix: '/skill:',
    environmentPrefix: 'PI_',
    homeVariable: 'PI_CODING_AGENT_DIR',
    defaultHome: '.pi/agent',
    modelPolicy: PI_MODEL_POLICY,
    parseModelId: parsePiModelId,
    modelCatalog: { argv: ['--list-models'], parse: parsePiModelListing },
    optInModelIds: [],
    osSandbox: false,
    projectFileTrust: true,
    subagentExtension: true,
    capabilities: {
      selfHost: true,
      readOnlyReview: true,
      costSelfReporting: true,
      nativeSchema: true,
    } as const satisfies ProviderCapabilityFlags,
    selfHostShape: {
      isolation: 'provider-home',
      selectedAuthPath: 'auth.json',
      transcripts: {
        globs: ['sessions/**/*.jsonl'],
        sessionFile: { root: 'sessions' },
        extractFinalAssistantMessage: extractPiFinalAssistantMessage,
      },
      claudeBuildPreflights: false,
      agentsSkillsLink: false,
      scrubVariables: ['PI_CODING_AGENT_SESSION_DIR'],
    },
    diagnosticEnvelopes: [],
  },
] as const satisfies readonly BuiltInProviderDescriptor[];

export function validateProviderCatalog(providers: readonly BuiltInProviderDescriptor[]): void {
  for (const provider of providers) {
    if (
      provider.capabilities.selfHost === true
      && provider.selfHostShape?.transcripts.globs.length === 0
    ) {
      throw new Error(
        `self-host provider ${provider.id}: transcripts.globs transcript allowlist is empty`,
      );
    }
  }
}

validateProviderCatalog(BUILT_IN_PROVIDERS);

export type BuiltInProviderId = (typeof BUILT_IN_PROVIDERS)[number]['id'];

/** The first catalog descriptor remains the default provider selection. */
export const DEFAULT_PROVIDER: BuiltInProviderId = BUILT_IN_PROVIDERS[0].id;
export {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  PI_PROVIDER,
  CLAUDE_DISPLAY_NAME,
  CODEX_DISPLAY_NAME,
  PI_DISPLAY_NAME,
};

/** Catalog lookup that keeps plugin callers on their existing generic path. */
export function findBuiltInProviderDescriptor(
  id: string,
): (typeof BUILT_IN_PROVIDERS)[number] | undefined {
  return BUILT_IN_PROVIDERS.find((candidate) => candidate.id === id);
}

export function isBuiltInProviderId(id: string): id is BuiltInProviderId {
  return findBuiltInProviderDescriptor(id) !== undefined;
}

/** Built-ins have catalog-owned operator labels; plugins retain their key. */
export function providerDisplayName(id: string): string {
  return findBuiltInProviderDescriptor(id)?.displayName ?? id;
}

type ProviderWithCapability<Provider, Capability extends ProviderCapability> = Provider extends {
  readonly capabilities: Readonly<Record<Capability, true>>;
}
  ? Provider
  : never;

export type ProviderWith<Capability extends ProviderCapability> = ProviderWithCapability<
  (typeof BUILT_IN_PROVIDERS)[number],
  Capability
>;

export class ProviderCapabilityUnsupportedError extends Error {
  constructor(
    readonly provider: BuiltInProviderId,
    readonly capability: ProviderCapability,
    readonly owningIntake: string,
  ) {
    super(
      `Built-in provider ${provider} does not support ${capability}; `
      + `the capability is owned by intake ${owningIntake}.`,
    );
    this.name = 'ProviderCapabilityUnsupportedError';
  }
}

/** Capability flags fail closed: an absent or false flag is unsupported. */
export function supportsProviderCapability(
  provider: Pick<BuiltInProviderDescriptor, 'capabilities'>,
  capability: ProviderCapability,
): boolean {
  return provider.capabilities[capability] === true;
}

export function providerDescriptor(id: BuiltInProviderId): (typeof BUILT_IN_PROVIDERS)[number] {
  const descriptor = findBuiltInProviderDescriptor(id);
  if (!descriptor) {
    throw new Error(`Unknown built-in provider: ${id}`);
  }
  return descriptor;
}

/** Return a capability-narrowed descriptor or fail before an unsupported path can branch. */
export function requireProviderCapability<Capability extends ProviderCapability>(
  id: BuiltInProviderId,
  capability: Capability,
): ProviderWith<Capability> {
  const provider = providerDescriptor(id);
  if (supportsProviderCapability(provider, capability)) {
    return provider as ProviderWith<Capability>;
  }

  const owningIntake = PROVIDER_CAPABILITY_OWNERS[
    capability as keyof typeof PROVIDER_CAPABILITY_OWNERS
  ] ?? '#1884';
  throw new ProviderCapabilityUnsupportedError(id, capability, owningIntake);
}

/** Resolve an override at use time so tests and child processes can provide it. */
export function resolveProviderExecutable(id: BuiltInProviderId): string {
  const descriptor = providerDescriptor(id);
  return process.env[descriptor.executableOverrideEnv] ?? descriptor.defaultExecutable;
}

/** The catalog is the sole conversion boundary from known built-ins to event ids. */
export function toProviderId(id: BuiltInProviderId): ProviderId {
  return id as ProviderId;
}
