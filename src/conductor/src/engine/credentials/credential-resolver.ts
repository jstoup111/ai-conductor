import type { CredentialReference } from './credential-reference.js';
import { resolveCommandCredential, type CommandRunner } from './command-source.js';

export type CredentialResult =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface CredentialResolver {
  resolve(): Promise<CredentialResult>;
}

type CredentialEnvironment = Readonly<Record<string, string | undefined>>;

function assertNever(reference: never): never {
  throw new Error(`Unsupported credential reference: ${JSON.stringify(reference)}`);
}

async function resolveReference(
  reference: CredentialReference,
  environment: CredentialEnvironment,
  commandRunner: CommandRunner | undefined,
): Promise<CredentialResult> {
  switch (reference.kind) {
    case 'env': {
      const value = environment[reference.variable];
      return value === undefined || value === ''
        ? { kind: 'unavailable', reason: `Environment variable ${reference.variable} is unavailable.` }
        : { kind: 'value', value };
    }
    case 'command':
      return resolveCommandCredential(reference, commandRunner, environment);
    default:
      return assertNever(reference);
  }
}

export function createCredentialResolver(
  reference: CredentialReference,
  environment: CredentialEnvironment = process.env,
  dependencies: { readonly commandRunner?: CommandRunner; readonly now?: () => number } = {},
): CredentialResolver {
  // Environment values deliberately remain live. Command values are cached per
  // header provider so rotating environment credentials take effect immediately.
  if (reference.kind === 'env') {
    return { resolve: async () => resolveReference(reference, environment, dependencies.commandRunner) };
  }

  const now = dependencies.now ?? Date.now;
  const cacheDurationMs = (reference.cacheSeconds ?? 300) * 1_000;
  let cached: { value: string; expiresAt: number } | undefined;
  let inFlight: Promise<CredentialResult> | undefined;
  return {
    resolve: async () => {
      if (cached && now() < cached.expiresAt) return { kind: 'value', value: cached.value };
      if (inFlight) return inFlight;
      inFlight = resolveReference(reference, environment, dependencies.commandRunner).then((result) => {
        if (result.kind === 'value') cached = { value: result.value, expiresAt: now() + cacheDurationMs };
        return result;
      }).finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
