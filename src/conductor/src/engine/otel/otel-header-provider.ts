import { createCredentialResolver } from '../credentials/credential-resolver.js';
import type { CommandRunner } from '../credentials/command-source.js';
import type { CredentialReference } from '../credentials/credential-reference.js';

export class CredentialUnavailableError extends Error {
  constructor(header: string, reason: string) {
    super(`OTLP header ${header} is unavailable: ${reason}`);
    this.name = 'CredentialUnavailableError';
  }
}

export interface OtelHeaderProviderOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly commandRunner?: CommandRunner;
  readonly now?: () => number;
}

/** Resolves each header immediately before an OTLP delivery. */
export function createOtelHeaderProvider(
  references: Readonly<Record<string, CredentialReference>> | undefined,
  fallback: Readonly<Record<string, string>> | undefined,
  options: OtelHeaderProviderOptions = {},
): () => Promise<Record<string, string>> {
  if (!references) return async () => ({ ...fallback });
  const resolvers = Object.fromEntries(Object.entries(references).map(([header, reference]) => [
    header,
    createCredentialResolver(reference, options.environment ?? process.env, options),
  ]));
  return async () => {
    const headers: Record<string, string> = {};
    for (const [header, resolver] of Object.entries(resolvers)) {
      const result = await resolver.resolve();
      if (result.kind === 'unavailable') throw new CredentialUnavailableError(header, result.reason);
      headers[header] = result.value;
    }
    return headers;
  };
}
