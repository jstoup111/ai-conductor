import {
  BUILT_IN_PROVIDERS,
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  PI_PROVIDER,
  providerDescriptor,
  type BuiltInProviderId,
} from '../execution/provider-catalog.js';

/** Production-owned provider facts shared by smoke capability resolution and live E2E fixtures. */
export interface LiveE2EProviderManifestEntry {
  readonly id: BuiltInProviderId;
  readonly binaryName: string;
  readonly credentialEnvVar: string;
  readonly selfHostExecutable: string;
  readonly providerKey: string;
}

type LiveE2EProviderDetails = Omit<LiveE2EProviderManifestEntry, 'id'>;

/** Live smoke facts are exhaustive over the provider catalog, even when none is installed. */
const LIVE_E2E_PROVIDER_DETAILS = {
  [CLAUDE_PROVIDER]: {
    binaryName: providerDescriptor(CLAUDE_PROVIDER).defaultExecutable,
    credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selfHostExecutable: providerDescriptor(CLAUDE_PROVIDER).defaultExecutable,
    providerKey: CLAUDE_PROVIDER,
  },
  [CODEX_PROVIDER]: {
    binaryName: providerDescriptor(CODEX_PROVIDER).defaultExecutable,
    credentialEnvVar: 'CODEX_API_KEY',
    selfHostExecutable: providerDescriptor(CODEX_PROVIDER).defaultExecutable,
    providerKey: CODEX_PROVIDER,
  },
  [PI_PROVIDER]: {
    binaryName: providerDescriptor(PI_PROVIDER).defaultExecutable,
    credentialEnvVar: 'PI_API_KEY',
    selfHostExecutable: providerDescriptor(PI_PROVIDER).defaultExecutable,
    providerKey: PI_PROVIDER,
  },
} as const satisfies Record<BuiltInProviderId, LiveE2EProviderDetails>;

/** The complete live E2E provider inventory. Test fixtures augment these facts with execution wiring. */
export const LIVE_E2E_PROVIDERS = BUILT_IN_PROVIDERS.map(({ id }) => ({
  id,
  ...LIVE_E2E_PROVIDER_DETAILS[id],
})) as readonly LiveE2EProviderManifestEntry[];
