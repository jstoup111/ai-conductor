// AuthoringGuard — path-prefix write guard (FR-11, C1, ADR-004).
//
// A pure/deterministic primitive. Given a target repo's canonical absolute
// path, validates that every write path is a descendant of that prefix.
//
// Rejects (throws PathEscapeError) any path that:
//   - is not absolute
//   - is empty
//   - resolves outside the canonical prefix (via `..`, absolute sibling, etc.)
//   - shares only a string prefix but is not a true descendant (alphaX attack)
//
// No filesystem I/O is performed — all checks are pure string operations on
// the normalized path. This guarantees fail-fast behaviour before any mutation.

import { normalize, isAbsolute } from 'path';

/**
 * Thrown when a write path is not a descendant of the target repo's canonical
 * prefix. This is the C1 cross-repo isolation sentinel.
 *
 * The message always includes both the rejected path and the canonical prefix
 * so operators can immediately diagnose the violation.
 */
export class PathEscapeError extends Error {
  constructor(writePath: string, canonicalPath: string) {
    super(
      `PathEscapeError: write path "${writePath}" escapes the target repo boundary "${canonicalPath}". ` +
        'All writes must be descendants of the canonical target path.',
    );
    this.name = 'PathEscapeError';
  }
}

/**
 * AuthoringGuard enforces C1 cross-repo isolation at the path level.
 *
 * Construct once per authoring session with the target repo's canonical
 * (realpath-resolved) absolute path, then call `assertWriteAllowed` before
 * every filesystem write.
 *
 * @example
 * ```ts
 * const guard = new AuthoringGuard(target.canonicalPath);
 * guard.assertWriteAllowed(join(target.canonicalPath, '.docs/stories/idea.md'));
 * await writeFile(...);
 * ```
 */
export class AuthoringGuard {
  /** Canonical prefix — every allowed write must start with this + separator. */
  private readonly prefix: string;

  /**
   * @param canonicalPath - The realpath-resolved absolute path to the target
   *   repo root. Must be an absolute path (no trailing slash normalisation is
   *   assumed by the caller — this constructor normalises internally).
   */
  constructor(canonicalPath: string) {
    // Normalise: resolve dot-segments, then strip any trailing slash(es) so
    // that `prefix` never ends in `/` (except for the filesystem root `/`).
    // Without this, a canonicalPath like `/home/p/` would normalise to
    // `/home/p/`, and `normalised.startsWith(this.prefix + sep)` would never
    // match because every child path starts with `/home/p/` (already has sep),
    // causing assertWriteAllowed to reject ALL legitimate writes (fail-closed
    // on a correctly-rooted path is a silent regression, not a safety win).
    const normalised = normalize(canonicalPath);
    // Strip trailing separator(s) unless the path is the root (`/`).
    this.prefix = normalised.length > 1 ? normalised.replace(/\/+$/, '') : normalised;
  }

  /**
   * Assert that `writePath` is a descendant of (or equal to) the canonical
   * target prefix. Throws {@link PathEscapeError} if the path escapes.
   *
   * The check is purely string-based (no filesystem calls), so it is
   * synchronous and safe to call before any I/O.
   *
   * @param writePath - The absolute path about to be written.
   * @throws {PathEscapeError} When `writePath` escapes the prefix.
   */
  assertWriteAllowed(writePath: string): void {
    // Must be a non-empty absolute path.
    if (!writePath || !isAbsolute(writePath)) {
      throw new PathEscapeError(writePath, this.prefix);
    }

    // Normalise the candidate path to resolve any `..` or `.` segments.
    const normalised = normalize(writePath);

    // The write is allowed only if normalised equals the prefix exactly, OR
    // starts with the prefix followed immediately by the OS path separator.
    // The separator check prevents the "alphaX" prefix-collision attack where
    // "/home/project/alphaX" would incorrectly match prefix "/home/project/alpha".
    const sep = '/';
    if (normalised !== this.prefix && !normalised.startsWith(this.prefix + sep)) {
      throw new PathEscapeError(writePath, this.prefix);
    }
  }
}
