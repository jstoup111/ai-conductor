import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { AuthenticationSource, LLMProvider } from '../../src/execution/llm-provider.js';
import {
  LIVE_E2E_PROVIDERS as LIVE_E2E_PROVIDER_MANIFEST,
  type LiveE2EProviderManifestEntry,
} from '../../src/engine/live-e2e-providers.js';

export type LiveE2EAuthenticationSource = AuthenticationSource | 'oauth-token';

export interface LiveE2EProviderDescriptor extends LiveE2EProviderManifestEntry {
  readonly createProvider: () => LLMProvider;
  readonly binaryName: string;
  readonly credentialEnvVar: string;
  readonly selfHostExecutable: string;
  readonly providerKey: string;
  readonly expectedAuthenticationSource: LiveE2EAuthenticationSource;
  readonly resolveAuthenticationSource: (provider: LLMProvider) => Promise<LiveE2EAuthenticationSource>;
  readonly assertCredentialAvailable: (credential: string | undefined) => void;
}

const LIVE_E2E_PROVIDER_EXECUTION_AUGMENTATIONS = {
  claude: {
    createProvider: () => new ClaudeProvider(),
    expectedAuthenticationSource: 'oauth-token',
    resolveAuthenticationSource: async () => 'oauth-token',
    assertCredentialAvailable: () => {},
  },
  codex: {
    createProvider: () => new CodexProvider(),
    expectedAuthenticationSource: 'api-key',
    resolveAuthenticationSource: async (provider) => {
      const readiness = await provider.readiness?.();
      if (readiness?.provider !== 'codex') {
        throw new Error('Codex live descriptor requires Codex readiness');
      }
      return readiness.source;
    },
    assertCredentialAvailable: (credential) => {
      if (credential?.trim()) return;

      const cachedLoginPath = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
      if (existsSync(cachedLoginPath)) return;

      throw new Error(
        `Missing Codex credential: set CODEX_API_KEY or sign in at ${cachedLoginPath}`,
      );
    },
  },
} as const satisfies Record<LiveE2EProviderManifestEntry['id'], Omit<LiveE2EProviderDescriptor, keyof LiveE2EProviderManifestEntry>>;

export const LIVE_E2E_PROVIDERS: readonly LiveE2EProviderDescriptor[] = LIVE_E2E_PROVIDER_MANIFEST.map(
  (descriptor) => ({
    ...descriptor,
    ...LIVE_E2E_PROVIDER_EXECUTION_AUGMENTATIONS[descriptor.id],
  }),
);
