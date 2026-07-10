/**
 * Resolution detector for halt-monitor filed issues.
 *
 * Determines whether an issue is resolvable based on shipping evidence:
 * - Processed marker: `.daemon/processed/<slug>.json` with mtime > haltAt
 * - Shipped record: `.docs/shipped/<slug>.md` with pr: field and mtime > haltAt
 *
 * Uses strict `>` comparison (not `>=`) to guard against re-closing halts
 * that were filed after the halt started.
 */

import path from 'path';

/**
 * File system abstraction for dependency injection
 */
export interface FsAbstraction {
  /**
   * Read file contents as string
   */
  readFile(filePath: string): Promise<string>;

  /**
   * Check if file exists
   */
  fileExists(filePath: string): Promise<boolean>;

  /**
   * Get file stats including modification time
   */
  getFileStats(filePath: string): Promise<{ mtime: Date }>;
}

/**
 * Resolution result interface
 */
export interface Resolution {
  resolvable: boolean;
  prUrl?: string;
  evidence?: 'processed' | 'shipped-record' | 'halt-cleared';
  reason?: string;
}

/**
 * Processed marker schema
 */
interface ProcessedMarker {
  status: string;
  prUrl: string | null;
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns the parsed YAML object or empty object if no frontmatter found
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yamlContent = match[1];
  const result: Record<string, unknown> = {};

  // Simple YAML parser for key: value format
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      // Remove quotes if present
      result[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return result;
}

/**
 * Resolve a ledger entry to determine if it can be auto-closed
 *
 * Checks for shipping evidence in this order:
 * 1. Processed marker at `.daemon/processed/<slug>.json`
 * 2. Shipped record at `.docs/shipped/<slug>.md`
 *
 * Both require mtime > haltAt (strict guard, not >=).
 *
 * Special case: if entry.status === 'cleared' with no ship evidence,
 * return reason='cleared-no-ship' (operator closed manually without PR).
 *
 * @param entry - Ledger entry to resolve
 * @param repoDir - Repository directory path
 * @param fs - File system abstraction
 * @returns Resolution object with resolvable status and evidence details
 */
export async function resolveEntry(
  entry: { issue: string; repo: string; slug: string; haltAt: string; status: string },
  repoDir: string,
  fs: FsAbstraction
): Promise<Resolution> {
  const haltAtMs = new Date(entry.haltAt).getTime();
  const slug = entry.slug;

  // Track if we found evidence but it was guarded by mtime check
  let foundEvidenceButGuarded = false;

  // Check processed marker first
  const processedMarkerPath = path.join(repoDir, `.daemon/processed/${slug}.json`);
  const processedExists = await fs.fileExists(processedMarkerPath);

  if (processedExists) {
    const stats = await fs.getFileStats(processedMarkerPath);
    const mtimeMs = stats.mtime.getTime();

    // Strict guard: mtime must be > haltAt, not >=
    if (mtimeMs > haltAtMs) {
      const content = await fs.readFile(processedMarkerPath);
      const marker = JSON.parse(content) as ProcessedMarker;

      if (marker.prUrl) {
        return {
          resolvable: true,
          prUrl: marker.prUrl,
          evidence: 'processed'
        };
      } else {
        return {
          resolvable: false,
          reason: 'no-pr-url'
        };
      }
    } else {
      // Found evidence but mtime == haltAt
      foundEvidenceButGuarded = true;
    }
  }

  // Check shipped record as fallback
  const shippedRecordPath = path.join(repoDir, `.docs/shipped/${slug}.md`);
  const shippedExists = await fs.fileExists(shippedRecordPath);

  if (shippedExists) {
    const stats = await fs.getFileStats(shippedRecordPath);
    const mtimeMs = stats.mtime.getTime();

    // Strict guard: mtime must be > haltAt, not >=
    if (mtimeMs > haltAtMs) {
      const content = await fs.readFile(shippedRecordPath);
      const frontmatter = parseFrontmatter(content);
      const prUrl = frontmatter['pr'] as string | undefined;

      if (prUrl) {
        return {
          resolvable: true,
          prUrl,
          evidence: 'shipped-record'
        };
      } else {
        return {
          resolvable: false,
          reason: 'no-pr-url'
        };
      }
    } else {
      // Found evidence but mtime == haltAt
      foundEvidenceButGuarded = true;
    }
  }

  // If we found evidence but it was guarded, report the guard reason
  if (foundEvidenceButGuarded) {
    return {
      resolvable: false,
      reason: 'mtime-not-gt-halt'
    };
  }

  // Special case: if status is 'cleared' without ship evidence
  if (entry.status === 'cleared') {
    return {
      resolvable: false,
      reason: 'cleared-no-ship'
    };
  }

  // No shipping evidence found
  return {
    resolvable: false,
    reason: 'no-ship-evidence'
  };
}
