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

    it("rate-limited result after modelUnavailable walk does not advance further: opus not marked dead, no walk to sonnet", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({
        fable: modelUnavailable(),
        opus: { success: false, output: "rate limited", exitCode: 1, rateLimited: true, modelUnavailable: false },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.rateLimited).toBe(true);
      expect(result.modelUnavailable).not.toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable", "opus"]);
      expect(avail.dead.has("fable")).toBe(true);
      expect(avail.dead.has("opus")).toBe(false);
    });

    it("ordinary failure (not modelUnavailable) is returned as-is with no walk to opus", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({
        fable: { success: false, output: "some ordinary error", exitCode: 1, modelUnavailable: undefined },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(false);
      expect(result.modelUnavailable).not.toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable"]);
      expect(avail.dead.has("fable")).toBe(false);
    });

    it("off-ladder configured model unavailable: falls to ladder's first live entry", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({
        "claude-fable-5-custom": modelUnavailable(),
        fable: { success: true, output: "done", exitCode: 0 },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "claude-fable-5-custom",
      });

      expect(result.success).toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["claude-fable-5-custom", "fable"]);
      expect(avail.dead.has("claude-fable-5-custom")).toBe(true);
      expect(avail.dead.has("fable")).toBe(false);
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

    it("all ladder models unavailable: returns last failure, no throw, one invoke per live model", async () => {
      const avail = new ModelAvailability(["fable", "opus", "sonnet"]);
      const { provider, invokeCalls } = fakeProvider({
        fable: modelUnavailable(),
        opus: modelUnavailable(),
        sonnet: modelUnavailable(),
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(false);
      expect(result.modelUnavailable).toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable", "opus", "sonnet"]);
      expect(avail.dead.has("fable")).toBe(true);
      expect(avail.dead.has("opus")).toBe(true);
      expect(avail.dead.has("sonnet")).toBe(true);
    });
  });

  describe("downgrade warnings", () => {
    it("reactive downgrade via invokeWithLadder emits exactly one warn line with configured, fallback, and reason", async () => {
      const warnLines: string[] = [];
      const avail = new ModelAvailability(["fable", "opus", "sonnet"], (line) => warnLines.push(line));
      const { provider } = fakeProvider({
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
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toContain("fable");
      expect(warnLines[0]).toContain("opus");
      expect(warnLines[0]).toMatch(/is not available/);
    });

    it("effectiveModel substitution on a pre-marked-dead model emits warn line with same three-field format", () => {
      const warnLines: string[] = [];
      const avail = new ModelAvailability(["fable", "opus", "sonnet"], (line) => warnLines.push(line));
      avail.markDead("fable");

      const result = avail.effectiveModel("fable");

      expect(result).toEqual({ model: "opus", downgraded: true });
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toContain("fable");
      expect(warnLines[0]).toContain("opus");
      expect(warnLines[0]).toMatch(/is not available/);
    });

    it("happy path with no downgrade emits zero warn lines", async () => {
      const warnLines: string[] = [];
      const avail = new ModelAvailability(["fable", "opus", "sonnet"], (line) => warnLines.push(line));
      const { provider } = fakeProvider({});

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(true);
      expect(warnLines).toHaveLength(0);
    });

    it("empty ladder with modelUnavailable returns failure unchanged, no warn, nothing marked dead, no walk", async () => {
      const warnLines: string[] = [];
      const avail = new ModelAvailability([], (line) => warnLines.push(line));
      const { provider, invokeCalls } = fakeProvider({
        fable: modelUnavailable(),
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.success).toBe(false);
      expect(result.modelUnavailable).toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable"]);
      expect(warnLines).toHaveLength(0);
      expect(avail.dead.has("fable")).toBe(false);
    });
  });
});
