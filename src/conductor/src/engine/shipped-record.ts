import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

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

/**
 * Fields required to render a committed shipped record's frontmatter.
 */
export interface ShippedRecordFields {
  slug: string;
  specHash: string;
  pr?: string;
  shipped?: string;
}

/**
 * A shipped record successfully parsed from committed markdown.
 */
export interface ParsedShippedRecord {
  slug: string;
  specHash: string;
  pr: string;
  shipped: string;
}

/**
 * Sentinel returned by parseShippedRecord when content does not match the
 * expected frontmatter shape. `stem` is optional context the caller may
 * attach (e.g. derived from the source filename) since malformed records
 * still need to dedup by stem (see ADR 2026-07-03, Story 3).
 */
export interface MalformedShippedRecord {
  malformed: true;
  stem?: string;
}

const DEFAULT_PR = 'https://github.com/acme/repo/pull/0';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * renderShippedRecord serializes a shipped record's fields into the
 * committed frontmatter-only markdown body persisted at
 * `.docs/shipped/<stem>.md`. This is the write-side counterpart to
 * parseShippedRecord; the two must stay round-trip compatible.
 */
export function renderShippedRecord(fields: ShippedRecordFields): string {
  const pr = fields.pr ?? DEFAULT_PR;
  const shipped = fields.shipped ?? todayIso();

  return (
    `---\n` +
    `slug: ${fields.slug}\n` +
    `spec_hash: ${fields.specHash}\n` +
    `pr: ${pr}\n` +
    `shipped: ${shipped}\n` +
    `---\n`
  );
}

const FRONTMATTER_LINE = /^([a-zA-Z_]+):\s*(.*)$/;

/**
 * parseShippedRecord reads back a committed shipped record. It never throws:
 * malformed or unrecognized content yields `{ malformed: true }` so callers
 * (discovery dedup) can still fall back to stem-based matching rather than
 * crashing on a hand-edited or corrupted record (Story 3).
 */
export function parseShippedRecord(
  content: string
): ParsedShippedRecord | MalformedShippedRecord {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { malformed: true };
  }

  const fields: Record<string, string> = {};
  let closed = false;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') {
      closed = true;
      break;
    }
    const match = FRONTMATTER_LINE.exec(line);
    if (!match) {
      continue;
    }
    fields[match[1]] = match[2].trim();
  }

  if (!closed) {
    return { malformed: true };
  }

  const { slug, spec_hash: specHash, pr, shipped } = fields;
  if (!slug || !specHash) {
    return { malformed: true };
  }

  return {
    slug,
    specHash,
    pr: pr ?? DEFAULT_PR,
    shipped: shipped ?? todayIso(),
  };
}

/**
 * writeShippedRecord persists a shipped record's rendered body at filePath,
 * creating parent directories as needed. Idempotent: if a file already
 * exists at filePath with byte-identical content, this is a no-op (no
 * unnecessary write, no error); differing content overwrites.
 */
export async function writeShippedRecord(filePath: string, content: string): Promise<void> {
  let existing: string | undefined;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    existing = undefined;
  }

  if (existing === content) {
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
