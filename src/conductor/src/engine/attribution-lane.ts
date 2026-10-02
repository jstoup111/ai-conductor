/**
 * Fresh-session verifier dispatch orchestration.
 *
 * Dispatches the semantic attribution verifier in a fresh, isolated session.
 * The verifier runs with its own session ID (never resumes the conductor's
 * session), stepped through the model fallback ladder, with strict input
 * isolation (residue tasks + candidate commits only — no conductor state).
 *
 * Pattern: mirrors runBuildReview (step-runners.ts:711) — one-shot dispatch
 * with fresh uuid, resume: false, ladder-walked model availability, and
 * full-ladder exhaustion handling.
 *
 * This is a separate module (not a DefaultStepRunner method) so it can be
 * invoked independently from dispatch orchestration.
 *
 * GATING REMOVED (feature #773): this module previously exposed an inert
 * lane-orchestration stub that parsed the verifier's verdict, validated
 * citations (attribution-validate.ts), and stamped
 * `semantic-verified` evidence that let the build gate advance on an
 * unearned verdict. Per-task commit-stamping has been demoted from a gate
 * to telemetry — the build completion gate no longer derives from per-task
 * evidence stamps at all (see artifacts.ts, Task 10). Citation quality
 * sampling/telemetry now lives exclusively in the separate, non-blocking
 * spot-audit path (attribution-audit.ts's `runSpotAudit`, wired post-green
 * in conductor.ts). The inert stub itself has been deleted (#773, Task 5)
 * as dead code; this module now retains only the memo/dispatch machinery
 * below (`computeMemoKey`, `readMemo`, `writeMemo`, `rekeyMemoAfterRebase`,
 * `dispatchAttributionVerifier`).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type {
  InvokeOptions,
  TokenUsage,
  AuthenticationReadiness,
} from '../execution/llm-provider.js';
import { collectCandidateCommits } from './attribution-inputs.js';
import { assembleAttributionInputs } from './attribution-inputs.js';
import { buildAttributionPrompt } from './attribution-prompt.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { createTaskEvidence } from './task-evidence.js';
import type {
  ProviderAttributionMetadata,
  ProviderExecutionResult,
} from './provider-execution.js';

type AttributionProviderDispatch = (
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>,
) => Promise<ProviderExecutionResult>;

/**
 * Verifier dispatch options.
 */
export interface VerifierDispatchOptions {
  /** Project directory (conductor context). */
  projectDir: string;
  /** Path to the plan file for residue task extraction. */
  planPath: string;
  /** Residue task IDs requiring attribution verification. */
  residueIds: string[];
  /** Feature worktree directory (session CWD). */
  featureWorktreePath: string;
  /** Git commit range for candidate collection (defaults to origin/main..HEAD). */
  commitRange?: string;
  /** Optional GitRunner injection for testing. */
  gitRunner?: GitRunner;
  /** Optional set of bookkeeping commit SHAs to exclude from candidates. */
  bookkeepingCommits?: Set<string>;
  /**
   * Provider-aware dispatch seam. The shared executor resolves provider
   * candidates and each candidate's native model ladder.
   */
  providerDispatch: AttributionProviderDispatch;
}

/**
 * Verifier dispatch result: success flag, output, and optional error details.
 */
export interface VerifierDispatchResult extends ProviderAttributionMetadata {
  success: boolean;
  output: string;
  model?: string;
  tokenUsage?: TokenUsage;
  authFailure?: boolean;
  rateLimited?: boolean;
  waitSeconds?: number;
  authentication?: AuthenticationReadiness;
}

/**
 * Attribution result memo: caches (HEAD, residue) -> verdict mapping.
 * Keyed by <HEAD>:<sorted-residue-ids> to detect cache staleness.
 */
interface AttributionMemo {
  key: string;
  result: string;
}

/**
 * Compute memoization key from current HEAD and sorted residue IDs.
 * Key format: <HEAD>:<sorted-residue-ids>
 *
 * @param headSha - Current HEAD commit SHA (first 40 chars)
 * @param residueIds - Task IDs to sort and join
 * @returns Memoization key
 */
export function computeMemoKey(headSha: string, residueIds: string[]): string {
  const sorted = [...residueIds].sort();
  return `${headSha}:${sorted.join(',')}`;
}

/**
 * Get current HEAD commit SHA from git repository.
 *
 * @param git - Git runner instance
 * @returns HEAD SHA (full 40-char)
 */
async function getCurrentHeadSha(git: GitRunner): Promise<string> {
  const result = await git(['rev-parse', 'HEAD']);
  if (result.exitCode !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Read memoized attribution result if it exists and key matches.
 * Returns undefined if memo doesn't exist, key doesn't match, or read fails.
 *
 * @param memoPath - Path to memo file
 * @param expectedKey - Expected memoization key
 * @returns Memoized result or undefined
 */
export async function readMemo(memoPath: string, expectedKey: string): Promise<string | undefined> {
  try {
    const content = await readFile(memoPath, 'utf-8');
    const memo: AttributionMemo = JSON.parse(content);
    if (memo.key === expectedKey) {
      return memo.result;
    }
  } catch {
    // File doesn't exist, is invalid JSON, or read fails — treat as cache miss
  }
  return undefined;
}

/**
 * Persist attribution result to memo file.
 * Creates .pipeline directory if needed.
 *
 * @param memoPath - Path to memo file
 * @param key - Memoization key
 * @param result - Verifier output
 */
export async function writeMemo(memoPath: string, key: string, result: string): Promise<void> {
  const pipelineDir = dirname(memoPath);
  try {
    await mkdir(pipelineDir, { recursive: true });
    const memo: AttributionMemo = { key, result };
    await writeFile(memoPath, JSON.stringify(memo), 'utf-8');
  } catch {
    // Memo write failure is not critical; silently continue
  }
}

/**
 * Re-key an existing memo entry after a rebase translates commit SHAs.
 *
 * If the memo's cached verdict is still valid under the new HEAD — i.e. none
 * of the judged commits it cites fell into the rebase's sha-residue/unmapped
 * set — translate the `anchor.head` field to the new HEAD and rewrite the
 * memo under the recomputed key (`computeMemoKey(newHead, residueIds)`) so a
 * subsequent `readMemo` hits without forcing an unnecessary re-judge.
 *
 * If any judged commit referenced by the memo entry IS in `shaResidue`, the
 * memo is left untouched — it will miss on next read (old key no longer
 * matches new HEAD) and be re-judged.
 *
 * @param projectRoot - Project root directory (memo lives at
 *   `<projectRoot>/.pipeline/attribution-memo.json`)
 * @param _map - Rewrite map from old SHAs (commits and HEAD) to new SHAs
 * @param oldHead - Pre-rebase HEAD SHA
 * @param newHead - Post-rebase HEAD SHA
 * @param residueIds - Pending task IDs used for the #520 memo-key convention
 *   (`computeMemoKey`) — NOT commit SHAs.
 * @param shaResidue - Commit SHAs dropped/unmapped by the rebase (the real
 *   sha-residue set). Used only for the safety guard below: if a judged
 *   commit cited by the cached memo is in this set, the memo is left alone
 *   rather than re-keyed onto the new HEAD.
 */
export async function rekeyMemoAfterRebase(
  projectRoot: string,
  _map: Record<string, string>,
  oldHead: string,
  newHead: string,
  residueIds: string[],
  shaResidue: string[],
): Promise<void> {
  const memoPath = join(projectRoot, '.pipeline', 'attribution-memo.json');
  const oldKey = computeMemoKey(oldHead, residueIds);
  const cached = await readMemo(memoPath, oldKey);
  if (cached === undefined) {
    return;
  }

  let parsed: { anchor?: { head?: string }; results?: Array<{ citations?: Array<{ sha?: string }> }> };
  try {
    parsed = JSON.parse(cached);
  } catch {
    return;
  }

  // If any judged commit cited in the memo is itself part of the sha
  // residue set, leave the memo alone so it misses and gets re-judged.
  const residueSet = new Set(shaResidue);
  const citedShas = (parsed.results ?? []).flatMap((r) =>
    (r.citations ?? []).map((c) => c.sha).filter((sha): sha is string => Boolean(sha)),
  );
  if (citedShas.some((sha) => residueSet.has(sha))) {
    return;
  }

  if (parsed.anchor) {
    parsed.anchor.head = newHead;
  }

  const newKey = computeMemoKey(newHead, residueIds);
  await writeMemo(memoPath, newKey, JSON.stringify(parsed));
}

/**
 * Dispatch the attribution verifier in a fresh session.
 *
 * Assembles residue tasks and candidate commits, builds the verifier prompt,
 * and invokes the verifier with fresh session ID (never resumes conductor),
 * stepped through the model fallback ladder. Returns success/failure with
 * diagnostic details on error.
 *
 * @param opts - Dispatch configuration
 * @returns Verifier dispatch result (success + output or error details)
 */
export async function dispatchAttributionVerifier(
  opts: VerifierDispatchOptions,
): Promise<VerifierDispatchResult> {
  const {
    projectDir,
    planPath,
    residueIds,
    featureWorktreePath,
    commitRange = 'origin/main..HEAD',
    gitRunner: injectedGit,
    bookkeepingCommits,
    providerDispatch,
  } = opts;

  // Set up the git runner for candidate collection.
  const git = injectedGit ?? makeGitRunner(projectDir);

  // Get current HEAD SHA for memoization key computation.
  let headSha: string;
  try {
    headSha = await getCurrentHeadSha(git);
  } catch (err) {
    return {
      success: false,
      output: `Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Compute memoization key and check for cached result.
  const memoKey = computeMemoKey(headSha, residueIds);
  const memoPath = join(projectDir, '.pipeline', 'attribution-memo.json');
  const cachedResult = await readMemo(memoPath, memoKey);
  if (cachedResult !== undefined) {
    return { success: true, output: cachedResult };
  }

  // Collect candidate commits (uncited, non-empty, non-bookkeeping).
  let candidates;
  try {
    const evidence = await createTaskEvidence(projectDir);
    candidates = await collectCandidateCommits(
      git,
      evidence,
      commitRange,
      bookkeepingCommits,
      projectDir,
    );
  } catch (err) {
    return {
      success: false,
      output: `Failed to collect candidate commits: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Assemble verifier inputs: residue task sections + candidates.
  let inputs;
  try {
    const prompt = await assembleAttributionInputs(planPath, residueIds, candidates);
    inputs = { prompt };
  } catch (err) {
    return {
      success: false,
      output: `Failed to assemble attribution inputs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build the verifier prompt from structurally-isolated inputs.
  const prompt = buildAttributionPrompt(inputs);

  // Build system prompt for the step.
  const systemPrompt = buildVerifierSystemPrompt();
  const result = await providerDispatch({
    prompt,
    dangerouslySkipPermissions: true,
    cwd: featureWorktreePath,
    systemPrompt,
  });
  const providerMetadata = {
    preferredProvider: result.preferredProvider,
    ...(result.actualProvider
      ? { actualProvider: result.actualProvider }
          : {}),
    attempts: result.attempts,
    ...(result.resolvedModel
      ? { model: result.resolvedModel }
          : {}),
    ...(result.tokenUsage
      ? { tokenUsage: result.tokenUsage }
          : {}),
    ...(result.authentication
      ? { authentication: result.authentication }
          : {}),
    ...(result.providerSetupExhaustion
      ? { providerSetupExhaustion: result.providerSetupExhaustion }
          : {}),
  };

  if (result.authFailure) {
    return {
      success: false,
      output: result.output,
      authFailure: true,
      ...providerMetadata,
    };
  }
  if (result.rateLimited) {
    return {
      success: false,
      output: result.output,
      rateLimited: true,
      waitSeconds: result.waitSeconds ?? 300,
      ...providerMetadata,
    };
  }
  if (result.success) {
    // Dispatch succeeded; persist result to memo for future reuse.
    await writeMemo(memoPath, memoKey, result.output);
    return { success: true, output: result.output, ...providerMetadata };
  }

  return { success: false, output: result.output, ...providerMetadata };
}

/**
 * Build system prompt for the attribution verifier dispatch.
 * Identifies the step and provides context for the fresh session.
 */
function buildVerifierSystemPrompt(): string {
  return `[Conduct: attribution_verify]

You are running the semantic attribution verification step. Your job is to match candidate commits to residue tasks and verify evidence (citations and tests).

Complete this step, write the verdict to .pipeline/attribution-verdict.json, then exit.`;
}
