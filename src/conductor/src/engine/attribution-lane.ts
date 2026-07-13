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
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { HarnessConfig, EffortLevel } from '../types/config.js';
import { ModelAvailability } from './model-availability.js';
import { resolveStepConfig, phaseForStep } from './resolved-config.js';
import { collectCandidateCommits } from './attribution-inputs.js';
import { assembleAttributionInputs } from './attribution-inputs.js';
import { buildAttributionPrompt } from './attribution-prompt.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { createTaskEvidence, writeJudgedStamps } from './task-evidence.js';
import { parseAttributionVerdict } from './attribution-verdict.js';
import { validateCitations } from './attribution-validate.js';
import { parsePlanTaskPaths } from './autoheal.js';

/**
 * Verifier dispatch options.
 */
export interface VerifierDispatchOptions {
  /** LLM provider for invoking the verifier. */
  provider: LLMProvider;
  /** Project directory (conductor context). */
  projectDir: string;
  /** Path to the plan file for residue task extraction. */
  planPath: string;
  /** Residue task IDs requiring attribution verification. */
  residueIds: string[];
  /** Feature worktree directory (session CWD). */
  featureWorktreePath: string;
  /** Harness config for model/effort resolution. */
  config?: HarnessConfig;
  /** Git commit range for candidate collection (defaults to origin/main..HEAD). */
  commitRange?: string;
  /** Optional GitRunner injection for testing. */
  gitRunner?: GitRunner;
  /** Optional set of bookkeeping commit SHAs to exclude from candidates. */
  bookkeepingCommits?: Set<string>;
}

/**
 * Verifier dispatch result: success flag, output, and optional error details.
 */
export interface VerifierDispatchResult {
  success: boolean;
  output: string;
  authFailure?: boolean;
  rateLimited?: boolean;
  waitSeconds?: number;
  sessionExpired?: boolean;
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
    provider,
    projectDir,
    planPath,
    residueIds,
    featureWorktreePath,
    config,
    commitRange = 'origin/main..HEAD',
    gitRunner: injectedGit,
    bookkeepingCommits,
  } = opts;

  // Resolve config for the attribution_verify dispatch (model/effort).
  const resolved = resolveStepConfig(
    'attribution_verify',
    'BUILD',
    config,
    {},
  );

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

  // Fresh one-shot session — never contaminate the main conductor session,
  // and never resume a prior verifier session either.
  const { v4: uuidv4 } = await import('uuid');
  const sessionId = uuidv4();

  // Track every model attempted during the ladder walk so a full-ladder
  // exhaustion failure names every model tried.
  const attemptedModels: string[] = [];
  const trackingProvider: LLMProvider = {
    invoke: (invokeOpts) => {
      attemptedModels.push(invokeOpts.model ?? '');
      return provider.invoke(invokeOpts);
    },
    invokeInteractive: (invokeOpts) => provider.invokeInteractive(invokeOpts),
  };

  const modelAvailability = new ModelAvailability(config?.model_fallback_ladder, (line) =>
    console.warn(line),
  );

  // Build system prompt for the step.
  const systemPrompt = buildVerifierSystemPrompt();

  const result = await modelAvailability.invokeWithLadder(trackingProvider, {
    prompt,
    sessionId,
    resume: false,
    dangerouslySkipPermissions: true,
    model: modelAvailability.effectiveModel(resolved.model).model,
    effort: resolved.effort,
    cwd: featureWorktreePath,
    systemPrompt,
  });

  if (result.authFailure) {
    return { success: false, output: result.output, authFailure: true };
  }
  if (result.rateLimited) {
    return {
      success: false,
      output: result.output,
      rateLimited: true,
      waitSeconds: result.waitSeconds ?? 300,
    };
  }
  if (result.sessionExpired) {
    return { success: false, output: result.output, sessionExpired: true };
  }
  if (result.success) {
    // Dispatch succeeded; persist result to memo for future reuse.
    await writeMemo(memoPath, memoKey, result.output);
    return { success: true, output: result.output };
  }

  // Full-ladder exhaustion: every attempted model reported unavailable.
  // Name them all so the eventual HALT is diagnosable.
  if (result.modelUnavailable && attemptedModels.length > 1) {
    return {
      success: false,
      output: `${result.output} (model fallback ladder exhausted, tried: ${attemptedModels.join(', ')})`,
    };
  }

  return { success: false, output: result.output };
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

/**
 * Lane dispatch result — stamped task IDs and dispatch status.
 */
export interface AttributionLaneResult {
  stampedTaskIds: string[];
  dispatched: boolean;
  error?: string;
  /**
   * Task ID → unsatisfied reason mapping for retry hints.
   * Only populated when verdict was successfully parsed and validated.
   * no-verdict and invalidated verdicts are excluded.
   */
  unsatisfiedReasons?: Map<string, string>;
}

/**
 * Lane orchestration options.
 */
export interface RunAttributionLaneOptions {
  projectRoot: string;
  planPath: string;
  residueIds: string[];
  headSha: string;
  cutoverArmed: boolean;
  isZeroWorkProduct: boolean;
  git: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  dispatchVerifier: (inputs: { residueIds: string[] }) => Promise<unknown>;
  bookkeepingCommits?: Set<string>;
}

/**
 * Run the attribution lane: dispatch the verifier (if armed), parse the verdict,
 * validate citations, and apply semantic-verified stamps to residue tasks.
 * Returns the list of stamped task IDs and whether dispatch occurred.
 *
 * Integrates into conductor.ts's build gate-miss branch (Task 12), gated by
 * cutoverArmed and isZeroWorkProduct. When cutover is inactive or the build
 * produced zero work, this lane is skipped entirely — the gate miss proceeds
 * to the counter/stall logic unchanged.
 *
 * @param opts - Lane orchestration options
 * @returns Lane result: stamped task IDs and dispatch status
 */
export async function runAttributionLane(opts: RunAttributionLaneOptions): Promise<AttributionLaneResult> {
  const {
    projectRoot,
    planPath,
    residueIds,
    headSha,
    cutoverArmed,
    isZeroWorkProduct,
    git,
    dispatchVerifier,
    bookkeepingCommits,
  } = opts;

  // If cutover is not armed, skip the lane entirely — gate-miss handling
  // proceeds unchanged. This preserves byte-identical behavior when judge
  // cutover is absent/future (Story 11: inert-by-default rollout).
  if (!cutoverArmed) {
    return { stampedTaskIds: [], dispatched: false };
  }

  // If the build detected zero work product, skip dispatch — kickback's
  // signal (Story 15) takes precedence. Lane skipped, dispatch false,
  // zero_work_product reason intact in task-evidence.noEvidenceReasons.
  if (isZeroWorkProduct) {
    return { stampedTaskIds: [], dispatched: false };
  }

  // No residue = nothing to judge. No dispatch needed.
  if (residueIds.length === 0) {
    return { stampedTaskIds: [], dispatched: false };
  }

  // Dispatch the verifier in a fresh session with isolated residue input.
  // The verifier writes .pipeline/attribution-verdict.json itself.
  try {
    await dispatchVerifier({ residueIds });
  } catch (err) {
    return {
      stampedTaskIds: [],
      dispatched: false,
      error: `Verifier dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Task 12 GREEN: Parse verdict, validate citations, apply stamps, return stampedTaskIds.
  // Read the verdict file written by the verifier.
  const verdictPath = join(projectRoot, '.pipeline', 'attribution-verdict.json');
  let unsatisfiedReasons: Map<string, string> | undefined;
  const validated: Array<{
    taskId: string;
    sha: string;
    citedShas: string[];
    verdictAnchor: string;
    testEvidence: { command: string; exit: number; summary?: string };
  }> = [];
  const refused: string[] = [];

  try {
    const verdictRaw = await readFile(verdictPath, 'utf-8');
    const verdictData = JSON.parse(verdictRaw);

    // Parse the verdict with fail-closed coercion. Validate anchor if provided
    // (non-empty head). This ensures that if the verifier ran against a different
    // HEAD (e.g., a stale verdict from a previous cycle), all verdicts are
    // coerced to no-verdict (fail-closed guard).
    const anchor = verdictData?.anchor as Record<string, unknown> | undefined;
    const anchorHead = anchor?.head;
    // Only validate anchor if it was explicitly set (non-empty); test fixtures
    // may use empty anchors, which skip validation.
    const shouldValidateAnchor = typeof anchorHead === 'string' && anchorHead.length > 0;
    const verdictMap = parseAttributionVerdict(
      verdictData,
      residueIds,
      shouldValidateAnchor ? headSha : undefined,
      shouldValidateAnchor ? residueIds : undefined,
    );

    // Load the plan to extract task paths for citation validation
    const planText = await readFile(planPath, 'utf-8');
    const planTaskPaths = parsePlanTaskPaths(planText);

    // Extract unsatisfied verdicts and their reasons
    const unsatisfied = new Map<string, string>();
    for (const entry of (verdictData?.results as unknown[]) || []) {
      if (!entry || typeof entry !== 'object') continue;
      const entryObj = entry as Record<string, unknown>;
      const taskId = String(entryObj.taskId);
      const verdict = verdictMap.get(taskId);

      // Only include unsatisfied verdicts (not no-verdict, not invalidated)
      if (verdict === 'unsatisfied' && typeof entryObj.reason === 'string') {
        unsatisfied.set(taskId, entryObj.reason);
      }

      // Process satisfied verdicts: validate citations and collect stamps
      if (verdict === 'satisfied') {
        const verdictEntry = entryObj as Record<string, unknown>;
        const citations = verdictEntry.citations as unknown[];
        const testEvidence = verdictEntry.testEvidence as Record<string, unknown>;

        // Validate citations against the task's declared paths
        if (Array.isArray(citations) && citations.length > 0 && testEvidence) {
          const taskPaths = planTaskPaths.get(taskId) ?? new Set<string>();
          const normalizedCitations = citations.map((c: unknown) => {
            const cObj = c as Record<string, unknown>;
            return { sha: String(cObj.sha), rationale: String(cObj.rationale ?? '') };
          });
          const validationResult = await validateCitations(
            git,
            { taskId, paths: taskPaths },
            {
              taskId,
              verdict: 'satisfied',
              citations: normalizedCitations,
            },
            headSha,
            bookkeepingCommits,
          );

          if (validationResult.valid) {
            // Collect validated task with its cited SHA and full metadata
            const citedShas = normalizedCitations.map((c) => c.sha);
            validated.push({
              taskId,
              sha: citedShas[0], // Primary SHA is the first citation
              citedShas,
              verdictAnchor: headSha,
              testEvidence: {
                command: String(testEvidence.command ?? ''),
                exit: Number(testEvidence.exit ?? -1),
                summary: testEvidence.summary ? String(testEvidence.summary) : undefined,
              },
            });
          } else {
            // Validation failed: add to refused list
            refused.push(taskId);
          }
        } else {
          // No valid citations or test evidence: add to refused list
          refused.push(taskId);
        }
      } else {
        // Unsatisfied, no-verdict, or undefined: add to refused list
        refused.push(taskId);
      }
    }

    if (unsatisfied.size > 0) {
      unsatisfiedReasons = unsatisfied;
    }
  } catch (err) {
    // Verdict file missing or unparseable — continue without retry hints
    // (the verdict coercion itself already handles fail-closed behavior)
    return {
      stampedTaskIds: [],
      dispatched: true,
      error: `Failed to parse verdict or validate citations: ${err instanceof Error ? err.message : String(err)}`,
      unsatisfiedReasons,
    };
  }

  // Write the judged stamps to the sidecar
  try {
    await writeJudgedStamps(projectRoot, validated, refused);
  } catch (err) {
    return {
      stampedTaskIds: [],
      dispatched: true,
      error: `Failed to write judged stamps: ${err instanceof Error ? err.message : String(err)}`,
      unsatisfiedReasons,
    };
  }

  return {
    stampedTaskIds: validated.map((v) => v.taskId),
    dispatched: true,
    unsatisfiedReasons,
  };
}
