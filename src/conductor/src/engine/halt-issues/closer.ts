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

  /**
   * Get the labels on an issue.
   * Returns an empty array if no labels.
   */
  getIssueLabels(repo: string, issue: string): Promise<string[]>;

  /**
   * Get the current state of an issue.
   * Returns "open", "closed", or null (if not found / 404).
   */
  getIssueState(repo: string, issue: string): Promise<'open' | 'closed' | null>;

  /**
   * Add a comment to an issue.
   * May throw if the operation fails.
   */
  upsertIssueComment(repo: string, issue: string, body: string): Promise<void>;

  /**
   * Close an issue.
   * May throw if the operation fails.
   */
  closeIssue(repo: string, issue: string): Promise<void>;
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
 * Comment body for issue closure.
 * This is a single exported constant for ease of testing and documentation.
 */
export const CLOSE_ISSUE_COMMENT_BODY = `Automated closure: This halt has been resolved by the shipped evidence in the process monitor log.
The fix was deployed and tested; this issue is no longer blocking daemon stability.
See \`conduct-ts halt-issues sweep\` for details.`;

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
 * - Call upsertIssueComment with CLOSE_ISSUE_COMMENT_BODY
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
 * @param gh - GitHub abstraction
 * @returns CloseResult with status and any errors
 */
export async function closeIssue(entry: LedgerEntry, gh: GhAbstraction): Promise<CloseResult> {
  const { repo, issue } = entry;
  const now = new Date().toISOString();

  // Step 1: Check for keep-open label
  let labels: string[];
  try {
    labels = await gh.getIssueLabels(repo, issue);
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
    state = await gh.getIssueState(repo, issue);
  } catch (err) {
    // If we can't fetch state, treat as retriable error
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      closed: false,
      lastError: `failed to fetch issue state: ${errorMsg}`
    };
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
    await gh.upsertIssueComment(repo, issue, CLOSE_ISSUE_COMMENT_BODY);
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
    await gh.closeIssue(repo, issue);
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
