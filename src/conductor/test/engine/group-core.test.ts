import { describe, it, expect } from "vitest";
import {
  makeVerdictOutcome,
  makeNoVerdictOutcome,
  makeSkippedOutcome,
  classifyOutcome,
  type BranchOutcome,
  type GroupMember,
  type GroupResult,
} from "../../src/engine/group-core.js";

describe("group-core: BranchOutcome constructors", () => {
  it("makeVerdictOutcome builds a kind:'verdict' outcome carrying pass/fail/blocked", () => {
    const pass = makeVerdictOutcome("pass");
    expect(pass).toEqual({ kind: "verdict", verdict: "pass" });

    const fail = makeVerdictOutcome("fail");
    expect(fail).toEqual({ kind: "verdict", verdict: "fail" });

    const blocked = makeVerdictOutcome("blocked");
    expect(blocked).toEqual({ kind: "verdict", verdict: "blocked" });
  });

  it("makeNoVerdictOutcome builds a kind:'no-verdict' outcome carrying a reason", () => {
    const outcome = makeNoVerdictOutcome("retries exhausted");
    expect(outcome).toEqual({ kind: "no-verdict", reason: "retries exhausted" });
  });

  it("makeSkippedOutcome builds a kind:'skipped' outcome", () => {
    const outcome = makeSkippedOutcome();
    expect(outcome).toEqual({ kind: "skipped" });
  });

  it("skipped is not the same outcome kind as no-verdict (skipped != no-verdict)", () => {
    const skipped = makeSkippedOutcome();
    const noVerdict = makeNoVerdictOutcome("timed out");
    expect(skipped.kind).not.toBe(noVerdict.kind);
    expect(skipped.kind).toBe("skipped");
    expect(noVerdict.kind).toBe("no-verdict");
  });
});

describe("group-core: exhaustive classify helper", () => {
  it("classifies a verdict outcome by its verdict value", () => {
    expect(classifyOutcome(makeVerdictOutcome("pass"))).toBe("verdict:pass");
    expect(classifyOutcome(makeVerdictOutcome("fail"))).toBe("verdict:fail");
    expect(classifyOutcome(makeVerdictOutcome("blocked"))).toBe("verdict:blocked");
  });

  it("classifies a no-verdict outcome", () => {
    expect(classifyOutcome(makeNoVerdictOutcome("infra error"))).toBe("no-verdict");
  });

  it("classifies a skipped outcome distinctly from no-verdict", () => {
    expect(classifyOutcome(makeSkippedOutcome())).toBe("skipped");
  });

  it("exhausts every BranchOutcome kind without a default branch (compile-time exhaustiveness)", () => {
    // This test exercises the runtime behavior of classifyOutcome for every
    // variant of the discriminated union. The implementation of
    // classifyOutcome MUST use a switch with no `default:` clause so that
    // adding a new BranchOutcome kind without updating classifyOutcome is a
    // compile error, not a silent runtime fallthrough.
    const outcomes: BranchOutcome[] = [
      makeVerdictOutcome("pass"),
      makeVerdictOutcome("fail"),
      makeVerdictOutcome("blocked"),
      makeNoVerdictOutcome("reason"),
      makeSkippedOutcome(),
    ];
    for (const outcome of outcomes) {
      expect(() => classifyOutcome(outcome)).not.toThrow();
    }
  });
});

describe("group-core: GroupMember and GroupResult shapes", () => {
  it("accepts a GroupMember with name, skill, and outcome", () => {
    const member: GroupMember = {
      name: "manual_test",
      skill: "manual-test",
      outcome: makeVerdictOutcome("pass"),
    };
    expect(member.outcome.kind).toBe("verdict");
  });

  it("accepts a GroupResult aggregating members", () => {
    const result: GroupResult = {
      members: [
        { name: "manual_test", skill: "manual-test", outcome: makeVerdictOutcome("pass") },
        { name: "prd_audit", skill: "prd-audit", outcome: makeSkippedOutcome() },
      ],
    };
    expect(result.members).toHaveLength(2);
  });
});
