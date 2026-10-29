import type { CredentialReference } from './credential-reference.js';

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
): Promise<CredentialResult> {
  switch (reference.kind) {
    case 'env': {
      const value = environment[reference.variable];
      return value === undefined || value === ''
        ? { kind: 'unavailable', reason: `Environment variable ${reference.variable} is unavailable.` }
        : { kind: 'value', value };
    }
    case 'command':
      return {
        kind: 'unavailable',
        reason: `Command credential source ${reference.argv.join(' ')} is unavailable.`,
      };
    default:
      return assertNever(reference);
  }
}

export function createCredentialResolver(
  reference: CredentialReference,
  environment: CredentialEnvironment = process.env,
): CredentialResolver {
  return {
    resolve: async () => resolveReference(reference, environment),
  };
}
