import { randomUUID } from 'node:crypto';

/** One grammar for dispatch directories, producer files, and event identities. */
export const SESSION_EVENT_IDENTITY = /^[a-z][a-z0-9-]{0,63}$/;

export function isSessionEventIdentity(value: unknown): value is string {
  return typeof value === 'string' && SESSION_EVENT_IDENTITY.test(value);
}

/** UUID entropy with a stable leading letter required by the on-disk grammar. */
export function createSessionEventIdentity(prefix = 'd'): string {
  const safePrefix = /^[a-z]$/.test(prefix) ? prefix : 'd';
  return `${safePrefix}-${randomUUID()}`;
}
