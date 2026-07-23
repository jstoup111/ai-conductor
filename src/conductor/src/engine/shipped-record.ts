import { createHash } from 'node:crypto';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BacklogTreeSource } from './daemon-backlog.js';
import type { CostRollup } from './cost-rollup.js';

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

/**
 * renderShippedRecordWithCost renders the same frontmatter as
 * renderShippedRecord, then APPENDS a "## Cost" markdown body block after
 * the closing frontmatter fence, summarizing a per-feature CostRollup
 * (plan Task 6). parseShippedRecord only reads up to the closing `---`
 * fence, so appending this block is safe and never affects dedup/discovery
 * parsing of the frontmatter fields.
 */
export function renderShippedRecordWithCost(
  fields: ShippedRecordFields,
  rollup: CostRollup
): string {
  const frontmatter = renderShippedRecord(fields);
  const costUsd = Math.round(rollup.costUsd * 10000) / 10000;

  return (
    frontmatter +
    `\n` +
    `## Cost\n` +
    `input: ${rollup.tokens.input}\n` +
    `output: ${rollup.tokens.output}\n` +
    `cache_read: ${rollup.tokens.cacheRead}\n` +
    `cache_creation: ${rollup.tokens.cacheCreation}\n` +
    `cost_usd: ${costUsd}\n` +
    `dispatches: ${rollup.dispatches}\n` +
    `retries: ${rollup.retries}\n` +
    `halts: ${rollup.halts}\n` +
    `unmetered: count: ${rollup.unmetered.count}, duration_ms: ${rollup.unmetered.durationMs}\n`
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

/**
 * listShippedRecords reads every committed shipped record off the base-branch
 * tree via `treeSource`, in a single `listShippedFiles()` call (Story 4: one
 * listing per poll, not one per candidate). Records that were listed but
 * cannot be read back (working-tree-only, deleted between listing and read,
 * etc.) are silently skipped — dedup only ever sees what is actually
 * committed on the base branch (Story 3).
 */
export async function listShippedRecords(
  treeSource: BacklogTreeSource
): Promise<Array<{ stem: string; record: ParsedShippedRecord | MalformedShippedRecord }>> {
  const files = await treeSource.listShippedFiles();
  const results: Array<{ stem: string; record: ParsedShippedRecord | MalformedShippedRecord }> =
    [];

  for (const file of files) {
    const content = await treeSource.readFile(`.docs/shipped/${file}`);
    if (content === null) {
      continue;
    }
    const stem = basename(file, '.md');
    results.push({ stem, record: parseShippedRecord(content) });
  }

  return results;
}

/**
 * makeIsProcessed builds the SHARED "already handled" resolver used by both
 * discovery (dispatch dedup) and rekick (Story 3/5: one resolver, two call
 * sites). It never throws, so it is always safe to pass directly as the
 * `isProcessed` callback.
 *
 * Resolution order:
 *   1. Local ledger (`<processedDir>/<slug>`) — a fast, existence-only check.
 *      A hit here is authoritative and short-circuits before ever touching
 *      the (slower, network/exec-bound) shipped-record lookup.
 *   2. Base-branch shipped records (`listShippedRecords(treeSource)`) — the
 *      durable source of truth. A stem match here means the slug's
 *      implementation already merged even though the local ledger never
 *      recorded it (e.g. a reset local cache), so it is still reported as
 *      processed.
 *   3. Neither → not processed.
 *
 * The shipped-record list is fetched at most ONCE per resolver instance and
 * cached in closure: repeated calls to the returned function reuse the same
 * list rather than re-invoking `treeSource.listShippedFiles()` on every slug
 * (Story 4's one-listing-per-poll discipline, extended to this resolver).
 */
export function makeIsProcessed(
  processedDir: string,
  treeSource: BacklogTreeSource
): (slug: string) => Promise<boolean> {
  let cachedRecords: Promise<
    Array<{ stem: string; record: ParsedShippedRecord | MalformedShippedRecord }>
  > | null = null;

  const getRecords = (): Promise<
    Array<{ stem: string; record: ParsedShippedRecord | MalformedShippedRecord }>
  > => {
    if (!cachedRecords) {
      cachedRecords = listShippedRecords(treeSource);
    }
    return cachedRecords;
  };

  return async (slug: string): Promise<boolean> => {
    // Fast path: local ledger marker. Any error here (missing processedDir,
    // permissions, etc.) falls through to the shipped-record check rather
    // than throwing — the ledger is an optimization, not the source of truth.
    try {
      await access(join(processedDir, slug));
      return true;
    } catch {
      // fall through
    }

    const records = await getRecords();
    return records.some((r) => r.stem === slug);
  };
}
