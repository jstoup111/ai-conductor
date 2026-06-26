// TargetRepo — parsed value object (ADR-004 parse-don't-validate, FR-6/FR-11).
//
// A TargetRepo is resolved ONCE from the registry and threaded through the
// routing layer. Callers never re-validate: once parsed, the fields are
// trusted. The remote field is optional — projects without a configured
// remote simply omit it.

import { access } from 'fs/promises';
import type { RegistryReader } from '../registry.js';

/** Immutable parsed representation of a project resolved from the registry. */
export interface TargetRepo {
  /** Human-readable project name as stored in the registry. */
  name: string;
  /** Canonical (realpath-resolved) absolute path to the project root. */
  canonicalPath: string;
  /** Optional remote URL (credential-redacted, as stored by registry). */
  remote?: string;
}

/**
 * Thrown when a registry record references a path that no longer exists on
 * disk (repo was moved or deleted). This prevents the engineer from authoring a
 * spec into the wrong repo via any fallback mechanism.
 *
 * The error message always includes the missing path so the operator can act.
 */
export class TargetPathMissingError extends Error {
  constructor(missingPath: string) {
    super(
      `resolveTargetRepo: registry record path does not exist on disk: "${missingPath}". ` +
        'The project may have been moved or deleted. Re-register with `conduct register`.',
    );
    this.name = 'TargetPathMissingError';
  }
}

/**
 * Resolve a TargetRepo from the registry by canonical project path.
 *
 * @param path   - Canonical absolute path to the project directory.
 * @param reader - RegistryReader instance (injected, no global side effects).
 * @returns      A TargetRepo built from the matched record's fields.
 * @throws       When no registry record matches the given path.
 * @throws       {TargetPathMissingError} When the registry record's path does
 *               not exist on disk. No cwd fallback is ever attempted.
 */
export async function resolveTargetRepo(
  path: string,
  reader: RegistryReader,
): Promise<TargetRepo> {
  const record = await reader.getProject(path);
  if (record === undefined) {
    throw new Error(
      `resolveTargetRepo: no registry record found for path "${path}". ` +
        'Register the project first with `conduct register`.',
    );
  }

  // Guard against stale registry records. The path check must happen before
  // any return — never fall back to cwd or any other live path.
  try {
    await access(record.path);
  } catch {
    throw new TargetPathMissingError(record.path);
  }

  const target: TargetRepo = {
    name: record.name,
    canonicalPath: record.path,
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
  };
  return target;
}
