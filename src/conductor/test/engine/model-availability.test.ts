import { describe, it, expect, vi } from "vitest";
import { ModelAvailability, DEFAULT_MODEL_FALLBACK_LADDER } from "../../src/engine/model-availability";
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from "../../src/engine/provider-model-policy.js";
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

const claudeLadder = CLAUDE_MODEL_POLICY.modelFallbackLadder;
const codexLadder = CODEX_MODEL_POLICY.modelFallbackLadder;

describe("ModelAvailability", () => {
  it("fresh instance returns configured model as effective with downgraded=false", () => {
    const avail = new ModelAvailability(claudeLadder);
    const result = avail.effectiveModel("fable");
    expect(result).toEqual({ model: "fable", downgraded: false });
  });

  it("after markDead('fable'), effectiveModel('fable') falls back to first live ladder entry", () => {
    const avail = new ModelAvailability(claudeLadder);
    avail.markDead("fable");
    const result = avail.effectiveModel("fable");
    expect(result).toEqual({ model: "opus", downgraded: true });
  });

  it("markDead('opus') does not affect full model-ID string (exact-string match)", () => {
    const avail = new ModelAvailability(claudeLadder);
    avail.markDead("opus");
    const result = avail.effectiveModel("claude-opus-4-8");
    expect(result).toEqual({ model: "claude-opus-4-8", downgraded: false });
  });

  it("new instance re-allows all models (restart semantics)", () => {
    const avail1 = new ModelAvailability(claudeLadder);
    avail1.markDead("fable");
    expect(avail1.effectiveModel("fable").downgraded).toBe(true);

    const avail2 = new ModelAvailability(claudeLadder);
    expect(avail2.effectiveModel("fable")).toEqual({ model: "fable", downgraded: false });
  });

  it("exposes the default fallback ladder", () => {
    expect(DEFAULT_MODEL_FALLBACK_LADDER).toBe(CLAUDE_MODEL_POLICY.modelFallbackLadder);
  });

  describe("invokeWithLadder", () => {
    it.each([
      {
        startingRung: "Sol",
        start: codexLadder[0],
        unavailable: codexLadder.slice(0, 2),
        expected: codexLadder,
      },
      {
        startingRung: "Terra",
        start: codexLadder[1],
        unavailable: codexLadder.slice(1, 2),
        expected: codexLadder.slice(1),
      },
      {
        startingRung: "Luna",
        start: codexLadder[2],
        unavailable: codexLadder.slice(2),
        expected: codexLadder.slice(2),
      },
    ])(
      "Codex starts at $startingRung and walks only the remaining provider-native rungs",
      async ({ start, unavailable, expected }) => {
        const avail = new ModelAvailability(codexLadder);
        const { provider, invokeCalls } = fakeProvider(
          Object.fromEntries(unavailable.map((model) => [model, modelUnavailable()])),
        );

        await avail.invokeWithLadder(provider, {
          prompt: "hi",
          sessionId: "s1",
          resume: false,
          model: start,
        });

        expect(invokeCalls.map((c) => c.model)).toEqual(expected);
      },
    );

    it("Codex full exhaustion stops after Luna and returns its unavailable result", async () => {
      const avail = new ModelAvailability(codexLadder);
      const { provider, invokeCalls } = fakeProvider(
        Object.fromEntries(codexLadder.map((model) => [model, modelUnavailable()])),
      );

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: codexLadder[0],
      });

      expect({
        success: result.success,
        modelUnavailable: result.modelUnavailable,
        invokedModels: invokeCalls.map((c) => c.model),
      }).toEqual({
        success: false,
        modelUnavailable: true,
        invokedModels: codexLadder,
      });
    });

    it("Codex skips a dead Terra rung while walking from unavailable Sol to Luna", async () => {
      const avail = new ModelAvailability(codexLadder);
      avail.markDead(codexLadder[1]);
      const { provider, invokeCalls } = fakeProvider({
        [codexLadder[0]]: modelUnavailable(),
      });

      await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: codexLadder[0],
      });

      expect(invokeCalls.map((c) => c.model)).toEqual([codexLadder[0], codexLadder[2]]);
    });

    it("healthy configured model: exactly one invoke, success, no dead models", async () => {
      const avail = new ModelAvailability(claudeLadder);
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
      const avail = new ModelAvailability(claudeLadder);
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

    it("configured model returns rateLimited immediately: no ladder walk, result propagated", async () => {
      const avail = new ModelAvailability(claudeLadder);
      const { provider, invokeCalls } = fakeProvider({
        fable: { success: false, output: "rate limited", exitCode: 1, rateLimited: true, modelUnavailable: false },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      expect(result.rateLimited).toBe(true);
      expect(result.modelUnavailable).not.toBe(true);
      expect(invokeCalls.map((c) => c.model)).toEqual(["fable"]);
      expect(avail.dead.has("fable")).toBe(false);
      expect(avail.dead.has("opus")).toBe(false);
    });

    it("rate-limited result after modelUnavailable walk does not advance further: opus not marked dead, no walk to sonnet", async () => {
      const avail = new ModelAvailability(claudeLadder);
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
      const avail = new ModelAvailability(claudeLadder);
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
      const avail = new ModelAvailability(claudeLadder);
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

    const ladder = claudeLadder;

    it.each(ladder.slice(0, -1).map((_, p) => p))(
      "Claude walks Fable/Opus/Sonnet to the first live model when positions 0..%d are unavailable",
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
      const avail = new ModelAvailability(claudeLadder);
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
      const avail = new ModelAvailability(claudeLadder, (line) => warnLines.push(line));
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
      const avail = new ModelAvailability(claudeLadder, (line) => warnLines.push(line));
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
      const avail = new ModelAvailability(claudeLadder, (line) => warnLines.push(line));
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

    it("auth failure never poisons the ladder: dead set byte-identical, no advance, one invoke", async () => {
      const avail = new ModelAvailability(claudeLadder);
      const deadSetBefore = new Set(avail.dead);
      const { provider, invokeCalls } = fakeProvider({
        // Simulate a result with both authFailure and modelUnavailable set:
        // the auth check must prevent marking the model dead, even if
        // modelUnavailable is also true.
        fable: {
          success: false,
          output: "Not logged in",
          exitCode: 1,
          authFailure: true,
          modelUnavailable: true,
        },
      });

      const result = await avail.invokeWithLadder(provider, {
        prompt: "hi",
        sessionId: "s1",
        resume: false,
        model: "fable",
      });

      // Verify auth failure is propagated
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
      // Verify no ladder walk occurred (only one invoke)
      expect(invokeCalls).toHaveLength(1);
      expect(invokeCalls[0].model).toBe("fable");
      // Verify dead set is unchanged (byte-identical)
      expect(avail.dead.size).toBe(deadSetBefore.size);
      expect(avail.dead.has("fable")).toBe(false);
      expect(avail.dead.has("opus")).toBe(false);
      expect(avail.dead.has("sonnet")).toBe(false);
    });
  });
});
