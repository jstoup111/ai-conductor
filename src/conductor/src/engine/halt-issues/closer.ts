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

import { LedgerEntry } from './ledger.js';
import { GhRunnerError, TrackerClient } from '../tracker-client.js';

export type { TrackerClient } from '../tracker-client.js';

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
 * Result of closing an issue
 */
export interface CloseResult {
  /**
   * Whether the issue was successfully closed
   */
  closed: boolean;

  /**
   * Who or what closed the issue: "sweep" (by this process), "external" (already closed or not found), "kept-open" (label present)
   */
  closedBy?: string;

  /**
   * ISO timestamp when the issue was closed
   */
  closedAt?: string;

  /**
   * Error message if closing failed or issue was kept open
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
 * Render the comment body for issue closure, linking the halt-slug and the
 * shipping PR that resolved it, per adr-2026-07-08-halt-issue-closure-sweep.
 *
 * @param slug - The halt slug this issue tracks
 * @param prUrl - URL of the PR whose ship evidence resolved this halt
 */
export function renderCloseComment(slug: string, prUrl: string): string {
  return `Auto-closed by halt-issues sweep: \`${slug}\` shipped in ${prUrl}. Reopen (or label \`halt-sweep:keep-open\`) if this issue tracks a broader gap.`;
}

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
 * @param gh - Tracker client
 * @param cwd - Working directory for the underlying tracker CLI invocation
 * @returns StampResult with status and any errors
 */
export async function stampIssue(entry: LedgerEntry, gh: TrackerClient, cwd = '.'): Promise<StampResult> {
  const { repo, issue, slug } = entry;
  const now = new Date().toISOString();

  // Step 1: Fetch current body
  let body: string | null;
  try {
    body = await gh.getIssueBody(repo, issue, cwd);
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
    await gh.upsertIssueBody(repo, issue, newBody, cwd);
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

/**
 * Close an issue with guards and comment.
 *
 * Logic:
 * - Check for `halt-sweep:keep-open` label via getIssueLabels
 *   - If present: return closedBy="kept-open", lastError="kept-open (label)", no writes
 * - Check current issue state via getIssueState
 *   - If null (404): return closedBy="external", no writes
 *   - If "closed": return closedBy="external", no writes
 *   - If "open": proceed to comment and close
 * - Call upsertIssueComment with renderCloseComment(entry.slug, prUrl)
 *   - If fails: record lastError, do NOT throw, proceed to close attempt
 * - Call closeIssue
 *   - If fails: record lastError, return closed=false
 *   - If succeeds: return closed=true, closedBy="sweep", closedAt=<now>
 *
 * Note: On comment or close failure, the function returns with lastError set, allowing
 * retry on next run. If comment succeeds but close fails, next run should NOT re-comment
 * (the body tracking should detect this via issue body inspection or similar).
 *
 * @param entry - Ledger entry with repo, issue info
 * @param gh - Tracker client
 * @param cwd - Working directory for the underlying tracker CLI invocation
 * @returns CloseResult with status and any errors
 */
export async function closeIssue(
  entry: LedgerEntry,
  prUrl: string,
  gh: TrackerClient,
  cwd = '.',
): Promise<CloseResult> {
  const { repo, issue, slug } = entry;
  const now = new Date().toISOString();

  // Step 1: Check for keep-open label
  let labels: string[];
  try {
    labels = await gh.getIssueLabels(repo, Number(issue), cwd);
  } catch (err) {
    // If we can't fetch labels, treat as retriable error
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      closed: false,
      lastError: `failed to fetch labels: ${errorMsg}`
    };
  }

  if (labels.includes('halt-sweep:keep-open')) {
    return {
      closed: false,
      closedBy: 'kept-open',
      lastError: 'kept-open (label)'
    };
  }

  // Step 2: Check current issue state
  let state: 'open' | 'closed' | null;
  try {
    const view = await gh.viewIssue(`${repo}#${issue}`, cwd);
    const normalized = String(view.state ?? '').toLowerCase();
    state = normalized === 'open' || normalized === 'closed' ? (normalized as 'open' | 'closed') : null;
  } catch (err) {
    // 404-shaped failures mean the issue doesn't exist — treat exactly like
    // a not-found state (no writes), not a retriable error.
    if (err instanceof GhRunnerError && err.status === 404) {
      state = null;
    } else {
      // If we can't fetch state, treat as retriable error
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        closed: false,
        lastError: `failed to fetch issue state: ${errorMsg}`
      };
    }
  }

  // If not found or already closed, return without writes
  if (state === null || state === 'closed') {
    return {
      closed: false,
      closedBy: 'external'
    };
  }

  // Step 3: Issue is open, add comment
  try {
    await gh.upsertIssueComment(repo, issue, renderCloseComment(slug, prUrl), cwd);
  } catch (err) {
    // Comment failed: return error, do NOT attempt close
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      closed: false,
      lastError: errorMsg
    };
  }

  // Step 4: Close the issue
  let closeError: string | undefined;
  try {
    await gh.closeIssue(repo, issue, cwd);
  } catch (err) {
    // Record error
    closeError = err instanceof Error ? err.message : String(err);
  }

  // Step 5: Determine result
  if (closeError) {
    return {
      closed: false,
      lastError: closeError
    };
  }

  // Success
  return {
    closed: true,
    closedBy: 'sweep',
    closedAt: now
  };
}
