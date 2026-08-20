import type { SelfHostProviderId } from './self-host/provider-home.js';

/** Production-owned provider facts shared by smoke capability resolution and live E2E fixtures. */
export interface LiveE2EProviderManifestEntry {
  readonly id: SelfHostProviderId;
  readonly binaryName: string;
  readonly credentialEnvVar: string;
  readonly selfHostExecutable: string;
  readonly providerKey: string;
}

/** The complete live E2E provider inventory. Test fixtures augment these facts with execution wiring. */
export const LIVE_E2E_PROVIDERS = [
  {
    id: 'claude',
    binaryName: 'claude',
    credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selfHostExecutable: 'claude',
    providerKey: 'claude',
  },
  {
    id: 'codex',
    binaryName: 'codex',
    credentialEnvVar: 'CODEX_API_KEY',
    selfHostExecutable: 'codex',
    providerKey: 'codex',
  },
] as const satisfies readonly LiveE2EProviderManifestEntry[];
