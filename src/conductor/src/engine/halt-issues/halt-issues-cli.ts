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
 *
 * Production `gh`/fs wiring lives ONLY here (via the canonical `TrackerClient`
 * seam) — the pure `sweep.ts` orchestrator takes an injected `TrackerClient`
 * and never shells out itself, so its tests never spawn a real `gh` process.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sweep } from './sweep.js';
import { createGithubTrackerClient, makeProductionGh as makeProductionGhRunner } from '../tracker-client.js';

export type HaltIssuesSweepCommand =
  | { kind: 'sweep'; dryRun: boolean; repoDir: string; monitorLog: string; ledger: string; ghRepo: string }
  | { kind: 'help' }
  | { kind: 'guide' };

const KNOWN_FLAGS = new Set(['--dry-run', '--repo-dir', '--monitor-log', '--ledger', '--gh-repo', '--help', '-h']);

function defaultMonitorLogPath(): string {
  return join(homedir(), '.ai-conductor', 'halt-monitor', 'monitor.log');
}

function defaultLedgerPath(): string {
  return join(homedir(), '.ai-conductor', 'halt-issues', 'ledger.json');
}

/**
 * Parse argv for the `halt-issues sweep` subcommand.
 *   conduct halt-issues sweep --repo-dir <dir> --gh-repo <repo> [--monitor-log <path>]
 *     [--ledger <path>] [--dry-run]
 *   → {kind:'sweep', ...} (monitor-log/ledger default to ~/.ai-conductor/...)
 *   conduct halt-issues sweep --help → {kind:'help'}
 *   conduct halt-issues sweep [anything malformed, e.g. unknown flag, missing
 *     required flag] → {kind:'guide'}
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

  // Negative path: any unrecognized `--flag` is a malformed invocation, not a
  // silently-ignored no-op — otherwise a typo'd flag looks like it worked.
  for (const token of rest) {
    if (token.startsWith('--') && !KNOWN_FLAGS.has(token)) {
      return { kind: 'guide' };
    }
  }

  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const hasFlag = (name: string): boolean => rest.includes(name);

  const repoDir = flag('--repo-dir');
  const ghRepo = flag('--gh-repo');
  const monitorLog = flag('--monitor-log') ?? defaultMonitorLogPath();
  const ledger = flag('--ledger') ?? defaultLedgerPath();

  if (!repoDir || !ghRepo) {
    return { kind: 'guide' };
  }

  return {
    kind: 'sweep',
    dryRun: hasFlag('--dry-run'),
    repoDir,
    monitorLog,
    ledger,
    ghRepo,
  };
}

/**
 * Production filesystem abstraction for the sweep orchestrator.
 */
function makeProductionFs() {
  return {
    async readFile(path: string): Promise<string> {
      return readFile(path, 'utf-8');
    },

    async writeFile(path: string, data: string): Promise<void> {
      await writeFile(path, data, 'utf-8');
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await rename(oldPath, newPath);
    },

    async fileExists(path: string): Promise<boolean> {
      return existsSync(path);
    },

    async getFileStats(path: string): Promise<{ mtime: Date }> {
      const fs = await import('node:fs/promises');
      const stats = await fs.stat(path);
      return { mtime: stats.mtime };
    },
  };
}

const productionClock = { now: () => new Date() };

/**
 * Dispatch the `halt-issues sweep` command
 *
 * @param cmd - Parsed command with sweep options
 * @param cwd - Current working directory (unused by the sweep itself; kept for
 *   parity with the other CLI dispatchers so a future repo-relative default
 *   can be added without changing the call sites)
 * @returns Exit code (0 on success, even with recorded errors; non-zero only on unrecoverable failure)
 */
export async function dispatchHaltIssuesSweep(cmd: HaltIssuesSweepCommand, cwd: string): Promise<number> {
  void cwd;

  const helpText =
    'Usage: conduct-ts halt-issues sweep [options]\n\n' +
    'Orchestrate the full sweep pipeline for processing filed halt-monitor issues:\n' +
    '  1. Parse monitor log → extract verdicts\n' +
    '  2. Load/rebuild ledger with parsed verdicts\n' +
    '  3. Process each entry: stamp, resolve, close\n' +
    '  4. Write ledger atomically\n' +
    '  5. Print summary and exit\n\n' +
    'Options:\n' +
    '  --dry-run             Run without writing to ledger\n' +
    '  --repo-dir <dir>      Repository directory (required; target for file searches)\n' +
    '  --gh-repo <repo>      GitHub repository owner/name (required)\n' +
    '  --monitor-log <path>  Path to monitor.log (default: ~/.ai-conductor/halt-monitor/monitor.log)\n' +
    '  --ledger <path>       Path to ledger.json (default: ~/.ai-conductor/halt-issues/ledger.json)';

  if (cmd.kind === 'help') {
    console.log(helpText);
    return 0;
  }

  if (cmd.kind === 'guide') {
    console.error(helpText);
    return 1;
  }

  try {
    const gh = createGithubTrackerClient(makeProductionGhRunner());
    const fs = makeProductionFs();

    const result = await sweep({
      monitorLogPath: cmd.monitorLog,
      ledgerPath: cmd.ledger,
      repoDir: cmd.repoDir,
      repo: cmd.ghRepo,
      dryRun: cmd.dryRun,
      fs,
      gh,
      clock: productionClock,
    });

    console.log(result.summary);

    if ((cmd.dryRun || result.errors > 0) && result.parsed > 0) {
      if (!cmd.dryRun) {
        try {
          const ledgerContent = await fs.readFile(cmd.ledger);
          const ledgerSchema = JSON.parse(ledgerContent);
          for (const [issue, entry] of Object.entries(ledgerSchema.entries)) {
            const e = entry as { lastError?: string };
            if (e.lastError) {
              console.error(`  #${issue}: ${e.lastError}`);
            }
          }
        } catch {
          // If we can't read the ledger, just continue
        }
      } else {
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
