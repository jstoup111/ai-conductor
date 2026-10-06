import { isAbsolute } from 'node:path';

/**
 * Managed-session preparation sets this only after resolving the real binary
 * before the observer directory is prepended to PATH.
 */
export const GH_OBSERVER_REAL_EXECUTABLE_ENV = 'CONDUCT_GH_REAL_EXECUTABLE';

/**
 * The guarded GitHub-operation adapter bypasses the managed PATH observer.
 * Invalid or absent context deliberately falls back to ordinary PATH
 * resolution.
 */
export function resolvePrivateGhObserverPassthrough(environment: NodeJS.ProcessEnv = process.env): string {
  const executable = environment[GH_OBSERVER_REAL_EXECUTABLE_ENV];
  return executable !== undefined && isAbsolute(executable) ? executable : 'gh';
}
