import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { mkdtemp, writeFile, mkdir, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("group-core: runGroupBranch authFailure / sessionExpired parity", () => {
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

  const fakeState = {} as ConductState;

  it("an authFailure result does NOT burn retry budget and classifies as no-verdict with reason 'authFailure'", async () => {
    // maxRetries=1 means a single real attempt is allowed. The branch must
    // not loop/retry an authFailure automatically (that's core/join's job
    // in a later task) — it surfaces immediately as no-verdict:authFailure
    // after exactly one call.
    const runner = spyRunner([{ success: false, authFailure: true, output: "401 unauthorized" }]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 3);

    expect(runner.calls).toHaveLength(1);
    expect(outcome).toEqual({ kind: "no-verdict", reason: "authFailure" });
  });

  it("a sessionExpired result re-mints a fresh session id and retries with resume:false, without burning retry budget", async () => {
    const runner = spyRunner([
      { success: false, sessionExpired: true },
      { success: true },
    ]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    let mintCount = 0;
    const mintSessionId = () => {
      mintCount += 1;
      return `SESSION-${mintCount}`;
    };

    // maxRetries=1: only one real attempt is allowed. The sessionExpired
    // cycle must not count against it, so the branch still succeeds on
    // its retry.
    const outcome = await runGroupBranch(
      member,
      fakeState,
      { stepRunner: runner, mintSessionId },
      1,
    );

    expect(runner.calls).toHaveLength(2);
    expect(classifyOutcome(outcome)).toBe("verdict:pass");

    // First call uses the freshly minted session, not resumed.
    expect(runner.calls[0]!.opts?.sessionId).toBe("SESSION-1");
    expect(runner.calls[0]!.opts?.resume).toBe(false);

    // After sessionExpired, a NEW session is minted (not the expired one
    // resumed) and dispatched fresh (resume:false), not resume:true.
    expect(runner.calls[1]!.opts?.sessionId).toBe("SESSION-2");
    expect(runner.calls[1]!.opts?.resume).toBe(false);
  });
});

describe("group-core: abort/SIGINT persistence for in-flight branches (Task 8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Prove no orphaned timers survive an aborted run.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

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

  /**
   * A rate-limit episode fake that models a real timer-based wait: `clear`
   * schedules a `setTimeout` for the deadline and resolves early (clearing
   * the timer) if the passed signal aborts first.
   */
  function timedEpisode() {
    let latestDeadline: number | null = null;
    return {
      enter: (untilMs: number) => {
        if (latestDeadline === null || untilMs > latestDeadline) {
          latestDeadline = untilMs;
        }
      },
      clear: (signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          const waitMs = Math.max(0, (latestDeadline ?? Date.now()) - Date.now());
          const timer = setTimeout(() => resolve(), waitMs);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              resolve();
            };
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }
        }),
    };
  }

  const fakeState = {} as ConductState;

  it("aborting during the rate-limit episode wait exits the branch cleanly with a recorded no-verdict outcome", async () => {
    const controller = new AbortController();
    const runner = spyRunner([
      { success: false, rateLimited: true, deadline: Date.now() + 60_000 },
    ]);
    const episode = timedEpisode();
    const member: GroupMember = {
      name: "manual_test" as unknown as string,
      skill: "manual-test",
      outcome: makeSkippedOutcome(),
    };

    const outcomePromise = runGroupBranch(
      member,
      fakeState,
      { stepRunner: runner, rateLimitEpisode: episode, signal: controller.signal },
      3,
    );

    // Let the branch reach the rate-limited episode wait (setTimeout armed).
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    const outcome = await outcomePromise;

    expect(classifyOutcome(outcome)).toBe("no-verdict");
    expect(outcome).toEqual({ kind: "no-verdict", reason: "aborted" });
    // Only the single rate-limited call happened — the branch never issued
    // a second dispatch after the abort.
    expect(runner.calls).toHaveLength(1);
  });

  it("aborting mid-group (via runWithConcurrency) returns outcomes collected so far, not thrown-away work", async () => {
    const controller = new AbortController();

    // Branch A finishes immediately (before abort). Branch B is rate-limited
    // and gets cut short by the abort. Branch C never starts (cap=2).
    const runnerA = spyRunner([{ success: true }]);
    const runnerB = spyRunner([
      { success: false, rateLimited: true, deadline: Date.now() + 60_000 },
    ]);
    const runnerC = spyRunner([{ success: true }]);
    const episode = timedEpisode();

    const memberA: GroupMember = { name: "a" as unknown as string, skill: "a", outcome: makeSkippedOutcome() };
    const memberB: GroupMember = { name: "b" as unknown as string, skill: "b", outcome: makeSkippedOutcome() };
    const memberC: GroupMember = { name: "c" as unknown as string, skill: "c", outcome: makeSkippedOutcome() };

    const thunkA = () =>
      runGroupBranch(memberA, fakeState, { stepRunner: runnerA, signal: controller.signal }, 3);
    const thunkB = () =>
      runGroupBranch(
        memberB,
        fakeState,
        { stepRunner: runnerB, rateLimitEpisode: episode, signal: controller.signal },
        3,
      );
    const thunkC = () =>
      runGroupBranch(memberC, fakeState, { stepRunner: runnerC, signal: controller.signal }, 3);

    // Cap of 1: strictly sequential, so C cannot start until B settles —
    // and B never settles before the abort cuts it short.
    const groupPromise = runWithConcurrency([thunkA, thunkB, thunkC], 1, controller.signal);

    // Let A resolve (frees the single slot) and B reach its timed
    // rate-limit wait (setTimeout armed).
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    const outcomes = await groupPromise;

    // C never started (cap=1, abort stopped further launches once B was
    // in flight), so only A's completed outcome is present — completed
    // work (A) is preserved, not thrown away.
    expect(outcomes.length).toBeLessThan(3);
    expect(outcomes.some((o) => classifyOutcome(o) === "verdict:pass")).toBe(true);
    expect(runnerC.calls).toHaveLength(0);
  });
});

describe("group-core: runGroupBranch per-branch stale-sweep isolation (Task 9)", () => {
  /** Minimal runner-stub: always succeeds on first dispatch. */
  function okRunner() {
    return {
      run: async (_step: StepName, _state: ConductState, _opts?: StepRunOptions) => ({ success: true }),
    };
  }

  it("sweeps ONLY the stale member's own marker, leaving the other member's fresh marker untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "group-core-sweep-"));
    await mkdir(join(dir, ".pipeline"), { recursive: true });

    const sessionStartedAt = Date.now();

    // Member A's marker (manual_test) predates this session — stale.
    const staleMarker = join(dir, ".pipeline", "manual-test-results.md");
    await writeFile(staleMarker, "stale content from a crashed prior run");
    await utimes(staleMarker, new Date(sessionStartedAt - 60_000), new Date(sessionStartedAt - 60_000));

    // Member B's marker (prd_audit) is fresh — written THIS session.
    const freshMarker = join(dir, ".pipeline", "prd-audit.md");
    await writeFile(freshMarker, "fresh content from this session");
    await utimes(freshMarker, new Date(sessionStartedAt + 60_000), new Date(sessionStartedAt + 60_000));

    const memberA: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };
    const memberB: GroupMember = { name: "prd_audit" as unknown as string, skill: "prd-audit", outcome: makeSkippedOutcome() };

    await runGroupBranch(
      memberA,
      {} as ConductState,
      { stepRunner: okRunner(), projectRoot: dir, sessionStartedAt },
      3,
    );
    await runGroupBranch(
      memberB,
      {} as ConductState,
      { stepRunner: okRunner(), projectRoot: dir, sessionStartedAt },
      3,
    );

    // A's stale marker was swept before dispatch.
    await expect(stat(staleMarker)).rejects.toThrow();

    // B's fresh marker survived untouched.
    const freshStat = await stat(freshMarker);
    expect(freshStat).toBeTruthy();
  });
});
