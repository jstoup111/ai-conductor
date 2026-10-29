export type CredentialReference =
  | { readonly kind: 'env'; readonly variable: string }
  | {
      readonly kind: 'command';
      readonly argv: readonly string[];
      readonly prefix?: string;
      readonly cacheSeconds?: number;
    };

type ParseCredentialReferenceResult =
  | { readonly ok: true; readonly reference: CredentialReference }
  | { readonly ok: false; readonly error: string };

const SUPPORTED_FORMS = '{ env: <name> } or { command: [...], prefix?, cache_seconds? }';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCredentialReference(value: unknown): ParseCredentialReferenceResult {
  if (!isRecord(value)) {
    return { ok: false, error: `Credential reference must use one of: ${SUPPORTED_FORMS}.` };
  }

  const keys = Object.keys(value);
  const hasEnv = Object.hasOwn(value, 'env');
  const hasCommand = Object.hasOwn(value, 'command');
  if ((hasEnv && hasCommand) || (!hasEnv && !hasCommand) || keys.some((key) => !['env', 'command', 'prefix', 'cache_seconds'].includes(key)) || (hasEnv && keys.length !== 1)) {
    return { ok: false, error: `Credential reference must use one of: ${SUPPORTED_FORMS}.` };
  }

  if (hasEnv) {
    if (typeof value.env !== 'string' || value.env === '') {
      return { ok: false, error: 'Credential reference env must be a non-empty string variable name.' };
    }
    return { ok: true, reference: { kind: 'env', variable: value.env } };
  }

  if (!Array.isArray(value.command) || value.command.length === 0 || value.command.some((argument) => typeof argument !== 'string' || argument === '')) {
    return { ok: false, error: 'Credential reference command must be a non-empty array of non-empty strings.' };
  }
  if (value.prefix !== undefined && typeof value.prefix !== 'string') {
    return { ok: false, error: 'Credential reference prefix must be a string.' };
  }
  if (value.cache_seconds !== undefined && (!Number.isInteger(value.cache_seconds) || value.cache_seconds <= 0)) {
    return { ok: false, error: 'Credential reference cache_seconds must be a positive integer.' };
  }

  return {
    ok: true,
    reference: {
      kind: 'command',
      argv: value.command,
      ...(value.prefix === undefined ? {} : { prefix: value.prefix }),
      ...(value.cache_seconds === undefined ? {} : { cacheSeconds: value.cache_seconds }),
    },
  };
}
