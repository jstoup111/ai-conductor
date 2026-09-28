// Covers: task:20
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
import type { AuthenticationSource, LLMProvider } from '../../src/execution/llm-provider.js';
import type { BuiltInProviderId } from '../../src/execution/provider-catalog.js';
import {
  LIVE_E2E_PROVIDERS as LIVE_E2E_PROVIDER_MANIFEST,
  type LiveE2EProviderManifestEntry,
} from '../../src/engine/live-e2e-providers.js';

export type LiveE2EAuthenticationSource = AuthenticationSource | 'oauth-token' | 'missing';

export interface LiveE2EProviderDescriptor extends LiveE2EProviderManifestEntry {
  readonly createProvider: () => LLMProvider;
  readonly binaryName: string;
  readonly credentialEnvVar: string;
  readonly selfHostExecutable?: string;
  readonly providerKey: string;
  readonly expectedAuthenticationSource: LiveE2EAuthenticationSource;
  readonly resolveAuthenticationSource: (provider: LLMProvider) => Promise<LiveE2EAuthenticationSource>;
  readonly assertCredentialAvailable: (credential: string | undefined) => void;
}

const LIVE_E2E_PROVIDER_EXECUTION_AUGMENTATIONS = {
  claude: {
    createProvider: () => new ClaudeProvider(),
    expectedAuthenticationSource: 'oauth-token',
    resolveAuthenticationSource: async (provider) => {
      if (!(provider instanceof ClaudeProvider)) {
        throw new Error('Claude live descriptor requires ClaudeProvider');
      }
      return provider.authenticationSource();
    },
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
  pi: {
    createProvider: () => new PiProvider(),
    expectedAuthenticationSource: 'missing',
    resolveAuthenticationSource: async () => 'missing',
    assertCredentialAvailable: (credential) => {
      if (credential?.trim()) return;
      throw new Error('Missing Pi credential: set PI_API_KEY.');
    },
  },
} as const satisfies Record<BuiltInProviderId, Omit<LiveE2EProviderDescriptor, keyof LiveE2EProviderManifestEntry>>;

/** Every catalog provider uses the shared body; self-host wrapping is descriptor-owned. */
export const LIVE_E2E_PROVIDERS: readonly LiveE2EProviderDescriptor[] = LIVE_E2E_PROVIDER_MANIFEST.map(
  (descriptor) => ({
    ...descriptor,
    ...LIVE_E2E_PROVIDER_EXECUTION_AUGMENTATIONS[descriptor.id],
  }),
);
