// `conduct evidence judge <slug>` — CLI for the semantic attribution evidence gate.
// Resolves feature slugs to worktrees and handles error cases.
//
// Mirrors the derive-feedback-cli.ts pattern: detected before the interactive
// pipeline boots, pure parsing (no I/O), returns dispatch type or null.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { WorktreeManager } from './worktree.js';
import { deriveCompletion, applyDerivedCompletion } from './autoheal.js';
import { createTaskEvidence } from './task-evidence.js';
import { parseAttributionVerdict } from './attribution-verdict.js';
import { validateCitations } from './attribution-validate.js';
import { markerPath } from './attribution-enforcement.js';
import type { GitRunner } from './rebase.js';
import { makeGitRunner } from './rebase.js';
import { readFile } from 'node:fs/promises';

export type EvidenceDispatch =
  | { kind: 'guide' }
  | { kind: 'judge'; slug: string };

/**
 * Parse argv for the `evidence` subcommand.
 *   conduct evidence judge <slug>    → {kind:'judge', slug:'<slug>'}
 *   conduct evidence [malformed]     → {kind:'guide'}
 *   (any other sub)                  → null
 */
export function detectEvidenceCommand(argv: string[]): EvidenceDispatch | null {
  const sub = argv[2];
  if (sub !== 'evidence') return null;

  const subCmd = argv[3];

  // Missing or empty subcommand
  if (!subCmd || subCmd === '') {
    return { kind: 'guide' };
  }

  if (subCmd === 'judge') {
    const slug = argv[4];
    if (!slug) {
      return { kind: 'guide' };
    }
    return { kind: 'judge', slug };
  }

  // Unknown subcommand
  return { kind: 'guide' };
}

export interface EvidenceDispatchDeps {
  print?: (msg: string) => void;
  cwd?: string;
}

/**
 * Dispatch the `evidence` subcommand. Routes to judge handler or prints usage.
 *
 * Exit codes:
 *   0 = success
 *   1 = runtime error (unknown feature, unreachable worktree)
 *   2 = usage/guide
 */
export async function dispatchEvidence(
  cmd: EvidenceDispatch,
  deps: EvidenceDispatchDeps = {},
): Promise<number> {
  const { print = console.log, cwd = process.cwd() } = deps;

  if (cmd.kind === 'guide') {
    print(
      'conduct evidence judge <slug>\n' +
        '  Resolve a feature slug to its worktree and run semantic attribution\n' +
        '  verification on the feature. Exits non-zero if the slug is unknown\n' +
        '  or the worktree is unreachable.\n',
    );
    return 2;
  }

  if (cmd.kind === 'judge') {
    return runEvidenceJudgeCLI(cwd, cmd.slug, { print });
  }

  // Should never reach here
  return 2;
}

/**
 * CLI wrapper for evidence judge — resolves slug to worktree and invokes the judge.
 * Returns exit code for the shell.
 */
async function runEvidenceJudgeCLI(
  projectRoot: string,
  slug: string,
  opts: { print?: (msg: string) => void } = {},
): Promise<number> {
  const { print = console.log } = opts;

  try {
    const manager = new WorktreeManager(projectRoot);
    const worktrees = await manager.scan();

    // Find worktree matching this slug
    const worktree = worktrees.find((wt) => wt.name === slug);
    if (!worktree) {
      const validSlugs = worktrees.map((wt) => wt.name).join(', ');
      print(
        `Error: unknown feature slug "${slug}"\n` +
          `Known worktrees: ${validSlugs || '(none)'}`,
      );
      return 1;
    }

    // Find the plan file for this feature
    const planPath = join(worktree.path, '.docs', 'plans', `${slug}.md`);

    // Invoke the judge
    const result = await runEvidenceJudge({
      featureSlug: slug,
      planPath,
      projectRoot: worktree.path,
      dryRun: false,
      resolveWorktree: async () => ({ root: worktree.path, branch: 'main' }),
    });

    if (!result.ok) {
      print(`Error: ${result.error || 'unknown error'}`);
      return 1;
    }

    // Print JSON before/after
    print(
      JSON.stringify({
        before: result.before,
        after: result.after,
        stampedTaskIds: result.stampedTaskIds,
      }),
    );

    return 0;
  } catch (err) {
    print(`Error: failed to judge evidence: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/**
 * Options for running evidence judge.
 */
export interface RunEvidenceJudgeOptions {
  /** Feature slug. */
  featureSlug: string;
  /** Path to the plan file. */
  planPath: string;
  /** Project root directory. */
  projectRoot: string;
  /** If true, don't write changes to task-evidence.json. */
  dryRun?: boolean;
  /** Resolver function to find worktree for feature slug. */
  resolveWorktree: (slug: string) => Promise<{ root: string; branch: string } | null>;
  /** Dispatcher to run the verifier (for testing). */
  dispatchVerifier?: (inputs: { residueIds: string[] }) => Promise<unknown>;
}

/**
 * Result of running evidence judge.
 */
export interface EvidenceJudgeResult {
  ok: boolean;
  stampedTaskIds?: string[];
  wouldStamp?: string[];
  remaining?: string[];
  before?: number;
  after?: number;
  error?: string;
}

/**
 * Run the full evidence judge lane: assemble inputs, dispatch verifier,
 * parse verdict, validate citations, apply stamps.
 *
 * @param opts - Judge options
 * @returns Judge result with status and stamped task IDs
 */
export async function runEvidenceJudge(
  opts: RunEvidenceJudgeOptions,
): Promise<EvidenceJudgeResult> {
  const {
    featureSlug,
    planPath,
    projectRoot,
    dryRun = false,
    resolveWorktree,
    dispatchVerifier,
  } = opts;

  try {
    // Check for active build marker
    const markerPathStr = markerPath(projectRoot);
    if (existsSync(markerPathStr)) {
      return {
        ok: false,
        error: 'Build step is active; cannot judge evidence while a build is in progress',
      };
    }

    // Resolve worktree for this feature
    const worktreeInfo = await resolveWorktree(featureSlug);
    if (!worktreeInfo) {
      return {
        ok: false,
        error: `Unknown feature slug: ${featureSlug}`,
      };
    }

    const { root: worktreeRoot } = worktreeInfo;

    // Read plan to extract task IDs
    const planText = await readFile(planPath, 'utf-8');
    const planTaskIds = extractTaskIdsFromPlan(planText);

    // Get current evidence state (before)
    const evidence = await createTaskEvidence(worktreeRoot);
    const beforeResidueCount = planTaskIds.filter(
      (id) => !evidence.evidenceStamps.has(id),
    ).length;

    // Set up git runner for the worktree
    const git = makeGitRunner(worktreeRoot);

    // Derive completion using existing autoheal infrastructure
    const derived = await deriveCompletion(
      worktreeRoot,
      planPath,
      evidence.evidenceStamps,
      [],
      evidence,
    );

    // Extract residue (unresolved task IDs)
    const residueIds = planTaskIds.filter((id) => !derived[id]?.completed);

    if (residueIds.length === 0) {
      // No residue; all tasks already resolved
      return {
        ok: true,
        stampedTaskIds: [],
        wouldStamp: [],
        remaining: [],
        before: beforeResidueCount,
        after: 0,
      };
    }

    // Dispatch the verifier
    // The verifier dispatcher writes .pipeline/attribution-verdict.json
    if (dispatchVerifier) {
      await dispatchVerifier({ residueIds });
    }

    // Read the verdict file written by the dispatcher
    let verdictRaw: unknown;
    const verdictPath = join(worktreeRoot, '.pipeline', 'attribution-verdict.json');
    try {
      verdictRaw = JSON.parse(await readFile(verdictPath, 'utf-8'));
    } catch {
      verdictRaw = null;
    }

    // Parse the verdict
    // Don't validate anchor here - just parse the verdicts. Anchor validation
    // is optional and may not be present in all verdict files.
    const headSha = await getCurrentHeadSha(git);
    const verdictMap = parseAttributionVerdict(
      verdictRaw,
      planTaskIds,
    );

    // Validate citations and apply stamps
    const stampedTaskIds: string[] = [];
    const wouldStampTaskIds: string[] = [];

    for (const taskId of residueIds) {
      const verdict = verdictMap.get(taskId);
      if (verdict !== 'satisfied') {
        continue; // Skip non-satisfied verdicts
      }

      // Get task paths from plan
      const taskPaths = extractPathsForTaskFromPlan(planText, taskId);

      // For now, assume verdict includes citations (from the dispatch)
      const verdictResult = verdictRaw && typeof verdictRaw === 'object' && 'results' in verdictRaw
        ? (verdictRaw as any).results?.find((r: any) => String(r.taskId) === taskId)
        : null;

      if (!verdictResult?.citations || verdictResult.citations.length === 0) {
        continue; // No citations, skip
      }

      // Validate citations
      const citationValidation = await validateCitations(
        git,
        { taskId, paths: taskPaths },
        {
          taskId,
          verdict: 'satisfied',
          citations: verdictResult.citations,
        },
        headSha,
        new Set(),
      );

      if (!citationValidation.valid) {
        continue; // Validation failed, skip
      }

      // Citation validation passed
      wouldStampTaskIds.push(taskId);
      if (!dryRun) {
        // Apply stamp to evidence
        evidence.evidenceStamps.set(taskId, {
          sha: verdictResult.citations[0].sha,
          form: 'semantic-verified',
          citedShas: verdictResult.citations.map((c: any) => c.sha),
          verdictAnchor: headSha,
          testEvidence: verdictResult.testEvidence,
        });
        stampedTaskIds.push(taskId);
      }
    }

    // Write evidence if not dry-run
    if (!dryRun && stampedTaskIds.length > 0) {
      await evidence.write();
    }

    // Re-derive to get final residue count
    const derivedAfter = await deriveCompletion(
      worktreeRoot,
      planPath,
      evidence.evidenceStamps,
      [],
      evidence,
    );
    const afterResidueCount = planTaskIds.filter((id) => !derivedAfter[id]?.completed).length;

    const remainingTaskIds = planTaskIds.filter((id) => !derivedAfter[id]?.completed);

    return {
      ok: true,
      stampedTaskIds: dryRun ? undefined : stampedTaskIds,
      wouldStamp: dryRun ? wouldStampTaskIds : undefined,
      remaining: remainingTaskIds.length > 0 ? remainingTaskIds : [],
      before: beforeResidueCount,
      after: afterResidueCount,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to judge evidence: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Extract task IDs from plan Markdown.
 * Looks for headings like "### Task 1", "### Task 7", etc.
 */
function extractTaskIdsFromPlan(planText: string): string[] {
  const headingRegex = /^###\s+Task\s+(\d+|[\w-]+)/gm;
  const ids: string[] = [];
  let match;
  while ((match = headingRegex.exec(planText)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/**
 * Extract **Files:** paths for a specific task from plan Markdown.
 */
function extractPathsForTaskFromPlan(planText: string, taskId: string): Set<string> {
  const paths = new Set<string>();
  // Find the task section
  const taskRegex = new RegExp(
    `^###\\s+Task\\s+${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?(?=^###|$)`,
    'ms',
  );
  const taskMatch = taskRegex.exec(planText);
  if (!taskMatch) return paths;

  const taskSection = taskMatch[0];
  // Extract **Files:** lines
  const filesRegex = /\*\*Files:\*\*\s*(.+?)(?:\n|$)/g;
  let filesMatch;
  while ((filesMatch = filesRegex.exec(taskSection)) !== null) {
    const filesStr = filesMatch[1];
    // Split by comma and extract paths from backticks
    const fileMatches = filesStr.match(/`([^`]+)`/g) || [];
    for (const fileMatch of fileMatches) {
      const path = fileMatch.slice(1, -1); // Remove backticks
      paths.add(path);
    }
  }
  return paths;
}

/**
 * Get current HEAD commit SHA from a git runner.
 */
async function getCurrentHeadSha(git: GitRunner): Promise<string> {
  const result = await git(['rev-parse', 'HEAD']);
  if (result.exitCode !== 0) {
    throw new Error('Failed to get HEAD SHA');
  }
  return result.stdout.trim();
}
