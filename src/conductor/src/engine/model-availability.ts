import type { LLMProvider, InvokeOptions, InvokeResult } from "../execution/llm-provider.js";

export const DEFAULT_MODEL_FALLBACK_LADDER: string[] = ["fable", "opus", "sonnet"];

export interface EffectiveModelResult {
  model: string;
  downgraded: boolean;
}

/**
 * Per-process cache tracking which models have been observed to be unavailable
 * (e.g. rate-limited, overloaded, or otherwise dead) so callers can transparently
 * fall back to the next live entry in a configured ladder.
 *
 * Restart semantics: a new instance re-allows all models — the dead set is
 * purely in-memory and does not persist across process restarts.
 */
export class ModelAvailability {
  private readonly ladder: string[];
  private readonly warn?: (line: string) => void;
  readonly dead: Set<string> = new Set();

  constructor(ladder?: string[], warn?: (line: string) => void) {
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

    for (const candidate of this.ladder) {
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
   * Ordering: authFailure is checked first (transient auth issue, not a model problem)
   * before modelUnavailable (model is permanently unavailable). This prevents auth
   * failures from poisoning the ladder.
   */
  async invokeWithLadder(provider: LLMProvider, options: InvokeOptions): Promise<InvokeResult> {
    const requested = options.model ?? "";
    const result = await provider.invoke({ ...options, model: requested });

    // Auth failure is transient (operator's OAuth token may be stale) — never poison
    // the ladder. Return immediately without marking the model dead or walking.
    if (result.authFailure) {
      return result;
    }

    if (!result.modelUnavailable) {
      return result;
    }

    if (this.ladder.length === 0) {
      // No fallback ladder configured; nothing to walk, nothing to mark dead.
      return result;
    }

    this.markDead(requested);
    const { model: nextModel } = this.effectiveModel(requested);

    if (nextModel === requested) {
      // No live ladder entry remains; nothing further to try.
      return result;
    }

    return this.invokeWithLadder(provider, { ...options, model: nextModel });
  }
}
