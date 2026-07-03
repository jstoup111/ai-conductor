import { describe, it, expect, vi } from "vitest";
import { ModelAvailability, DEFAULT_MODEL_FALLBACK_LADDER } from "../../src/engine/model-availability";
import type { LLMProvider, InvokeOptions, InvokeResult } from "../../src/execution/llm-provider";

/** Records every invoke() call's requested model and returns canned results keyed by model. */
function fakeProvider(resultsByModel: Record<string, Partial<InvokeResult>>) {
  const invokeCalls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (opts: InvokeOptions): Promise<InvokeResult> => {
      invokeCalls.push(opts);
      const canned = (opts.model && resultsByModel[opts.model]) ?? { success: true, output: "done", exitCode: 0 };
      return { success: true, output: "", exitCode: 0, ...canned };
    }),
    invokeInteractive: vi.fn(async (): Promise<void> => {}),
  };
  return { provider, invokeCalls };
}

const modelUnavailable = (): Partial<InvokeResult> => ({
  success: false,
  output: "API Error: 404 not_found_error: model: bogus",
  exitCode: 1,
  modelUnavailable: true,
});

describe("ModelAvailability", () => {
  it("fresh instance returns configured model as effective with downgraded=false", () => {
    const avail = new ModelAvailability();
    const result = avail.effectiveModel("fable");
    expect(result).toEqual({ model: "fable", downgraded: false });
  });

  it("after markDead('fable'), effectiveModel('fable') falls back to first live ladder entry", () => {
    const avail = new ModelAvailability();
    avail.markDead("fable");
    const result = avail.effectiveModel("fable");
    expect(result).toEqual({ model: "opus", downgraded: true });
  });

  it("markDead('opus') does not affect full model-ID string (exact-string match)", () => {
    const avail = new ModelAvailability();
    avail.markDead("opus");
    const result = avail.effectiveModel("claude-opus-4-8");
    expect(result).toEqual({ model: "claude-opus-4-8", downgraded: false });
  });

  it("new instance re-allows all models (restart semantics)", () => {
    const avail1 = new ModelAvailability();
    avail1.markDead("fable");
    expect(avail1.effectiveModel("fable").downgraded).toBe(true);

    const avail2 = new ModelAvailability();
    expect(avail2.effectiveModel("fable")).toEqual({ model: "fable", downgraded: false });
  });

  it("exposes the default fallback ladder", () => {
    expect(DEFAULT_MODEL_FALLBACK_LADDER).toEqual(["fable", "opus", "sonnet"]);
  });

  describe("invokeWithLadder", () => {
    it("healthy configured model: exactly one invoke, success, no dead models", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({});

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(true);
      expect(invokeCalls).toHaveLength(1);
      expect(invokeCalls[0].model).toBe("fable");
      expect(avail.dead.has("fable")).toBe(false);
    });

    it("configured model unavailable: walks to next live ladder entry, marks it dead", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({
        fable: modelUnavailable(),
        opus: { success: true, output: "done", exitCode: 0 },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable", "opus"]);
      expect(avail.dead.has("fable")).toBe(true);
    });

    const ladder = DEFAULT_MODEL_FALLBACK_LADDER; // ["fable", "opus", "sonnet"]

    it.each(ladder.slice(0, -1).map((_, p) => p))(
      "walks the ladder to the first live model when positions 0..%d are unavailable",
      async (p) => {
        const avail = new ModelAvailability(ladder);
        const resultsByModel: Record<string, Partial<InvokeResult>> = {};
        for (let i = 0; i <= p; i++) {
          resultsByModel[ladder[i]] = modelUnavailable();
        }
        resultsByModel[ladder[p + 1]] = { success: true, output: "done", exitCode: 0 };
        const { provider, invokeCalls } = fakeProvider(resultsByModel);

        const result = await avail.invokeWithLadder(provider, {
          prompt: "hi",
          sessionId: "s1",
          resume: false,
          model: ladder[0],
        });

        expect(result.success).toBe(true);
        expect(invokeCalls.map((c) => c.model)).toEqual(ladder.slice(0, p + 2));
        expect(invokeCalls).toHaveLength(p + 2);
      }
    );
  });
});
