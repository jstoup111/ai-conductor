import { describe, it, expect } from "vitest";
import { ModelAvailability, DEFAULT_MODEL_FALLBACK_LADDER } from "../../src/engine/model-availability";

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
});
