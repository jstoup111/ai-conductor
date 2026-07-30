import type { LLMProvider, InvokeOptions, InvokeResult } from "../execution/llm-provider.js";
import { v4 as uuidv4 } from "uuid";
import { CLAUDE_MODEL_POLICY } from "./provider-model-policy.js";

/** @deprecated Use CLAUDE_MODEL_POLICY.modelFallbackLadder instead. */
export const DEFAULT_MODEL_FALLBACK_LADDER: readonly string[] = CLAUDE_MODEL_POLICY.modelFallbackLadder;

export interface EffectiveModelResult {
  model: string;
  downgraded: boolean;
}

export interface ResolvedModelInvocation {
  result: InvokeResult;
  model: string;
}

export type PrepareModelFallbackOptions = (
  nextModel: string,
) => Promise<Pick<InvokeOptions, 'sessionId' | 'resume'>>;

const prepareFreshFallbackOptions: PrepareModelFallbackOptions = async () => ({
  sessionId: uuidv4(),
  resume: false,
});

/**
 * Per-process cache tracking which models have been observed to be unavailable
 * (e.g. rate-limited, overloaded, or otherwise dead) so callers can transparently
 * fall back to the next live entry in a configured ladder.
 *
 * Restart semantics: a new instance re-allows all models — the dead set is
 * purely in-memory and does not persist across process restarts.
 */
export class ModelAvailability {
  private readonly ladder: readonly string[];
  private readonly warn?: (line: string) => void;
  readonly dead: Set<string> = new Set();

  constructor(ladder?: readonly string[], warn?: (line: string) => void) {
    this.ladder = ladder === undefined ? DEFAULT_MODEL_FALLBACK_LADDER : ladder;
    this.warn = warn;
  }

  markDead(model: string): void {
    this.dead.add(model);
  }

  private emitWarn(configured: string, fallback: string, reason: string): void {
    this.warn?.(`Downgraded from ${configured} to ${fallback}: ${reason}`);
  }

  effectiveModel(configured: string): EffectiveModelResult {
    if (!this.dead.has(configured)) {
      return { model: configured, downgraded: false };
    }

    const configuredIndex = this.ladder.indexOf(configured);
    const candidates = configuredIndex >= 0 ? this.ladder.slice(configuredIndex + 1) : this.ladder;

    for (const candidate of candidates) {
      if (!this.dead.has(candidate)) {
        this.emitWarn(configured, candidate, `${configured} is not available (unavailable)`);
        return { model: candidate, downgraded: true };
      }
    }

    // All ladder entries are dead; fall back to the originally configured model.
    return { model: configured, downgraded: true };
  }

  /**
   * Invokes the provider with the requested model, walking the fallback ladder
   * in-attempt when the provider reports modelUnavailable. Each unavailable
   * model is marked dead so subsequent invocations (in this process) skip it
   * via effectiveModel(). Any other result (success or ordinary failure, e.g.
   * rate-limited) is returned immediately without further ladder walking.
   *
   * Ordering: recovery signals are checked before modelUnavailable. Auth,
   * rate-limit, and session-expiry recovery must never poison the ladder.
   */
  async invokeWithLadder(
    provider: LLMProvider,
    options: InvokeOptions,
    prepareFallbackOptions: PrepareModelFallbackOptions = prepareFreshFallbackOptions,
  ): Promise<InvokeResult> {
    return (await this.invokeWithLadderResolved(provider, options, prepareFallbackOptions)).result;
  }

  /**
   * Engine-internal variant that retains the final model identity alongside
   * the provider-compatible InvokeResult payload.
   */
  async invokeWithLadderResolved(
    provider: LLMProvider,
    options: InvokeOptions,
    prepareFallbackOptions: PrepareModelFallbackOptions = prepareFreshFallbackOptions,
  ): Promise<ResolvedModelInvocation> {
    const requested = options.model ?? "";
    const result = await provider.invoke({ ...options, model: requested });

    // Existing recovery owns these failures, even if a provider reports
    // conflicting availability metadata.
    if (result.authFailure || result.rateLimited || result.sessionExpired) {
      return { result, model: requested };
    }

    if (!result.modelUnavailable) {
      return { result, model: requested };
    }

    if (this.ladder.length === 0) {
      // No fallback ladder configured; nothing to walk, nothing to mark dead.
      return { result, model: requested };
    }

    this.markDead(requested);
    const { model: nextModel } = this.effectiveModel(requested);

    if (nextModel === requested) {
      // No live ladder entry remains; nothing further to try.
      return { result, model: requested };
    }

    const fallbackOptions = await prepareFallbackOptions(nextModel);
    const resolved = await this.invokeWithLadderResolved(provider, {
      ...options,
      ...fallbackOptions,
      model: nextModel,
    }, prepareFallbackOptions);
    const observedIntervals = [
      ...(result.observedIntervals ?? []),
      ...(resolved.result.observedIntervals ?? []),
    ];

    return observedIntervals.length === 0
      ? resolved
      : {
          ...resolved,
          result: { ...resolved.result, observedIntervals },
        };
  }
}
