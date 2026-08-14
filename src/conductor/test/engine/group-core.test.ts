import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";
import {
  makeVerdictOutcome,
  makeNoVerdictOutcome,
  makeSkippedOutcome,
  classifyOutcome,
  runWithConcurrency,
  runGroupBranch,
  runNativeGroupBranch,
  runAuxiliaryGroupBranch,
  runAuxiliaryGroupBranches,
  type BranchOutcome,
  type GroupMember,
  type GroupMemberStepEvent,
  type GroupResult,
  type NativeBranchExecutorDeps,
} from "../../src/engine/group-core.js";
import type { StepRunResult, StepRunOptions } from "../../src/engine/conductor.js";
import type { StepName, ConductState } from "../../src/types/index.js";
import type { BuildReviewRubricResult } from "../../src/engine/build-review-domain.js";
import type { ResolvedBuildReviewRubricPolicy } from "../../src/engine/resolved-config.js";
import { mkdtemp, writeFile, mkdir, stat, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { DefaultStepRunner } from "../../src/engine/step-runners.js";
import { ProviderRuntimeSet } from "../../src/engine/provider-runtime.js";
import { executeProviderCandidates } from "../../src/engine/provider-execution.js";
import { ProviderSessionStore } from "../../src/engine/provider-session.js";
import { ModelAvailability } from "../../src/engine/model-availability.js";
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from "../../src/engine/provider-model-policy.js";
import { SessionManager } from "../../src/execution/session.js";
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from "../../src/execution/llm-provider.js";

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

describe("group-core: runNativeGroupBranch", () => {
  it("accepts only an injected executor and member-event dependency", () => {
    expectTypeOf<Parameters<typeof runNativeGroupBranch>[1]>().toEqualTypeOf<
      () => Promise<StepRunResult>
    >();
    expectTypeOf<NativeBranchExecutorDeps>().toEqualTypeOf<{
      onMemberEvent?: (event: GroupMemberStepEvent) => void | Promise<void>;
    }>();
  });

  it("maps injected native results into ordered member-attributed outcomes", async () => {
    const events: Array<Pick<GroupMemberStepEvent, "member" | "phase" | "outcome">> = [];
    const members: GroupMember[] = [
      { name: "wiring_check", skill: "", outcome: makeSkippedOutcome() },
      { name: "test_suite", skill: "", outcome: makeSkippedOutcome() },
    ];

    const outcomes = await runWithConcurrency(
      [
        () => runNativeGroupBranch(members[0]!, async () => ({ success: true }), {
          onMemberEvent: ({ member, phase, outcome }) => {
            events.push({ member, phase, outcome });
          },
        }),
        () => runNativeGroupBranch(members[1]!, async () => ({ success: false, output: "suite failed" }), {
          onMemberEvent: ({ member, phase, outcome }) => {
            events.push({ member, phase, outcome });
          },
        }),
      ],
      2,
    );

    expect({ outcomes, events }).toEqual({
      outcomes: [
        { kind: "verdict", verdict: "pass" },
        { kind: "no-verdict", reason: "suite failed" },
      ],
      events: [
        { member: "wiring_check", phase: "dispatch" },
        { member: "test_suite", phase: "dispatch" },
        { member: "wiring_check", phase: "result", outcome: "verdict:pass" },
        { member: "test_suite", phase: "result", outcome: "no-verdict" },
      ],
    });
  });

  it("maps a throwing native executor to no-verdict after started sibling work settles", async () => {
    let settleSibling!: (value: string) => void;
    const sibling = new Promise<string>((resolve) => {
      settleSibling = resolve;
    });
    let siblingSettled = false;
    const members: GroupMember[] = [
      { name: "wiring_check", skill: "", outcome: makeSkippedOutcome() },
      { name: "test_suite", skill: "", outcome: makeSkippedOutcome() },
    ];
    const events: Array<Pick<GroupMemberStepEvent, "member" | "phase" | "outcome">> = [];

    const groupPromise = runWithConcurrency(
      [
        () => runNativeGroupBranch(members[0]!, async () => {
          throw new Error("wiring crashed");
        }, {
          onMemberEvent: ({ member, phase, outcome }) => {
            events.push({ member, phase, outcome });
          },
        }),
        async () => {
          const result = await sibling;
          siblingSettled = true;
          return runNativeGroupBranch(members[1]!, async () => ({ success: true, output: result }));
        },
      ],
      2,
    );

    await Promise.resolve();
    settleSibling("suite settled");
    const outcomes = await groupPromise;

    expect({ outcomes, siblingSettled, events }).toEqual({
      outcomes: [
        { kind: "no-verdict", reason: "wiring crashed" },
        { kind: "verdict", verdict: "pass" },
      ],
      siblingSettled: true,
      events: [
        { member: "wiring_check", phase: "dispatch" },
        { member: "wiring_check", phase: "result", outcome: "no-verdict" },
      ],
    });
  });
});

describe("group-core: runAuxiliaryGroupBranch", () => {
  it("dispatches string member IDs through typed policy and outcome callbacks without lifecycle state", async () => {
    const policy: ResolvedBuildReviewRubricPolicy = {
      enabled: true,
      llm_provider: "claude",
      model: "sonnet",
      effort: "medium",
      model_fallback_ladder: ["sonnet"],
      max_retries: 2,
      escalate: false,
    };
    const outcome: BuildReviewRubricResult = {
      kind: "skipped",
      rubric: "tautology",
      reason: "disabled",
    };
    const execute = vi.fn(async (
      memberId: "tautology",
      receivedPolicy: ResolvedBuildReviewRubricPolicy,
    ): Promise<BuildReviewRubricResult> => {
      expect(memberId).toBe("tautology");
      expect(receivedPolicy).toBe(policy);
      return outcome;
    });

    await expect(runAuxiliaryGroupBranch("tautology", policy, execute)).resolves.toBe(outcome);
    expect(execute).toHaveBeenCalledWith("tautology", policy);
  });

  it("caps auxiliary fan-out while preserving each member's policy and attributed outcome", async () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const first = deferred<BuildReviewRubricResult>();
    const second = deferred<BuildReviewRubricResult>();
    const third = deferred<BuildReviewRubricResult>();
    const thirdStarted = deferred<void>();
    const started: string[] = [];
    const policies: Record<"tautology" | "scope" | "rootCause", ResolvedBuildReviewRubricPolicy> = {
      tautology: { enabled: true, llm_provider: "claude", model: "sonnet", effort: "medium", model_fallback_ladder: ["sonnet", "opus"], max_retries: 2, escalate: false },
      scope: { enabled: true, llm_provider: "codex", model: "gpt-5.6-terra", effort: "high", model_fallback_ladder: ["gpt-5.6-terra"], max_retries: 3, escalate: true },
      rootCause: { enabled: true, llm_provider: "claude", model: "opus", effort: "xhigh", model_fallback_ladder: ["opus"], max_retries: 1, escalate: true },
    };
    const pending = { tautology: first, scope: second, rootCause: third };

    const outcomesPromise = runAuxiliaryGroupBranches(
      Object.entries(policies).map(([memberId, policy]) => ({ memberId, policy })),
      2,
      async (memberId, policy) => {
        started.push(memberId);
        expect(policy).toBe(policies[memberId as keyof typeof policies]);
        if (memberId === "rootCause") thirdStarted.resolve();
        return pending[memberId as keyof typeof pending].promise;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["tautology", "scope"]);

    first.resolve({ kind: "skipped", rubric: "tautology", reason: "disabled" });
    await thirdStarted.promise;
    expect(started).toEqual(["tautology", "scope", "rootCause"]);

    second.resolve({ kind: "infrastructure-failure", rubric: "scope", reason: "retry-exhausted", detail: "codex exhausted" });
    third.resolve({ kind: "judged", rubric: "rootCause", lapId: "lap-1" as never, snapshotDigest: "digest", contractVersion: "v1" as never, findings: [], verdict: "PASS" });

    await expect(outcomesPromise).resolves.toEqual([
      { kind: "skipped", rubric: "tautology", reason: "disabled" },
      { kind: "infrastructure-failure", rubric: "scope", reason: "retry-exhausted", detail: "codex exhausted" },
      { kind: "judged", rubric: "rootCause", lapId: "lap-1", snapshotDigest: "digest", contractVersion: "v1", findings: [], verdict: "PASS" },
    ]);
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

  it("cold-starts a provider-session branch retry without changing the serial session", async () => {
    const providerExecutor = vi.fn(executeProviderCandidates);
    const invokeInteractive = vi
      .fn<LLMProvider["invokeInteractive"]>()
      .mockResolvedValueOnce({ success: false, output: "retry", exitCode: 1 })
      .mockResolvedValueOnce({ success: true, output: "passed", exitCode: 0 });
    const provider: LLMProvider = {
      supportsSessionResume: true,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(),
      invokeInteractive: vi.fn(async (options: InvokeOptions) => {
        const permit = options.spawnPermit?.();
        if (permit && !permit.permitted) {
          throw new Error(`provider spawn denied: ${permit.reason}`);
        }
        return invokeInteractive(options);
      }),
    };
    const sessionIds = ["manual-claude-attempt-1", "manual-claude-attempt-2"];
    const sessions = new ProviderSessionStore({
      createSessionId: () => sessionIds.shift()!,
    });
    const runner = new DefaultStepRunner(
      provider,
      "captured-session",
      "/tmp/project",
      {
        mode: "interactive",
        config: {
          llm_provider: "claude",
          steps: {
            manual_test: {
              llm_provider: "claude",
              escalate: false,
            },
          },
        },
        sessionStore: sessions,
        providerRuntimes: new ProviderRuntimeSet([
          {
            key: "claude",
            provider,
            policy: CLAUDE_MODEL_POLICY,
            builtIn: true,
            availability: new ModelAvailability(
              CLAUDE_MODEL_POLICY.modelFallbackLadder,
            ),
          },
        ]),
        configuredProviders: ["claude"],
        providerExecutor,
      },
    );

    await runGroupBranch(
      {
        name: "manual_test",
        skill: "manual-test",
        outcome: makeSkippedOutcome(),
      },
      fakeState,
      { stepRunner: runner },
      2,
    );

    expect({
      retryPolicy: providerExecutor.mock.calls.map(([input]) => ({
        attempt: input.attempt,
        escalate: input.escalate,
      })),
      sessions: invokeInteractive.mock.calls.map(([options]) => ({
        sessionId: options.sessionId,
        resume: options.resume,
      })),
    }).toEqual({
      retryPolicy: [
        { attempt: 1, escalate: false },
        { attempt: 2, escalate: false },
      ],
      sessions: [
        { sessionId: "manual-claude-attempt-1", resume: false },
        { sessionId: "manual-claude-attempt-2", resume: false },
      ],
    });
  });

  it("routes reversed concurrent members through provider-local branch scopes without mutating serial authority", async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), "group-provider-routing-"));
    try {
      const deferred = <T>() => {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      const manualFirst = deferred<InvokeResult>();
      const prdFirst = deferred<InvokeResult>();
      let manualCalls = 0;
      const manualDispatch = vi.fn(async (): Promise<InvokeResult> => {
        manualCalls += 1;
        return manualCalls === 1
          ? manualFirst.promise
          : { success: true, output: "manual passed", exitCode: 0 };
      });
      const prdDispatch = vi.fn(async (): Promise<InvokeResult> => prdFirst.promise);
      const architectureDispatch = vi.fn(async (): Promise<InvokeResult> => {
        throw new Error("architecture provider crashed");
      });
      const routeDispatch = (options: InvokeOptions) => {
        if (options.prompt === "/manual-test") return manualDispatch();
        if (options.prompt === "/prd-audit") return prdDispatch();
        return architectureDispatch();
      };
      const capturedInteractive = vi.fn(routeDispatch);
      const codexInteractive = vi.fn((options: InvokeOptions) =>
        options.prompt === "$manual-test"
          ? manualDispatch()
          : architectureDispatch(),
      );
      const claudeInteractive = vi.fn((_options: InvokeOptions) => prdDispatch());
      const capturedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: "captured print path must not run",
        exitCode: 0,
      }));
      const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: "Codex print path must not run",
        exitCode: 0,
      }));
      const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: "Claude print path must not run",
        exitCode: 0,
      }));
      const provider = (
        invoke: LLMProvider["invoke"],
        invokeInteractive: LLMProvider["invokeInteractive"],
      ): LLMProvider => ({
        lifecycleCapability: { synchronousSpawnPermit: true },
        invoke: vi.fn(async (options: InvokeOptions) => {
          const permit = options.spawnPermit?.();
          if (permit && !permit.permitted) {
            throw new Error(`provider spawn denied: ${permit.reason}`);
          }
          return invoke(options);
        }),
        invokeInteractive: vi.fn(async (options: InvokeOptions) => {
          const permit = options.spawnPermit?.();
          if (permit && !permit.permitted) {
            throw new Error(`provider spawn denied: ${permit.reason}`);
          }
          return invokeInteractive(options);
        }),
      });
      const legacySession = new SessionManager(pipelineDir);
      const ids = [
        "serial-claude-session",
        "manual-codex-attempt-1",
        "prd-claude-session",
        "manual-codex-attempt-2",
        "architecture-codex-session",
      ][Symbol.iterator]();
      const sessions = new ProviderSessionStore({
        createSessionId: () => ids.next().value ?? "unexpected-session",
        legacy: { providerKey: "claude", session: legacySession },
      });
      await sessions.beginStep("build");
      await sessions.prepare("claude");
      const serialBefore = {
        session: sessions.current("claude"),
        legacyId: await legacySession.getSessionId(),
        legacyCreated: await legacySession.isSessionCreated(),
      };
      const beginBranch = vi.spyOn(sessions, "beginBranch");
      const runner = new DefaultStepRunner(
        provider(capturedInvoke, capturedInteractive),
        "captured-session",
        "/tmp/project",
        {
          mode: "interactive",
          config: {
            llm_provider: ["claude", "codex"],
            steps: {
              manual_test: { llm_provider: "codex" },
              prd_audit: { llm_provider: "claude" },
              architecture_review_as_built: { llm_provider: "codex" },
            },
          },
          sessionStore: sessions,
          providerRuntimes: new ProviderRuntimeSet([
            {
              key: "claude",
              provider: provider(claudeInvoke, claudeInteractive),
              policy: CLAUDE_MODEL_POLICY,
              builtIn: true,
              availability: new ModelAvailability(
                CLAUDE_MODEL_POLICY.modelFallbackLadder,
              ),
            },
            {
              key: "codex",
              provider: provider(codexInvoke, codexInteractive),
              policy: CODEX_MODEL_POLICY,
              builtIn: true,
              availability: new ModelAvailability(
                CODEX_MODEL_POLICY.modelFallbackLadder,
              ),
            },
          ]),
          configuredProviders: ["claude", "codex"],
        },
      );
      const members = {
        manual: {
          name: "manual_test",
          skill: "manual-test",
          outcome: makeSkippedOutcome(),
        },
        prd: {
          name: "prd_audit",
          skill: "prd-audit",
          outcome: makeSkippedOutcome(),
        },
        architecture: {
          name: "architecture_review_as_built",
          skill: "architecture-review",
          outcome: makeSkippedOutcome(),
        },
      } satisfies Record<string, GroupMember>;
      const resultEvents: Array<{
        member: string;
        outcome: GroupMemberStepEvent["outcome"];
      }> = [];
      const completionOrder: string[] = [];
      const onMemberEvent = (event: GroupMemberStepEvent) => {
        if (event.phase === "result") {
          resultEvents.push({
            member: event.member,
            outcome: event.outcome,
          });
        }
      };
      const manualPromise = runGroupBranch(
        members.manual,
        fakeState,
        { stepRunner: runner, onMemberEvent },
        2,
      ).then((outcome) => {
        completionOrder.push("manual_test");
        return outcome;
      });
      const prdPromise = runGroupBranch(
        members.prd,
        fakeState,
        { stepRunner: runner, onMemberEvent },
        1,
      ).then((outcome) => {
        completionOrder.push("prd_audit");
        return outcome;
      });
      await vi.waitFor(() => {
        expect(manualDispatch).toHaveBeenCalledOnce();
        expect(prdDispatch).toHaveBeenCalledOnce();
      });
      prdFirst.resolve({ success: true, output: "prd passed", exitCode: 0 });
      await prdPromise;
      manualFirst.resolve({
        success: false,
        output: "manual retry",
        exitCode: 1,
      });
      const manualOutcome = await manualPromise;
      const prdOutcome = await prdPromise;
      const architectureOutcome = await runGroupBranch(
        members.architecture,
        fakeState,
        { stepRunner: runner, onMemberEvent },
        1,
      );
      const codexCalls = codexInteractive.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        cwd: options.cwd,
        interactive: options.interactive,
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
        model: options.model,
        effort: options.effort,
      }));
      const claudeCalls = claudeInteractive.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        cwd: options.cwd,
        interactive: options.interactive,
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
        model: options.model,
        effort: options.effort,
      }));

      // Branch scheduling is concurrent, so the opaque IDs' global minting
      // order is intentionally unspecified. The contract is that each
      // invocation, including the manual retry, owns a fresh branch session.
      expect(new Set([...codexCalls, ...claudeCalls].map(({ sessionId }) => sessionId)).size).toBe(4);

      expect({
        capturedCalls: capturedInteractive.mock.calls,
        printCalls: {
          captured: capturedInvoke.mock.calls,
          claude: claudeInvoke.mock.calls,
          codex: codexInvoke.mock.calls,
        },
        beginBranchCalls: beginBranch.mock.calls,
        codexCalls: codexCalls.map(({ sessionId: _sessionId, ...call }) => ({
          ...call,
        })),
        claudeCalls: claudeCalls.map(({ sessionId: _sessionId, ...call }) => ({
          ...call,
        })),
        completionOrder,
        resultEvents,
        outcomes: {
          manual: classifyOutcome(manualOutcome),
          prd: classifyOutcome(prdOutcome),
          architecture: classifyOutcome(architectureOutcome),
        },
        serialBefore,
        serialAfter: {
          session: sessions.current("claude"),
          legacyId: await legacySession.getSessionId(),
          legacyCreated: await legacySession.isSessionCreated(),
        },
      }).toEqual({
        capturedCalls: [],
        printCalls: { captured: [], claude: [], codex: [] },
        beginBranchCalls: [
          ["manual_test"],
          ["prd_audit"],
          ["architecture_review_as_built"],
        ],
        codexCalls: [
          {
            prompt: "$manual-test",
            resume: false,
            cwd: "/tmp/project",
            interactive: true,
            dangerouslySkipPermissions: false,
            model: "gpt-5.6-terra",
            effort: "medium",
          },
          {
            prompt: "$manual-test",
            resume: false,
            cwd: "/tmp/project",
            interactive: true,
            dangerouslySkipPermissions: false,
            model: "gpt-5.6-terra",
            effort: "medium",
          },
          {
            prompt: "$architecture-review --as-built",
            resume: false,
            cwd: "/tmp/project",
            interactive: true,
            dangerouslySkipPermissions: false,
            model: "gpt-5.6-sol",
            effort: "high",
          },
        ],
        claudeCalls: [
          {
            prompt: "/prd-audit",
            resume: false,
            cwd: "/tmp/project",
            interactive: true,
            dangerouslySkipPermissions: false,
            model: "opus",
            effort: "high",
          },
        ],
        completionOrder: ["prd_audit", "manual_test"],
        resultEvents: [
          { member: "prd_audit", outcome: "verdict:pass" },
          { member: "manual_test", outcome: "verdict:pass" },
          {
            member: "architecture_review_as_built",
            outcome: "no-verdict",
          },
        ],
        outcomes: {
          manual: "verdict:pass",
          prd: "verdict:pass",
          architecture: "no-verdict",
        },
        serialBefore: {
          session: { id: "serial-claude-session" },
          legacyId: "serial-claude-session",
          legacyCreated: false,
        },
        serialAfter: {
          session: { id: "serial-claude-session" },
          legacyId: "serial-claude-session",
          legacyCreated: false,
        },
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });

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

  it("cold-starts a scalar branch retry with a freshly minted session id", async () => {
    const runner = spyRunner([
      { success: false, output: "transient failure" },
      { success: true },
    ]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };
    const ids = ["manual-attempt-1", "manual-attempt-2"];

    const outcome = await runGroupBranch(
      member,
      fakeState,
      { stepRunner: runner, mintSessionId: () => ids.shift()! },
      3,
    );

    expect(runner.calls).toHaveLength(2);
    const firstSessionId = runner.calls[0]!.opts?.sessionId;
    const secondSessionId = runner.calls[1]!.opts?.sessionId;
    expect(firstSessionId).toBe("manual-attempt-1");
    expect(secondSessionId).toBe("manual-attempt-2");
    expect(runner.calls[0]!.opts?.resume).toBe(false);
    expect(runner.calls[1]!.opts?.resume).toBe(false);
    expect(classifyOutcome(outcome)).toBe("verdict:pass");
  });

  it("retains ordered observed intervals from unsuccessful scalar attempts followed by success", async () => {
    const firstInterval = { startedAtMs: 100, durationMs: 10 };
    const secondInterval = { startedAtMs: 200, durationMs: 20 };
    const runner = spyRunner([
      {
        success: false,
        output: "transient failure",
        observedIntervals: [firstInterval],
      },
      {
        success: true,
        observedIntervals: [secondInterval],
      },
    ]);
    const member: GroupMember = {
      name: "manual_test",
      skill: "manual-test",
      outcome: makeSkippedOutcome(),
    };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 2);

    expect(outcome).toEqual({
      kind: "verdict",
      verdict: "pass",
      observedIntervals: [firstInterval, secondInterval],
    });
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

  it("retains ordered observed intervals from every scalar attempt when retries are exhausted", async () => {
    const firstInterval = { startedAtMs: 300, durationMs: 30 };
    const secondInterval = { startedAtMs: 400, durationMs: 40 };
    const runner = spyRunner([
      {
        success: false,
        output: "fail 1",
        observedIntervals: [firstInterval],
      },
      {
        success: false,
        output: "fail 2",
        observedIntervals: [secondInterval],
      },
    ]);
    const member: GroupMember = {
      name: "manual_test",
      skill: "manual-test",
      outcome: makeSkippedOutcome(),
    };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 2);

    expect(outcome).toEqual({
      kind: "no-verdict",
      reason: "fail 2",
      observedIntervals: [firstInterval, secondInterval],
    });
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

  it("a permission denial stops the branch without consuming retry budget", async () => {
    const runner = spyRunner([{
      success: false,
      output: "Codex automatic permission review denied the required action.",
      permissionDenied: true,
      actualProvider: "codex",
      authentication: {
        provider: 'codex',
        source: 'api-key',
        state: 'ready',
        // @ts-expect-error Ready authentication metadata must never carry remediation.
        remediation: 'sensitive provider detail',
      },
    }]);
    const member: GroupMember = { name: "manual_test", skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 3);

    expect({ calls: runner.calls.length, outcome }).toEqual({
      calls: 1,
      outcome: {
        kind: "permission-denied",
        provider: "codex",
        reason: "Codex automatic permission review denied the required action.",
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'ready',
        },
      },
    });
  });

  it("an authFailure result does NOT burn retry budget and classifies as no-verdict with reason 'authFailure'", async () => {
    // Regression pin for the group JOIN behavior (conductor.ts's
    // `noVerdictIdx !== -1` branch, adr-2026-07-04-auth-failure-park-and-poll.md):
    // this branch-level unit test asserts the invariants runGroupBranch itself
    // owns — (a) the retry counter is never consumed by an authFailure result
    // (a single call against a maxRetries=3 budget produces exactly one
    // dispatch, not a burned attempt), and (b) group-core has no escalation
    // primitive of its own to invoke for this outcome — so an authFailure never
    // burns budget OR triggers escalation at the branch layer. The actual
    // park-then-resume ROUTING (not "retries exhausted") is a JOIN-level
    // concern proven end-to-end by
    // test/acceptance/build-auth-token-check-and-classify.acceptance.test.ts,
    // since a unit test against runGroupBranch alone cannot observe the join's
    // HALT-vs-park decision (see that file's header for why).
    const runner = spyRunner([{
      success: false,
      authFailure: true,
      output: "401 unauthorized",
      authentication: {
        provider: 'codex',
        source: 'api-key',
        state: 'unusable',
      },
    }]);
    const member: GroupMember = { name: "manual_test" as unknown as string, skill: "manual-test", outcome: makeSkippedOutcome() };

    const outcome = await runGroupBranch(member, fakeState, { stepRunner: runner }, 3);

    // (a) retry budget not consumed: exactly one dispatch occurred even
    // though maxRetries allowed up to 3 — the branch did not burn the
    // remaining budget looping on its own.
    expect(runner.calls).toHaveLength(1);

    // (b) distinguishable from a generic "retries exhausted" no-verdict: the
    // reason is preserved verbatim so the join can special-case it.
    expect(classifyOutcome(outcome)).toBe("no-verdict");
    expect(outcome).toEqual({
      kind: "no-verdict",
      reason: "authFailure",
      authentication: {
        provider: 'codex',
        source: 'api-key',
        state: 'unusable',
      },
    });
    expect(outcome).not.toEqual({ kind: "no-verdict", reason: "retries exhausted" });
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

describe("group-core: wall-clock concurrency proof (Task 26)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Fake-timer stub runners with durations 3t/2t/t under cap 2. Proves the
   * semaphore in `runWithConcurrency` genuinely overlaps branches instead of
   * running them one after another: total wall-clock duration must be LESS
   * than the naive serial sum (6t) but at least the longest chain the cap
   * forces (3t, since the 1t branch queues behind the 3t/2t pair and only
   * starts once the 2t branch frees a slot at t=2t, finishing at 3t — same
   * as the 3t branch). Start-event timestamps are recorded to prove actual
   * overlap (not sequential starts): the first two thunks start at the SAME
   * tick, and the third starts mid-flight of the still-running 3t branch.
   */
  it("cap 2 with durations 3t/2t/t: duration < serial sum, >= longest chain, starts interleave", async () => {
    const t = 10;
    const starts: number[] = [];

    const makeThunk = (durationMs: number) => () => {
      starts.push(Date.now());
      return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    };

    const thunks = [makeThunk(3 * t), makeThunk(2 * t), makeThunk(1 * t)];

    const startTime = Date.now();
    const resultPromise = runWithConcurrency(thunks, 2);

    await vi.runAllTimersAsync();
    await resultPromise;

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Genuine overlap, not serial: 3t + 2t + t (=6t) would be the naive
    // serial sum; the capped-concurrency duration must beat it.
    expect(totalDuration).toBeLessThan(6 * t);
    // But the cap still bounds parallelism: the longest chain under cap 2
    // is the 3t branch (the 1t branch queues and finishes inside that
    // window), so duration can never drop below it.
    expect(totalDuration).toBeGreaterThanOrEqual(3 * t);

    // Start-event interleaving proves overlap, not sequential starts: the
    // first two branches (3t, 2t) start at the exact same tick...
    expect(starts[0]).toBe(startTime);
    expect(starts[1]).toBe(startTime);
    // ...and the third (t) starts later, once the 2t branch frees a slot —
    // strictly BEFORE the 3t branch (still in flight) has finished, proving
    // the third branch's run overlaps the first branch's run rather than
    // waiting for it.
    expect(starts[2]).toBeGreaterThan(startTime);
    expect(starts[2]).toBeLessThan(startTime + 3 * t);
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

  it("does not spare a stale partial PRD-audit report when the dispatch state supplies its feature description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "group-core-prd-audit-sweep-"));
    try {
      await mkdir(join(dir, ".pipeline"), { recursive: true });
      await mkdir(join(dir, ".docs/specs"), { recursive: true });
      await writeFile(
        join(dir, ".docs/specs/current-feature.md"),
        "# PRD\n\n## Functional Requirements\n\nFR-1\nFR-2\n",
      );
      await execa("git", ["init", "-q", "-b", "main"], { cwd: dir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await execa("git", ["config", "user.name", "Test"], { cwd: dir });
      await execa("git", ["add", "."], { cwd: dir });
      await execa("git", ["commit", "-qm", "fixture"], { cwd: dir });
      const baseline = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout;
      const reportPath = join(dir, ".pipeline/prd-audit.md");
      await writeFile(reportPath, "| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | x |\n");
      await writeFile(join(dir, ".pipeline/prd-audit-code-stamp.json"), JSON.stringify({ codeStamp: baseline }));
      await utimes(reportPath, 1, 1);

      await runGroupBranch(
        { name: "prd_audit", skill: "prd-audit", outcome: makeSkippedOutcome() },
        { feature_desc: "current feature" } as ConductState,
        { stepRunner: okRunner(), projectRoot: dir, sessionStartedAt: Date.now() },
        1,
      );

      await expect(stat(reportPath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
