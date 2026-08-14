import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
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
  {
    id: 'codex',
    createProvider: () => new CodexProvider(),
    binaryName: 'codex',
    credentialEnvVar: 'CODEX_API_KEY',
    selfHostExecutable: 'codex',
    providerKey: 'codex',
    expectedAuthenticationSource: 'api-key',
    resolveAuthenticationSource: async (provider) => {
      const readiness = await provider.readiness?.();
      if (readiness?.provider !== 'codex') {
        throw new Error('Codex live descriptor requires Codex readiness');
      }
      return readiness.source;
    },
  },
];
