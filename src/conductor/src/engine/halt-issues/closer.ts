/**
 * Halt-Slug stamping for halt-monitor filed issues.
 *
 * Responsible for stamping issues with a `Halt-Slug: <slug>` marker line.
 *
 * Acceptance criteria:
 * 1. Body lacking marker → append `Halt-Slug: <slug>` line and update `stampedAt`
 * 2. Marker present → no edit, observe `stampedAt`
 * 3. Edit failure → `lastError`, others continue
 * 4. Not-found → `closedBy:'external'`
 * 5. Body with DIFFERENT slug marker → no edit, `lastError` conflict, excluded from close
 */

import { LedgerEntry } from './ledger';

/**
 * GitHub abstraction interface for dependency injection
 */
export interface GhAbstraction {
  /**
   * Get the current body of an issue.
   * Returns null if the issue is not found (404).
   */
  getIssueBody(repo: string, issue: string): Promise<string | null>;

  /**
   * Update the body of an issue.
   * May throw if the operation fails.
   */
  upsertIssueBody(repo: string, issue: string, body: string): Promise<void>;
}

/**
 * Result of stamping an issue
 */
export interface StampResult {
  /**
   * Whether the issue was newly stamped (marker was appended)
   */
  stamped: boolean;

  /**
   * ISO timestamp when the issue was stamped, or when the existing marker was observed
   */
  stampedAt?: string;

  /**
   * If not null, the issue was closed externally (404 or not found)
   */
  closedBy?: string;

  /**
   * Error message if stamping failed
   */
  lastError?: string;
}

/**
 * Regular expression to match and extract the Halt-Slug marker.
 * Format: `Halt-Slug: <slug>` on its own line
 * Captures the slug value (allowing for varied whitespace)
 */
const HALT_SLUG_PATTERN = /^Halt-Slug:\s*([\w-]+)\s*$/m;

/**
 * Stamp an issue with a Halt-Slug marker if not already present.
 *
 * Logic:
 * - Fetch current issue body
 * - If 404: set closedBy='external', return
 * - If body contains correct slug: record stampedAt (no edit), return
 * - If body contains wrong slug: set lastError='slug-mismatch', return without edit
 * - If marker absent: append marker, call upsertIssueBody, set stampedAt
 * - On edit error: set lastError with message, do NOT throw
 *
 * @param entry - Ledger entry with repo, issue, slug info
 * @param gh - GitHub abstraction
 * @returns StampResult with status and any errors
 */
export async function stampIssue(entry: LedgerEntry, gh: GhAbstraction): Promise<StampResult> {
  const { repo, issue, slug } = entry;
  const now = new Date().toISOString();

  // Step 1: Fetch current body
  let body: string | null;
  try {
    body = await gh.getIssueBody(repo, issue);
  } catch (err) {
    // Treat fetch errors as external closure
    return {
      stamped: false,
      closedBy: 'external'
    };
  }

  // Step 2: Handle 404 / not found
  if (body === null) {
    return {
      stamped: false,
      closedBy: 'external'
    };
  }

  // Step 3: Check for existing marker
  const markerMatch = body.match(HALT_SLUG_PATTERN);

  if (markerMatch) {
    // Marker exists, extract the slug
    const existingSlug = markerMatch[1].trim();

    if (existingSlug === slug) {
      // Correct marker already present: no edit, record stampedAt
      return {
        stamped: false,
        stampedAt: now
      };
    } else {
      // Wrong slug: conflict, exclude from close
      return {
        stamped: false,
        lastError: 'slug-mismatch'
      };
    }
  }

  // Step 4: Marker absent, append it
  const newBody = body + (body.endsWith('\n') ? '' : '\n') + `Halt-Slug: ${slug}\n`;

  try {
    await gh.upsertIssueBody(repo, issue, newBody);
    return {
      stamped: true,
      stampedAt: now
    };
  } catch (err) {
    // Edit failed: record error, do NOT throw
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      stamped: false,
      lastError: errorMsg
    };
  }
}
