import {
  BUILT_IN_PROVIDERS,
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
  claude: {
    binaryName: 'claude',
    credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selfHostExecutable: 'claude',
    providerKey: 'claude',
  },
  codex: {
    binaryName: 'codex',
    credentialEnvVar: 'CODEX_API_KEY',
    selfHostExecutable: 'codex',
    providerKey: 'codex',
  },
  pi: {
    binaryName: 'pi',
    credentialEnvVar: 'PI_API_KEY',
    selfHostExecutable: 'pi',
    providerKey: 'pi',
  },
} as const satisfies Record<BuiltInProviderId, LiveE2EProviderDetails>;

/** The complete live E2E provider inventory. Test fixtures augment these facts with execution wiring. */
export const LIVE_E2E_PROVIDERS = BUILT_IN_PROVIDERS.map(({ id }) => ({
  id,
  ...LIVE_E2E_PROVIDER_DETAILS[id],
})) as readonly LiveE2EProviderManifestEntry[];
