import { describe, it, expect } from "vitest";
import {
  makeVerdictOutcome,
  makeNoVerdictOutcome,
  makeSkippedOutcome,
  classifyOutcome,
  runWithConcurrency,
  runGroupBranch,
  type BranchOutcome,
  type GroupMember,
  type GroupResult,
} from "../../src/engine/group-core.js";
import type { StepRunResult, StepRunOptions } from "../../src/engine/conductor.js";
import type { StepName, ConductState } from "../../src/types/index.js";

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

describe("group-core: runGroupBranch (per-branch skill dispatch + fresh sessions)", () => {
  /** Minimal runner-spy: captures every (step, opts) call it receives. */
  function spyRunner(results: StepRunResult[]) {
    const calls: Array<{ step: StepName; opts?: StepRunOptions }> = [];
    let i = 0;
    return {
      // A "shared" session id field, mirroring DefaultStepRunner's private
      // this.sessionId — the branch executor must never mutate this.
      sharedSessionId: "SHARED-MAIN-SESSION",
      calls,
      run: async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
        calls.push({ step, opts });
        const result = results[i] ?? results.at(-1) ?? { success: true };
        i += 1;
        return result;
      },
    };
  }

  const fakeState = {} as ConductState;

  it("two members dispatch two invocations with their own step names and two distinct fresh session ids", async () => {
    const runnerA = spyRunner([{ success: true }]);
    const runnerB = spyRunner([{ success: true }]);

    const memberA: GroupMember = { name: "manual_test" as StepName as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };
    const memberB: GroupMember = { name: "prd_audit" as StepName as unknown as string, skill: "prd-audit", outcome: makeSkippedOutcome() };

    await runGroupBranch(memberA, fakeState, { stepRunner: runnerA }, 3);
    await runGroupBranch(memberB, fakeState, { stepRunner: runnerB }, 3);

    expect(runnerA.calls).toHaveLength(1);
    expect(runnerB.calls).toHaveLength(1);
    expect(runnerA.calls[0]!.step).toBe("manual_test");
    expect(runnerB.calls[0]!.step).toBe("prd_audit");

    const sessionA = runnerA.calls[0]!.opts?.sessionId;
    const sessionB = runnerB.calls[0]!.opts?.sessionId;
    expect(sessionA).toBeTruthy();
    expect(sessionB).toBeTruthy();
    expect(sessionA).not.toBe(sessionB);

    // First attempt is always a fresh, non-resumed session.
    expect(runnerA.calls[0]!.opts?.resume).toBe(false);
    expect(runnerB.calls[0]!.opts?.resume).toBe(false);
  });

  it("a branch retry reuses ITS session id (resume:true on retry, not a new session)", async () => {
    const runner = spyRunner([
      { success: false, output: "transient failure" },
      { success: true },
    ]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 3);

    expect(runner.calls).toHaveLength(2);
    const firstSessionId = runner.calls[0]!.opts?.sessionId;
    const secondSessionId = runner.calls[1]!.opts?.sessionId;
    expect(firstSessionId).toBeTruthy();
    expect(secondSessionId).toBe(firstSessionId);
    expect(runner.calls[0]!.opts?.resume).toBe(false);
    expect(runner.calls[1]!.opts?.resume).toBe(true);
    expect(classifyOutcome(outcome)).toBe("verdict:pass");
  });

  it("the shared runner session id is unchanged after a group run", async () => {
    const runner = spyRunner([{ success: true }]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    await runGroupBranch(member, fakeState, { stepRunner: runner }, 3);

    expect(runner.sharedSessionId).toBe("SHARED-MAIN-SESSION");
  });

  it("exhausting max_retries without success returns a no-verdict outcome", async () => {
    const runner = spyRunner([
      { success: false, output: "fail 1" },
      { success: false, output: "fail 2" },
    ]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 2);

    expect(runner.calls).toHaveLength(2);
    expect(classifyOutcome(outcome)).toBe("no-verdict");
  });
});

describe("group-core: runGroupBranch rate-limit pass-through into shared episode", () => {
  /** Minimal runner-spy: captures every (step, opts) call it receives. */
  function spyRunner(results: StepRunResult[]) {
    const calls: Array<{ step: StepName; opts?: StepRunOptions }> = [];
    let i = 0;
    return {
      calls,
      run: async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
        calls.push({ step, opts });
        const result = results[i] ?? results.at(-1) ?? { success: true };
        i += 1;
        return result;
      },
    };
  }

  /** Fake shared rate-limit episode — spies on enter()/clear() calls. */
  function fakeEpisode() {
    const enterCalls: number[] = [];
    let clearCalls = 0;
    let latestDeadline: number | null = null;
    return {
      enterCalls,
      get clearCalls() {
        return clearCalls;
      },
      get latestDeadline() {
        return latestDeadline;
      },
      enter: (untilMs: number) => {
        enterCalls.push(untilMs);
        if (latestDeadline === null || untilMs > latestDeadline) {
          latestDeadline = untilMs;
        }
      },
      active: (nowMs?: number) => {
        const now = nowMs ?? Date.now();
        return latestDeadline !== null && now < latestDeadline;
      },
      clear: async (_signal?: AbortSignal) => {
        clearCalls += 1;
      },
      nextWaitSeconds: (_baseSeconds?: number) => 60,
    };
  }

  const fakeState = {} as ConductState;

  it("a rate-limited result calls episode.enter(deadline), awaits episode.clear(), and does NOT burn retry budget", async () => {
    const deadline = Date.now() + 60_000;
    const runner = spyRunner([
      { success: false, rateLimited: true, deadline },
      { success: true },
    ]);
    const episode = fakeEpisode();
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(
      member,
      fakeState,
      { stepRunner: runner, rateLimitEpisode: episode },
      2,
    );

    // Two run() invocations happened (the rate-limited one + the retry that
    // succeeds), but only ONE counts against the retry budget of 2 — the
    // rate-limited cycle must not consume an attempt. Since it succeeded on
    // the very next call, the branch outcome is a pass.
    expect(runner.calls).toHaveLength(2);
    expect(classifyOutcome(outcome)).toBe("verdict:pass");

    expect(episode.enterCalls).toEqual([deadline]);
    expect(episode.clearCalls).toBe(1);
  });

  it("a rate-limited branch that never gets an extra attempt beyond max_retries still isn't charged for the rate-limit cycle", async () => {
    // maxRetries=1: a single real attempt is allowed. The FIRST call is
    // rate-limited (not a real attempt), so the branch gets exactly one
    // real attempt after that — which fails — producing no-verdict, not
    // an outcome starved by the rate-limit cycle counting against budget.
    const runner = spyRunner([
      { success: false, rateLimited: true, deadline: Date.now() + 1000 },
      { success: false, output: "real failure" },
    ]);
    const episode = fakeEpisode();
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(
      member,
      fakeState,
      { stepRunner: runner, rateLimitEpisode: episode },
      1,
    );

    expect(runner.calls).toHaveLength(2);
    expect(classifyOutcome(outcome)).toBe("no-verdict");
    expect(episode.clearCalls).toBe(1);
  });

  it("two branches hitting rate limits concurrently share ONE episode, with the later deadline winning (extension)", async () => {
    const earlierDeadline = Date.now() + 30_000;
    const laterDeadline = Date.now() + 90_000;

    const runnerA = spyRunner([
      { success: false, rateLimited: true, deadline: earlierDeadline },
      { success: true },
    ]);
    const runnerB = spyRunner([
      { success: false, rateLimited: true, deadline: laterDeadline },
      { success: true },
    ]);
    const episode = fakeEpisode();

    const memberA: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };
    const memberB: GroupMember = { name: "prd_audit" as unknown as string, skill: "prd-audit", outcome: makeSkippedOutcome() };

    await Promise.all([
      runGroupBranch(memberA, fakeState, { stepRunner: runnerA, rateLimitEpisode: episode }, 2),
      runGroupBranch(memberB, fakeState, { stepRunner: runnerB, rateLimitEpisode: episode }, 2),
    ]);

    // Both branches fed their deadlines into the SAME shared episode instance.
    expect(episode.enterCalls).toContain(earlierDeadline);
    expect(episode.enterCalls).toContain(laterDeadline);
    // The episode reflects the extended (later) deadline — later-deadline-wins.
    expect(episode.latestDeadline).toBe(laterDeadline);
  });

  it("without a rateLimitEpisode dep, a rate-limited result still retries without burning budget (falls back gracefully)", async () => {
    const runner = spyRunner([
      { success: false, rateLimited: true, deadline: Date.now() + 10 },
      { success: true },
    ]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 1);

    expect(runner.calls).toHaveLength(2);
    expect(classifyOutcome(outcome)).toBe("verdict:pass");
  });
});
