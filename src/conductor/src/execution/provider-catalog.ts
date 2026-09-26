import { ClaudeProvider } from './claude-provider.js';
import { CodexProvider } from './codex-provider.js';
import type { LLMProvider } from './llm-provider.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../engine/provider-model-policy-defaults.js';

/** Provider-specific behavior that must be declared rather than inferred. */
export type ProviderCapability =
  | 'readiness'
  | 'selfHost'
  | 'readOnlyReview'
  | 'reviewPolicyCatalog'
  | 'supportsSessionResume'
  | 'costSelfReporting'
  | 'writeFence'
  | 'nativeSchema';

export type ProviderCapabilityFlags = Readonly<Partial<Record<ProviderCapability, boolean>>>;

/** Follow-up intakes that own capability-specific provider behavior. */
export const PROVIDER_CAPABILITY_OWNERS = {
  selfHost: '#1887',
  readOnlyReview: '#1886',
  reviewPolicyCatalog: '#1888',
  costSelfReporting: '#1889',
} as const satisfies Partial<Record<ProviderCapability, string>>;

export interface ProviderFactoryOptions {
  readonly codexDoctorTimeoutMs?: number;
}

export interface BuiltInProviderDescriptor {
  readonly id: string;
  readonly createAdapter: (options?: ProviderFactoryOptions) => LLMProvider;
  readonly defaultExecutable: string;
  readonly executableOverrideEnv: string;
  readonly versionArgv: readonly string[];
  readonly invocationPrefix: string;
  readonly environmentPrefix: string;
  readonly homeVariable: string;
  readonly defaultHome: string;
  readonly modelPolicy: ProviderModelPolicy;
  readonly capabilities: ProviderCapabilityFlags;
}

type BuiltInProviderTable = readonly [
  BuiltInProviderDescriptor & { readonly id: 'claude' },
  BuiltInProviderDescriptor & { readonly id: 'codex' },
];

/**
 * The built-in provider source of truth.  New built-ins belong here before a
 * consumer can select or branch on them.
 */
export const BUILT_IN_PROVIDERS: BuiltInProviderTable = [
  {
    id: 'claude',
    createAdapter: (): LLMProvider => new ClaudeProvider(
      undefined,
      undefined,
      resolveProviderExecutable('claude'),
    ),
    defaultExecutable: 'claude',
    executableOverrideEnv: 'CLAUDE_EXECUTABLE',
    versionArgv: ['--version'],
    invocationPrefix: '/',
    environmentPrefix: 'CLAUDE_',
    homeVariable: 'CLAUDE_CONFIG_DIR',
    defaultHome: '.claude',
    modelPolicy: CLAUDE_MODEL_POLICY,
    capabilities: {
      selfHost: true,
      readOnlyReview: true,
      reviewPolicyCatalog: true,
      supportsSessionResume: false,
      costSelfReporting: true,
      writeFence: true,
      nativeSchema: true,
    },
  },
  {
    id: 'codex',
    createAdapter: (options = {}): LLMProvider => new CodexProvider(
      undefined,
      resolveProviderExecutable('codex'),
      undefined,
      undefined,
      options.codexDoctorTimeoutMs,
    ),
    defaultExecutable: 'codex',
    executableOverrideEnv: 'CODEX_EXECUTABLE',
    versionArgv: ['--version'],
    invocationPrefix: '$',
    environmentPrefix: 'CODEX_',
    homeVariable: 'CODEX_HOME',
    defaultHome: '.codex',
    modelPolicy: CODEX_MODEL_POLICY,
    capabilities: {
      readiness: true,
      selfHost: true,
      readOnlyReview: true,
      reviewPolicyCatalog: true,
      supportsSessionResume: false,
      nativeSchema: true,
    },
  },
] as const;

export type BuiltInProviderId = (typeof BUILT_IN_PROVIDERS)[number]['id'];

export const DEFAULT_PROVIDER: BuiltInProviderId = 'claude';

export type ProviderWith<Capability extends ProviderCapability> = BuiltInProviderDescriptor & {
  readonly capabilities: ProviderCapabilityFlags & Readonly<Record<Capability, true>>;
};

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
  const descriptor = BUILT_IN_PROVIDERS.find((candidate) => candidate.id === id);
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
