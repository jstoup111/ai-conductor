import { createHash } from 'node:crypto';

/**
 * Result of hashing a plan/stories pair into a canonical spec identity.
 */
export interface SpecHashResult {
  /** SHA-256 hex digest of the canonicalized bytes. */
  digest: string;
  /** Whether stories bytes were present and folded into the digest. */
  storiesIncluded: boolean;
}

/**
 * specHash computes the durable dispatch-dedup identity for a spec.
 *
 * This digest is the canonical "content fingerprint" used to decide whether a
 * spec's implementation has already shipped, so the daemon never re-dispatches
 * or re-kicks work whose plan (and stories, if present) are unchanged. It is
 * persisted alongside shipped-work records and compared byte-for-byte on
 * future dispatch decisions — changing this function's output for
 * already-hashed content is a breaking change to that persisted identity.
 *
 * Canonicalization rules (deliberately narrow, do not expand without updating
 * this comment and the shipped-record persistence format):
 *   - Only a trailing run of newline bytes is trimmed from each buffer before
 *     hashing. This makes "content" and "content\n" hash identically, since
 *     editors/tools frequently add or remove a single trailing newline
 *     without any semantic change to the spec.
 *   - Interior bytes are never modified. Any change inside the content,
 *     including whitespace, changes the digest.
 *   - CRLF ("\r\n") line endings are NOT normalized to LF ("\n"). This is
 *     pinned, intentional behavior: line-ending normalization is a distinct
 *     concern from trailing-newline trimming, and silently coercing CRLF to
 *     LF could mask real content differences across platforms.
 *
 * When storiesBytes is null/undefined, only the plan bytes are hashed and
 * storiesIncluded is reported as false so callers can distinguish "no
 * stories yet" from "stories present but empty."
 */
export function specHash(
  planBytes: Buffer,
  storiesBytes: Buffer | null | undefined
): SpecHashResult {
  const storiesIncluded = storiesBytes != null;

  const canonicalPlan = trimTrailingNewlines(planBytes);
  const canonicalStories = storiesIncluded
    ? trimTrailingNewlines(storiesBytes as Buffer)
    : Buffer.alloc(0);

  const hash = createHash('sha256');
  hash.update(canonicalPlan);
  // Separator byte ensures plan="ab" + stories="c" cannot collide with
  // plan="a" + stories="bc".
  hash.update(Buffer.from([0]));
  hash.update(canonicalStories);

  return {
    digest: hash.digest('hex'),
    storiesIncluded,
  };
}

/**
 * Trims only a trailing run of '\n' (0x0A) bytes. CRLF pairs are left
 * intact except for a final bare '\n', preserving the pinned no-CRLF-
 * normalization behavior documented on specHash.
 */
function trimTrailingNewlines(bytes: Buffer): Buffer {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x0a) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}
