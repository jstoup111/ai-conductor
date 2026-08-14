import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { AuthenticationSource, LLMProvider } from '../../src/execution/llm-provider.js';
import type { SelfHostProviderId } from '../../src/engine/self-host/provider-home.js';

export type LiveE2EAuthenticationSource = AuthenticationSource | 'oauth-token';

export interface LiveE2EProviderDescriptor {
  readonly id: SelfHostProviderId;
  readonly createProvider: () => LLMProvider;
  readonly binaryName: string;
  readonly credentialEnvVar: string;
  readonly selfHostExecutable: string;
  readonly providerKey: string;
  readonly expectedAuthenticationSource: LiveE2EAuthenticationSource;
  readonly resolveAuthenticationSource: (provider: LLMProvider) => Promise<LiveE2EAuthenticationSource>;
}

export const LIVE_E2E_PROVIDERS: readonly LiveE2EProviderDescriptor[] = [
  {
    id: 'claude',
    createProvider: () => new ClaudeProvider(),
    binaryName: 'claude',
    credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selfHostExecutable: 'claude',
    providerKey: 'claude',
    expectedAuthenticationSource: 'oauth-token',
    resolveAuthenticationSource: async () => 'oauth-token',
  },
];
