import { describe, it, expect } from "vitest";
import {
  makeVerdictOutcome,
  makeNoVerdictOutcome,
  makeSkippedOutcome,
  classifyOutcome,
  runWithConcurrency,
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

describe("group-core: runWithConcurrency (capped fan-out semaphore)", () => {
  /** Deferred helper so tests can control exactly when a thunk resolves. */
  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("cap 2 with 3 thunks: the 3rd does not start until one of the first two completes", async () => {
    const started: string[] = [];
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    const thunk1 = () => {
      started.push("a");
      return d1.promise;
    };
    const thunk2 = () => {
      started.push("b");
      return d2.promise;
    };
    const thunk3 = () => {
      started.push("c");
      return d3.promise;
    };

    const resultPromise = runWithConcurrency([thunk1, thunk2, thunk3], 2);

    // Let the microtask queue flush so the semaphore has a chance to launch
    // as many thunks as its cap permits.
    await Promise.resolve();
    await Promise.resolve();

    // Cap is 2: only the first two thunks should have started; the 3rd is
    // queued behind the semaphore.
    expect(started).toEqual(["a", "b"]);

    // Completing one of the first two frees a slot for the 3rd to start.
    d1.resolve("a-done");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(["a", "b", "c"]);

    d2.resolve("b-done");
    d3.resolve("c-done");

    const results = await resultPromise;
    expect(results).toEqual(["a-done", "b-done", "c-done"]);
  });

  it("cap 1: execution is strictly sequential", async () => {
    const events: string[] = [];

    const makeThunk = (label: string, delayMs: number) => async () => {
      events.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`end:${label}`);
      return label;
    };

    const results = await runWithConcurrency(
      [makeThunk("a", 10), makeThunk("b", 5), makeThunk("c", 1)],
      1,
    );

    expect(events).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("results are returned in input order regardless of completion order", async () => {
    const makeThunk = (label: string, delayMs: number) => () =>
      new Promise<string>((resolve) => setTimeout(() => resolve(label), delayMs));

    // "b" finishes fastest, then "c", then "a" — but results must still
    // line up with the original thunk order.
    const results = await runWithConcurrency(
      [makeThunk("a", 30), makeThunk("b", 5), makeThunk("c", 15)],
      3,
    );

    expect(results).toEqual(["a", "b", "c"]);
  });

  it("propagates a thunk rejection while still running other thunks to completion", async () => {
    const makeThunk = (label: string, delayMs: number, shouldFail = false) => () =>
      new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          if (shouldFail) {
            reject(new Error(`${label} failed`));
          } else {
            resolve(label);
          }
        }, delayMs);
      });

    await expect(
      runWithConcurrency([makeThunk("a", 5), makeThunk("b", 1, true), makeThunk("c", 5)], 3),
    ).rejects.toThrow("b failed");
  });
});
