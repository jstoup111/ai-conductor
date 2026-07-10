/**
 * Sweep orchestrator for halt-issues.
 *
 * Orchestrates the full pipeline for processing filed halt-monitor issues:
 * 1. Parse monitor log → extract verdicts
 * 2. Load/rebuild ledger with parsed verdicts
 * 3. For each verdict entry:
 *    - Stamp issue with Halt-Slug marker
 *    - Check if resolvable (has shipping evidence)
 *    - If resolvable, close issue
 *    - Track errors and guarded entries
 * 4. Write ledger atomically
 * 5. Return summary with all counts and exit code 0 (errors are recorded, not fatal)
 *
 * Error handling:
 * - Per-entry try/catch ensures one failure doesn't block batch processing
 * - Errors are recorded in ledger entry's lastError field
 * - Exit code is always 0 (daemon should continue; errors are for next run)
 * - No writes in dryRun mode
 */

import { parseVerdicts } from './verdict-parser';
import { Ledger, LedgerFs, Clock } from './ledger';
import { stampIssue, closeIssue } from './closer';
import { resolveEntry, FsAbstraction } from './resolution';

/**
 * GitHub abstraction interface (from closer.ts)
 */
export interface GhAbstraction {
  getIssueBody(repo: string, issue: string): Promise<string | null>;
  upsertIssueBody(repo: string, issue: string, body: string): Promise<void>;
  getIssueLabels(repo: string, issue: string): Promise<string[]>;
  getIssueState(repo: string, issue: string): Promise<'open' | 'closed' | null>;
  upsertIssueComment(repo: string, issue: string, body: string): Promise<void>;
  closeIssue(repo: string, issue: string): Promise<void>;
}

/**
 * Configuration for the sweep operation
 */
export interface SweepConfig {
  monitorLogPath: string;
  ledgerPath: string;
  repoDir: string;
  repo: string;
  dryRun: boolean;
  fs: FsAbstraction & LedgerFs;
  gh: GhAbstraction;
  clock: Clock;
}

/**
 * Result entry in a sweep operation
 */
export interface SweepResultEntry {
  issue: string;
  slug: string;
}

/**
 * Result of a sweep operation
 */
export interface SweepResult {
  summary: string;
  parsed: number;
  stamped: number;
  closed: number;
  guarded: number;
  errors: number;
  exitCode: number;
  entries?: SweepResultEntry[];
}

/**
 * Sweep orchestrator: parse, stamp, resolve, close halt-monitor filed issues
 *
 * @param config - Sweep configuration with paths, abstractions, and settings
 * @returns SweepResult with summary and counts, always exitCode 0
 */
export async function sweep(config: SweepConfig): Promise<SweepResult> {
  const counts = {
    parsed: 0,
    stamped: 0,
    closed: 0,
    guarded: 0,
    errors: 0
  };

  // Step 1: Check if monitor log exists
  const logExists = await config.fs.fileExists(config.monitorLogPath);
  if (!logExists) {
    return {
      summary: 'halt-issues sweep: no monitor.log — nothing to do',
      parsed: 0,
      stamped: 0,
      closed: 0,
      guarded: 0,
      errors: 0,
      exitCode: 0
    };
  }

  // Step 2: Parse monitor log
  const logText = await config.fs.readFile(config.monitorLogPath);
  const parseResult = parseVerdicts(logText, config.repo);
  counts.parsed = parseResult.entries.length;

  // If no verdicts parsed, nothing to do
  if (counts.parsed === 0) {
    return {
      summary: 'halt-issues sweep: parsed 0, stamped 0, closed 0, guarded 0, errors 0',
      parsed: 0,
      stamped: 0,
      closed: 0,
      guarded: 0,
      errors: 0,
      exitCode: 0
    };
  }

  // Step 3: Load/rebuild ledger
  const ledger = new Ledger(config.ledgerPath, config.fs, config.clock);
  const ledgerSchema = await ledger.read();

  // Upsert all parsed verdicts into ledger (creates pending entries)
  // In dryRun mode, don't write yet
  if (!config.dryRun) {
    await ledger.upsert(parseResult.entries);
  } else {
    // Still merge entries into schema for processing
    for (const entry of parseResult.entries) {
      if (!ledgerSchema.entries[entry.issue]) {
        ledgerSchema.entries[entry.issue] = {
          issue: entry.issue,
          repo: entry.repo || config.repo,
          slug: entry.slug,
          haltAt: entry.haltAt || config.clock.now().toISOString(),
          status: 'pending'
        };
      }
    }
  }

  // Step 4: Process each verdict entry
  const plannedActions: string[] = [];

  for (const verdict of parseResult.entries) {
    const issue = verdict.issue;

    // Get the ledger entry
    let entry = ledgerSchema.entries[issue];
    if (!entry) {
      // Create entry if it doesn't exist
      entry = {
        issue,
        repo: config.repo,
        slug: verdict.slug,
        haltAt: verdict.haltAt || config.clock.now().toISOString(),
        status: 'pending'
      };
    }

    // Quota discipline (C1): resolution is derived entirely from local fs state,
    // never from gh — so this check costs zero gh calls regardless of outcome.
    const resolution = await resolveEntry(entry, config.repoDir, config.fs);
    const alreadyStamped = !!entry.stampedAt;
    const needsGh = !alreadyStamped || resolution.resolvable;

    if (!needsGh) {
      // Nothing to do: already stamped, and not locally resolvable. Zero gh calls.
      if (resolution.reason === 'mtime-not-gt-halt') {
        counts.guarded++;
      } else if (resolution.reason !== 'no-ship-evidence' && resolution.reason !== 'cleared-no-ship' && resolution.reason !== 'no-pr-url') {
        counts.guarded++;
      }
      ledgerSchema.entries[issue] = entry;
      continue;
    }

    if (config.dryRun) {
      // Dry-run: describe the planned action(s) without issuing any gh calls.
      const actions: string[] = [];
      if (!alreadyStamped) actions.push('stamp');
      if (resolution.resolvable) actions.push('close');
      plannedActions.push(`issue #${issue}: planned ${actions.join('+')}`);
      ledgerSchema.entries[issue] = entry;
      continue;
    }

    try {
      // Step 4a: Stamp the issue (only if not already stamped locally)
      if (!alreadyStamped) {
        const stampResult = await stampIssue(entry, config.gh);

        if (stampResult.stamped) {
          counts.stamped++;
          entry.stampedAt = stampResult.stampedAt;
        } else if (stampResult.closedBy === 'external') {
          // Issue is externally closed (404 or not found)
          entry.closedBy = 'external';
          entry.closedAt = config.clock.now().toISOString();
          entry.status = 'closed';
        } else if (stampResult.lastError) {
          // Stamp failed with error
          entry.lastError = stampResult.lastError;
          counts.errors++;
          // Update ledger and continue to next entry
          ledgerSchema.entries[issue] = entry;
          continue;
        } else if (stampResult.stampedAt) {
          // Marker was already present
          entry.stampedAt = stampResult.stampedAt;
        }
      }

      // Step 4b: Close if locally resolvable
      if (resolution.resolvable) {
        // Step 4c: Close the issue
        const closeResult = await closeIssue(entry, config.gh);

        if (closeResult.closed) {
          counts.closed++;
          entry.closedAt = closeResult.closedAt;
          entry.closedBy = closeResult.closedBy || 'sweep';
          entry.status = 'closed';
        } else if (closeResult.closedBy === 'external') {
          // Already closed externally
          entry.closedBy = 'external';
          entry.closedAt = closeResult.closedAt;
          entry.status = 'closed';
        } else if (closeResult.lastError) {
          // Close failed
          entry.lastError = closeResult.lastError;
          counts.errors++;
        }
      } else {
        // Entry is guarded or has no evidence
        if (resolution.reason === 'mtime-not-gt-halt') {
          counts.guarded++;
        } else if (resolution.reason !== 'no-ship-evidence' && resolution.reason !== 'cleared-no-ship' && resolution.reason !== 'no-pr-url') {
          // Unknown reason, could be a guard condition
          counts.guarded++;
        }
      }
    } catch (err) {
      // Catch-all error handler for unexpected failures
      const errorMsg = err instanceof Error ? err.message : String(err);
      entry.lastError = errorMsg;
      counts.errors++;
    }

    // Update ledger entry
    ledgerSchema.entries[issue] = entry;
  }

  // Step 5: Write ledger atomically (unless dryRun)
  if (!config.dryRun) {
    // Re-create ledger and write (preserves atomic write pattern)
    const ledgerWriter = new Ledger(config.ledgerPath, config.fs, config.clock);
    // Write the full ledger schema
    const tmpFilename = `.ledger.json.tmp-${Math.random().toString(36).substring(7)}`;
    const tmpPath = config.ledgerPath.replace(/ledger\.json$/, tmpFilename);

    const content = JSON.stringify(ledgerSchema, null, 2);
    await config.fs.writeFile(tmpPath, content);
    await config.fs.rename(tmpPath, config.ledgerPath);
  }

  // Step 6: Generate summary
  let summary = `halt-issues sweep: parsed ${counts.parsed}, stamped ${counts.stamped}, closed ${counts.closed}, guarded ${counts.guarded}, errors ${counts.errors}`;

  if (config.dryRun && plannedActions.length > 0) {
    summary += ` [dry-run] planned: ${plannedActions.join('; ')}`;
    // eslint-disable-next-line no-console
    console.log(`halt-issues sweep (dry-run) planned actions:\n${plannedActions.join('\n')}`);
  }

  // Collect parsed entries for reporting
  const entries: SweepResultEntry[] = parseResult.entries.map((entry) => ({
    issue: entry.issue,
    slug: entry.slug
  }));

  return {
    summary,
    parsed: counts.parsed,
    stamped: counts.stamped,
    closed: counts.closed,
    guarded: counts.guarded,
    errors: counts.errors,
    exitCode: 0,
    entries
  };
}
