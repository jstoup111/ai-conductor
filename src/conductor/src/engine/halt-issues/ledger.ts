/**
 * Ledger for halt-monitor filed issues.
 *
 * Maintains a persistent record of issues filed by halt-monitor,
 * tracking their status and lifecycle events.
 *
 * The ledger uses an atomic write pattern (tmp-file-then-rename) to ensure
 * consistency: if the process crashes during write, the original file remains
 * unchanged. The tmp file is created in the same directory as the final file
 * to guarantee the rename is atomic within the same filesystem.
 */

import { VerdictEntry } from './verdict-parser';
import path from 'path';
import { randomBytes } from 'crypto';

/**
 * Schema for a single ledger entry
 */
export interface LedgerEntry {
  issue: string;        // e.g., "297"
  repo: string;         // e.g., "jstoup111/james-stoup-agents"
  slug: string;         // e.g., "daemon-lifecycle-controls"
  haltAt: string;       // ISO timestamp, e.g., "2026-07-04T11:58:38.984Z"
  status: string;       // e.g., "pending", "stamped", or "closed"
  stampedAt?: string;   // ISO timestamp
  closedAt?: string;    // ISO timestamp
  closedBy?: string;    // "sweep", "external", or user name
  lastError?: string;   // error message if any
}

/**
 * Schema for the entire ledger file
 */
export interface LedgerSchema {
  version: number;
  entries: {
    [issue: string]: LedgerEntry;
  };
}

/**
 * Abstraction for file system operations (supports dependency injection for testing)
 */
export interface LedgerFs {
  /**
   * Read file contents as string
   */
  readFile(path: string): Promise<string>;

  /**
   * Write file contents atomically (will overwrite)
   */
  writeFile(path: string, data: string): Promise<void>;

  /**
   * Rename/move a file (atomic within same filesystem)
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Check if file exists
   */
  fileExists(path: string): Promise<boolean>;
}

/**
 * Ledger class for managing halt-monitor filed issues
 */
export class Ledger {
  /**
   * Create a new Ledger instance
   *
   * @param filePath - Path to the ledger.json file
   * @param fs - File system abstraction (injected for testing)
   */
  constructor(private filePath: string, private fs: LedgerFs) {}

  /**
   * Read and parse the ledger file
   *
   * Returns an empty schema if the file does not exist.
   *
   * @returns Parsed ledger schema
   * @throws {SyntaxError} If the file exists but contains invalid JSON
   */
  async read(): Promise<LedgerSchema> {
    const exists = await this.fs.fileExists(this.filePath);

    if (!exists) {
      return {
        version: 1,
        entries: {}
      };
    }

    const content = await this.fs.readFile(this.filePath);
    return JSON.parse(content) as LedgerSchema;
  }

  /**
   * Upsert verdicts into the ledger
   *
   * For each verdict entry:
   * - If the issue does not exist, create a new entry with status="pending"
   * - If the issue exists, merge the new data while preserving existing fields
   *
   * The write operation is atomic: writes to a temporary file, then renames it
   * to the final location. If the rename fails, the original file remains unchanged.
   *
   * @param entries - Array of verdict entries to upsert
   * @throws {Error} If the rename operation fails (original file is safe)
   */
  async upsert(entries: VerdictEntry[]): Promise<void> {
    // Load existing ledger (or initialize empty)
    const ledger = await this.read();

    // Merge entries by issue number
    for (const entry of entries) {
      const issue = entry.issue;
      const existing = ledger.entries[issue];

      // Preserve existing fields, merge in new ones
      ledger.entries[issue] = {
        // Existing entry (if any)
        ...existing,
        // New entry data (overwrites matching fields)
        issue: entry.issue,
        repo: entry.repo || existing?.repo || '',
        slug: entry.slug,
        haltAt: entry.haltAt || existing?.haltAt || '',
        // Set default status to "pending" if new entry
        status: existing?.status || 'pending'
      };
    }

    // Write atomically: tmp file then rename
    await this.writeAtomic(ledger);
  }

  /**
   * Write ledger atomically using tmp-file-then-rename pattern
   *
   * @param ledger - Ledger schema to write
   * @throws {Error} If rename fails (original file is safe)
   */
  private async writeAtomic(ledger: LedgerSchema): Promise<void> {
    // Generate unique tmp filename in same directory as final file
    const tmpFilename = `.ledger.json.tmp-${randomBytes(8).toString('hex')}`;
    const tmpPath = path.join(path.dirname(this.filePath), tmpFilename);

    // Write to tmp file
    const content = JSON.stringify(ledger, null, 2);
    await this.fs.writeFile(tmpPath, content);

    // Rename tmp file to final location (atomic within same filesystem)
    try {
      await this.fs.rename(tmpPath, this.filePath);
    } catch (error) {
      // If rename fails, the original file is still intact
      // (The tmp file will be left behind, but the ledger is safe)
      throw error;
    }
  }
}
