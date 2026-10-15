import { redactSafetyText } from '../safety-diagnostics.js';

const CREDENTIAL_KEY = /^(api[_-]?key|token|secret|password|credential|authorization)$/i;

function redactKnownSecrets(value: string, knownSecrets: Iterable<string>): string {
  let sanitized = value;
  for (const secret of knownSecrets) {
    if (secret.length > 0) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized;
}

function sanitizeJsonValue(value: unknown, knownSecrets: Iterable<string>): unknown {
  if (typeof value === 'string') return redactKnownSecrets(redactSafetyText(value), knownSecrets);
  if (Array.isArray(value)) return value.map((child) => sanitizeJsonValue(child, knownSecrets));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    CREDENTIAL_KEY.test(key) ? '[REDACTED]' : sanitizeJsonValue(child, knownSecrets),
  ]));
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return value.length >= 8 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringLeaves);
}

/** Collect auth-file values that may be echoed in a transcript without a credential-shaped key. */
export function collectKnownSecrets(authFileText: string, extra: Iterable<string>): Set<string> {
  const knownSecrets = new Set(extra);
  try {
    for (const secret of stringLeaves(JSON.parse(authFileText))) knownSecrets.add(secret);
  } catch {
    // An unreadable auth file contributes no discovered secrets; callers still supply extras.
  }
  return knownSecrets;
}

/** Redact one transcript line while preserving valid JSON whenever the input was valid JSON. */
export function sanitizeTranscriptLine(line: string, knownSecrets: Iterable<string>): string {
  try {
    return JSON.stringify(sanitizeJsonValue(JSON.parse(line), knownSecrets));
  } catch {
    return redactKnownSecrets(redactSafetyText(line), knownSecrets);
  }
}
