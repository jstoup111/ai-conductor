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

import { readFile } from 'node:fs/promises';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { HarnessConfig, EffortLevel } from '../types/config.js';
import { ModelAvailability } from './model-availability.js';
import { resolveStepConfig, phaseForStep } from './resolved-config.js';
import { collectCandidateCommits } from './attribution-inputs.js';
import { assembleAttributionInputs } from './attribution-inputs.js';
import { buildAttributionPrompt } from './attribution-prompt.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { createTaskEvidence } from './task-evidence.js';

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
