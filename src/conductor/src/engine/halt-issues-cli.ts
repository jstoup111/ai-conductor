/**
 * CLI handler for `conduct-ts halt-issues sweep` subcommand.
 *
 * Orchestrates the full sweep pipeline for processing filed halt-monitor issues:
 * 1. Parse monitor log → extract verdicts
 * 2. Load/rebuild ledger with parsed verdicts
 * 3. Process each entry: stamp, resolve, close
 * 4. Write ledger atomically
 * 5. Print summary and exit
 *
 * Part of the halt-monitor filed issues never auto-close flow (ADR D3/D5).
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { sweep } from './halt-issues/sweep.js';

export type HaltIssuesSweepCommand =
  | { kind: 'sweep'; dryRun: boolean; repoDir: string; monitorLog: string; ledger: string; ghRepo: string }
  | { kind: 'help' }
  | { kind: 'guide' };

/**
 * Parse argv for the `halt-issues sweep` subcommand.
 *   conduct halt-issues sweep --repo-dir <dir> --monitor-log <path> --ledger <path> --gh-repo <repo> [--dry-run]
 *   → {kind:'sweep', ...}
 *   conduct halt-issues sweep --help → {kind:'help'}
 *   conduct halt-issues sweep [anything malformed] → {kind:'guide'}
 *   (any other sub) → null
 *
 * Malformed args return `guide` (never null): a recognized-but-misused subcommand
 * must never fall through to the pipeline launcher.
 */
export function detectHaltIssuesSweepCommand(argv: string[]): HaltIssuesSweepCommand | null {
  if (argv[2] !== 'halt-issues' || argv[3] !== 'sweep') return null;

  const rest = argv.slice(4);

  // Check for --help or -h
  if (rest.some((a) => a === '--help' || a === '-h')) {
    return { kind: 'help' };
  }

  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const hasFlag = (name: string): boolean => rest.includes(name);

  const repoDir = flag('--repo-dir');
  const monitorLog = flag('--monitor-log');
  const ledger = flag('--ledger');
  const ghRepo = flag('--gh-repo');

  if (!repoDir || !monitorLog || !ledger || !ghRepo) {
    return { kind: 'guide' };
  }

  return {
    kind: 'sweep',
    dryRun: hasFlag('--dry-run'),
    repoDir,
    monitorLog,
    ledger,
    ghRepo
  };
}

/**
 * GitHub CLI abstraction for production wiring
 */
class GhCliAdapter {
  constructor(private repo: string) {}

  async getIssueBody(repo: string, issue: string): Promise<string | null> {
    try {
      const result = await execa('gh', ['issue', 'view', issue, '--json', 'body', '-q', '.body'], {
        cwd: '.',
        reject: false,
        env: { ...process.env, GH_REPO: repo }
      });
      if (result.exitCode !== 0) {
        return null;
      }
      return result.stdout;
    } catch (err) {
      throw new Error(`Failed to get issue body: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async upsertIssueBody(repo: string, issue: string, body: string): Promise<void> {
    try {
      await execa('gh', ['issue', 'edit', issue, '--body', body], {
        cwd: '.',
        env: { ...process.env, GH_REPO: repo }
      });
    } catch (err) {
      throw new Error(`Failed to update issue body: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getIssueLabels(repo: string, issue: string): Promise<string[]> {
    try {
      const result = await execa('gh', ['issue', 'view', issue, '--json', 'labels', '-q', '.labels[].name'], {
        cwd: '.',
        reject: false,
        env: { ...process.env, GH_REPO: repo }
      });
      if (result.exitCode !== 0) {
        return [];
      }
      return result.stdout.split('\n').filter((line) => line.trim());
    } catch (err) {
      return [];
    }
  }

  async getIssueState(repo: string, issue: string): Promise<'open' | 'closed' | null> {
    try {
      const result = await execa('gh', ['issue', 'view', issue, '--json', 'state', '-q', '.state'], {
        cwd: '.',
        reject: false,
        env: { ...process.env, GH_REPO: repo }
      });
      if (result.exitCode !== 0) {
        return null;
      }
      const state = result.stdout.trim().toLowerCase();
      return state === 'open' || state === 'closed' ? state : null;
    } catch (err) {
      return null;
    }
  }

  async upsertIssueComment(repo: string, issue: string, body: string): Promise<void> {
    try {
      await execa('gh', ['issue', 'comment', issue, '--body', body], {
        cwd: '.',
        env: { ...process.env, GH_REPO: repo }
      });
    } catch (err) {
      throw new Error(`Failed to comment on issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async closeIssue(repo: string, issue: string): Promise<void> {
    try {
      await execa('gh', ['issue', 'close', issue], {
        cwd: '.',
        env: { ...process.env, GH_REPO: repo }
      });
    } catch (err) {
      throw new Error(`Failed to close issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * File system abstraction for production wiring
 */
class FsAdapter {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, 'utf-8');
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(oldPath, newPath);
  }

  async fileExists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async getFileStats(path: string): Promise<{ mtime: Date }> {
    const fs = await import('node:fs/promises');
    const stats = await fs.stat(path);
    return { mtime: stats.mtime };
  }
}

/**
 * Simple clock abstraction
 */
const clock = { now: () => new Date() };

/**
 * Dispatch the `halt-issues sweep` command
 *
 * @param cmd - Parsed command with sweep options
 * @param cwd - Current working directory
 * @returns Exit code (0 on success, even with recorded errors; non-zero only on unrecoverable failure)
 */
export async function dispatchHaltIssuesSweep(cmd: HaltIssuesSweepCommand, cwd: string): Promise<number> {
  const helpText =
    'Usage: conduct-ts halt-issues sweep [options]\n\n' +
    'Orchestrate the full sweep pipeline for processing filed halt-monitor issues:\n' +
    '  1. Parse monitor log → extract verdicts\n' +
    '  2. Load/rebuild ledger with parsed verdicts\n' +
    '  3. Process each entry: stamp, resolve, close\n' +
    '  4. Write ledger atomically\n' +
    '  5. Print summary and exit\n\n' +
    'Options:\n' +
    '  --dry-run          Run without writing to ledger\n' +
    '  --repo-dir <dir>   Repository directory (target for file searches)\n' +
    '  --monitor-log <path>  Path to monitor.log file\n' +
    '  --ledger <path>    Path to ledger.json file\n' +
    '  --gh-repo <repo>   GitHub repository (owner/name)';

  if (cmd.kind === 'help') {
    console.log(helpText);
    return 0;
  }

  if (cmd.kind === 'guide') {
    console.error(helpText);
    return 1;
  }

  try {
    const gh = new GhCliAdapter(cmd.ghRepo);
    const fs = new FsAdapter();

    const result = await sweep({
      monitorLogPath: cmd.monitorLog,
      ledgerPath: cmd.ledger,
      repoDir: cmd.repoDir,
      repo: cmd.ghRepo,
      dryRun: cmd.dryRun,
      fs,
      gh,
      clock
    });

    // Print summary
    console.log(result.summary);

    // Print per-issue mentions in dry-run mode or when there are errors
    if ((cmd.dryRun || result.errors > 0) && result.parsed > 0) {
      // In non-dry-run mode, try to read the ledger to print error details
      if (!cmd.dryRun) {
        try {
          const ledgerContent = await fs.readFile(cmd.ledger);
          const ledger = JSON.parse(ledgerContent);
          for (const [issue, entry] of Object.entries(ledger.entries)) {
            const e = entry as any;
            if (e.lastError) {
              console.error(`  #${issue}: ${e.lastError}`);
            }
          }
        } catch {
          // If we can't read the ledger, just continue
        }
      } else {
        // In dry-run mode, print all parsed issue mentions to stdout for visibility
        for (const entry of result.entries || []) {
          console.log(`  #${entry.issue}: ${entry.slug}`);
        }
      }
    }

    return result.exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`halt-issues sweep failed: ${msg}`);
    return 1;
  }
}
