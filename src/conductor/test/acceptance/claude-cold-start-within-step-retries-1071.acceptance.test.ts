/**
 * RED acceptance specs — "Claude declares no resume; no session is ever
 * resumed" (ai-conductor#1071).
 *
 * Track: technical (no PRD) — see `.docs/track/claude-within-step-retries-
 * resume-the-prior-attemp.md`. No FR-coverage table applies (§3e out of scope).
 * The oracle is `.docs/stories/claude-within-step-retries-resume-the-prior-
 * attemp.md` (ST-1071-1 … ST-1071-5) and
 * `adr-2026-07-27-cold-start-within-step-retries.md` — never the current
 * implementation.
 *
 * These are multi-step flows: every spec drives at least two dispatches inside
 * one step scope, because the defect only becomes observable on the SECOND
 * dispatch. Provider doubles stand in for the real Claude/Codex process
 * boundary; every internal seam (candidate loop, session scope, branch
 * executor, step runner) is the production one.
 *
 * Production call sites of the resume derivation covered here (§3d). The plan
 * (`.docs/plans/claude-within-step-retries-resume-the-prior-attemp.md`,
 * "Technical Approach" §3) enumerates exactly three; all three are driven:
 *   - src/conductor/src/engine/provider-execution.ts:397 `invokeProviderCandidate`,
 *     reached via `executeProviderCandidates` — capability-gated by #1069.
 *   - src/conductor/src/engine/group-core.ts:464-469 `const resume = hasRun` —
 *     the concurrent-group branch executor, driven through `runGroupBranch`.
 *     Never reaches the capability gate.
 *   - src/conductor/src/engine/step-runners.ts:529-530 `resume =
 *     this.sessionStarted` — the legacy scalar path, driven through
 *     `DefaultStepRunner.run`. Never reaches the capability gate.
 *
 * Two further call sites live in sibling specs, so their module-level execa
 * mock cannot leak into this file:
 *   - `ClaudeProvider.invoke` / `.invokeInteractive` argv (claude-provider.ts:674)
 *     and `SessionManager.buildClaudeArgs` (session.ts:83-90) —
 *     claude-cold-start-argv-1071.acceptance.test.ts.
 *   - `StepRunner.runInteractive` from both conductor.ts recovery call sites —
 *     interactive-recovery-failure-context-1071.acceptance.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import {
  ProviderSessionScope,
  ProviderSessionStore,
} from '../../src/engine/provider-session.js';
import {
  makeSkippedOutcome,
  runGroupBranch,
} from '../../src/engine/group-core.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type {
  StepRunResult,
  StepRunOptions,
} from '../../src/engine/conductor.js';
import type {
  ConductState,
  HarnessConfig,
  StepName,
} from '../../src/types/index.js';

/** A recorded `warn` transition; `session_policy` is not in the event union. */
interface RecordedTransition {
  type: string;
  step?: string;
  provider?: string;
  reason?: string;
  [key: string]: unknown;
}

/** Read the capability fail-closed without pinning it to today's type. */
function declaredResumeCapability(provider: object): unknown {
  return (provider as { supportsSessionResume?: unknown }).supportsSessionResume;
}

type ExecuteProviderCandidates = (
  input: Record<string, unknown>,
) => Promise<{ success: boolean; attempts: unknown[] }>;

async function loadExecuteProviderCandidates(): Promise<ExecuteProviderCandidates> {
  const loaded = await import('../../src/engine/provider-execution.js');
  return (
    loaded as unknown as {
      executeProviderCandidates: ExecuteProviderCandidates;
    }
  ).executeProviderCandidates;
}

/** An inline provider double whose declared capability is caller-controlled. */
function scriptedProvider(
  script: (options: InvokeOptions, call: number) => InvokeResult,
  capability?: boolean,
) {
  const calls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (options: InvokeOptions) => {
      calls.push(options);
      return script(options, calls.length);
    }),
    invokeInteractive: vi.fn(async (options: InvokeOptions) => {
      calls.push(options);
      return script(options, calls.length);
    }),
  };
  if (capability !== undefined) {
    (
      provider as unknown as { supportsSessionResume: boolean }
    ).supportsSessionResume = capability;
  }
  return { provider, calls };
}

const ok = (output: string): InvokeResult => ({
  success: true,
  output,
  exitCode: 0,
});

const fail = (output: string): InvokeResult => ({
  success: false,
  output,
  exitCode: 1,
});

function runtime(
  key: string,
  provider: LLMProvider,
  policy: ProviderModelPolicy,
): ProviderRuntime {
  return {
    key,
    provider,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

function runtimesFor(entries: Array<[string, LLMProvider]>): ProviderRuntimeSet {
  return new ProviderRuntimeSet(
    entries.map(([key, provider]) =>
      runtime(
        key,
        provider,
        key === 'codex' ? CODEX_MODEL_POLICY : CLAUDE_MODEL_POLICY,
      ),
    ),
  );
}

/** A counter mint, so a "fresh id per invocation" is observable by name. */
function countingMint(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/**
 * Dispatch one step attempt through the real candidate loop, sharing one
 * step-scoped session across attempts exactly as the step runner does.
 */
async function dispatch(input: {
  execute: ExecuteProviderCandidates;
  step: StepName;
  provider: string;
  configured?: readonly string[];
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  transitions: RecordedTransition[];
}): Promise<void> {
  await input.execute({
    step: input.step,
    configuredProviders: input.configured ?? [input.provider],
    preferredProvider: input.provider,
    runtimes: input.runtimes,
    sessions: input.sessions,
    options: { prompt: `acceptance dispatch for ${input.step}` },
    warn: (_message: string, transition: RecordedTransition) => {
      input.transitions.push(transition);
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-1071-1 — Claude declares no resume, and cannot construct one
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-1071-1 — Claude joins Codex in declaring no session resume', () => {
  it('declares supportsSessionResume false for BOTH built-in providers', () => {
    const codex = new CodexProvider(
      vi.fn(async () => ({ stdout: '{}', exitCode: 0 })) as never,
    );
    const claude = new ClaudeProvider();

    expect({
      codex: declaredResumeCapability(codex),
      claude: declaredResumeCapability(claude),
    }).toEqual({ codex: false, claude: false });
  });

  it('cold-starts a Claude within-step retry — the second attempt carries resume:false', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude attempt'), undefined);
    // The double declares exactly what the real adapter declares, so this
    // spec tracks the production declaration rather than a hand-set flag.
    (
      claude.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
    const sessions = new ProviderSessionScope(countingMint('claude-session'));
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'claude',
      runtimes: runtimesFor([['claude', claude.provider]]),
      sessions,
      transitions,
    };

    await dispatch(shared);
    await dispatch(shared);

    expect(claude.calls.map((call) => call.resume)).toEqual([false, false]);
  });

  it('routes Claude through the SAME capability gate as Codex — identical capability, identical outcome', async () => {
    const execute = await loadExecuteProviderCandidates();
    const declared = declaredResumeCapability(new ClaudeProvider());
    const results: Record<string, Array<boolean | undefined>> = {};

    for (const key of ['claude', 'codex'] as const) {
      const double = scriptedProvider(() => ok(`${key} attempt`));
      (
        double.provider as unknown as { supportsSessionResume?: unknown }
      ).supportsSessionResume = declared;
      const shared = {
        execute,
        step: 'build' as StepName,
        provider: key,
        runtimes: runtimesFor([[key, double.provider]]),
        sessions: new ProviderSessionScope(countingMint(`${key}-session`)),
        transitions: [] as RecordedTransition[],
      };
      await dispatch(shared);
      await dispatch(shared);
      results[key] = double.calls.map((call) => call.resume);
    }

    // A Claude-specific branch anywhere in the gate would make these differ.
    expect(results.claude).toEqual(results.codex);
    expect(results.claude).toEqual([false, false]);
  });

  it('carries resume:false on every dispatch for every real provider adapter', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude'));
    const codex = scriptedProvider(() => ok('codex'));
    (
      claude.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
    (
      codex.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(
      new CodexProvider(vi.fn(async () => ({ stdout: '{}', exitCode: 0 })) as never),
    );
    const runtimes = runtimesFor([
      ['claude', claude.provider],
      ['codex', codex.provider],
    ]);

    for (const key of ['claude', 'codex'] as const) {
      const shared = {
        execute,
        step: 'build' as StepName,
        provider: key,
        configured: [key],
        runtimes,
        sessions: new ProviderSessionScope(countingMint(`${key}-run`)),
        transitions: [] as RecordedTransition[],
      };
      await dispatch(shared);
      await dispatch(shared);
      await dispatch(shared);
    }

    const everyResumeFlag = [...claude.calls, ...codex.calls].map(
      (call) => call.resume,
    );
    expect(everyResumeFlag).toEqual([false, false, false, false, false, false]);
  });

  it('negative — an adapter that omits the declaration entirely is still non-resuming (#1069 fail-closed preserved)', async () => {
    const execute = await loadExecuteProviderCandidates();
    const undeclared = scriptedProvider(() => ok('undeclared attempt'));
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'claude',
      runtimes: runtimesFor([['claude', undeclared.provider]]),
      sessions: new ProviderSessionScope(countingMint('undeclared')),
      transitions: [] as RecordedTransition[],
    };

    await dispatch(shared);
    await dispatch(shared);

    expect({
      declared: declaredResumeCapability(undeclared.provider),
      resumeFlags: undeclared.calls.map((call) => call.resume),
    }).toEqual({ declared: undefined, resumeFlags: [false, false] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-1071-2 — Session identity is minted per invocation
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-1071-2 — a cold-started attempt carries an id the CLI has never seen', () => {
  it('hands attempt 2 a DIFFERENT session id than attempt 1 in the same step scope', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude attempt'));
    (
      claude.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'claude',
      runtimes: runtimesFor([['claude', claude.provider]]),
      sessions: new ProviderSessionScope(countingMint('minted')),
      transitions: [] as RecordedTransition[],
    };

    await dispatch(shared);
    await dispatch(shared);

    const ids = claude.calls.map((call) => call.sessionId);
    // Holding the id stable while suppressing the flag is the explicit defect
    // ST-1071-2's negative path names: `--session-id` against an
    // already-registered id is what SESSION_IN_USE_RE exists to catch.
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['minted-1', 'minted-2']);
  });

  it('mints per invocation at the SHARED seam — Codex sees the same fresh-id behavior', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ok('codex attempt'), false);
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'codex',
      runtimes: runtimesFor([['codex', codex.provider]]),
      sessions: new ProviderSessionScope(countingMint('codex-minted')),
      transitions: [] as RecordedTransition[],
    };

    await dispatch(shared);
    await dispatch(shared);

    expect(codex.calls.map((call) => call.sessionId)).toEqual([
      'codex-minted-1',
      'codex-minted-2',
    ]);
  });

  it('prepare() returns a distinct id and resume:false on consecutive calls, even after markCreated', async () => {
    const sessions = new ProviderSessionScope(countingMint('prepared'));

    const first = await sessions.prepare('claude');
    await sessions.markCreated('claude');
    const second = await sessions.prepare('claude');

    expect({
      first,
      second,
      distinct: first.id !== second.id,
    }).toEqual({
      first: { id: 'prepared-1', resume: false },
      second: { id: 'prepared-2', resume: false },
      distinct: true,
    });
  });

  it('cold-starts a fallback candidate with its own id when the preferred provider fails', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ({
      ...fail('claude model unavailable'),
      modelUnavailable: true,
    }));
    const codex = scriptedProvider(() => ok('codex fallback completed'), false);
    (
      claude.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
    // Empty fallback ladders, so an unavailable model escalates to the NEXT
    // PROVIDER candidate instead of retrying Claude on a lower tier.
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: claude.provider,
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      },
      {
        key: 'codex',
        provider: codex.provider,
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      },
    ]);

    await dispatch({
      execute,
      step: 'build',
      provider: 'claude',
      configured: ['claude', 'codex'],
      runtimes,
      sessions: new ProviderSessionScope(countingMint('fallback')),
      transitions: [],
    });

    expect({
      claudeIds: claude.calls.map((call) => call.sessionId),
      codexIds: codex.calls.map((call) => call.sessionId),
      resumeFlags: [...claude.calls, ...codex.calls].map((call) => call.resume),
      shared: claude.calls.some((c) =>
        codex.calls.some((k) => k.sessionId === c.sessionId),
      ),
    }).toEqual({
      claudeIds: ['fallback-1'],
      codexIds: ['fallback-2'],
      resumeFlags: [false, false],
      shared: false,
    });
  });

  it('negative — a first attempt that THROWS at the runtime boundary still yields a fresh id on the retry', async () => {
    const execute = await loadExecuteProviderCandidates();
    const calls: InvokeOptions[] = [];
    let n = 0;
    const provider: LLMProvider = {
      supportsSessionResume: declaredResumeCapability(
        new ClaudeProvider(),
      ) as boolean | undefined,
      invoke: vi.fn(async (options: InvokeOptions) => {
        calls.push(options);
        n += 1;
        if (n === 1) throw new Error('runtime boundary exploded');
        return ok('recovered');
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'claude',
      runtimes: runtimesFor([['claude', provider]]),
      sessions: new ProviderSessionScope(countingMint('thrown')),
      transitions: [] as RecordedTransition[],
    };

    await dispatch(shared).catch(() => {
      // A throw at the runtime boundary is the condition under test, not a
      // failure of this spec — the retry below is what must cold-start.
    });
    await dispatch(shared).catch(() => {});

    expect({
      ids: calls.map((call) => call.sessionId),
      resumeFlags: calls.map((call) => call.resume),
    }).toEqual({
      ids: ['thrown-1', 'thrown-2'],
      resumeFlags: [false, false],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-1071-3 — The two dispatch paths the capability gate cannot reach
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-1071-3 — the concurrent-group branch executor never requests a resume', () => {
  const fakeState = {} as ConductState;

  /** Minimal runner-spy: captures every (step, opts) call it receives. */
  function spyRunner(results: StepRunResult[]) {
    const calls: Array<{ step: StepName; opts?: StepRunOptions }> = [];
    let i = 0;
    return {
      calls,
      run: async (
        step: StepName,
        _state: ConductState,
        opts?: StepRunOptions,
      ): Promise<StepRunResult> => {
        calls.push({ step, opts });
        const result = results[i] ?? results.at(-1) ?? { success: true };
        i += 1;
        return result;
      },
    };
  }

  it('scalar branch path — a retried branch member gets resume:false and a freshly minted id', async () => {
    const runner = spyRunner([
      { success: false, output: 'branch attempt 1 failed' },
      { success: true, output: 'branch attempt 2 passed' },
    ]);

    await runGroupBranch(
      { name: 'manual_test', skill: 'manual-test', outcome: makeSkippedOutcome() },
      fakeState,
      { stepRunner: runner, mintSessionId: countingMint('branch') },
      2,
    );

    expect(
      runner.calls.map(({ opts }) => ({
        sessionId: opts?.sessionId,
        resume: opts?.resume,
      })),
    ).toEqual([
      { sessionId: 'branch-1', resume: false },
      // `hasRun` being true does NOT entitle a branch to resume.
      { sessionId: 'branch-2', resume: false },
    ]);
  });

  it('providerSessions branch path — a retried branch member cold-starts with a new provider session id', async () => {
    const observed: Array<{ sessionId: string; resume: boolean }> = [];
    let call = 0;
    const provider: LLMProvider = {
      supportsSessionResume: declaredResumeCapability(
        new ClaudeProvider(),
      ) as boolean | undefined,
      invoke: vi.fn(),
      invokeInteractive: vi.fn(async (options: InvokeOptions) => {
        observed.push({ sessionId: options.sessionId, resume: options.resume });
        call += 1;
        return call === 1
          ? fail('branch attempt 1 failed')
          : ok('branch attempt 2 passed');
      }),
    };
    const sessions = new ProviderSessionStore({
      createSessionId: countingMint('provider-branch'),
    });
    const config: HarnessConfig = {
      llm_provider: 'claude',
      steps: { manual_test: { llm_provider: 'claude' } },
    } as HarnessConfig;
    const runner = new DefaultStepRunner(provider, 'captured-session', '/tmp/project', {
      mode: 'interactive',
      config,
      sessionStore: sessions,
      providerRuntimes: runtimesFor([['claude', provider]]),
      configuredProviders: ['claude'],
    } as never);

    await runGroupBranch(
      { name: 'manual_test', skill: 'manual-test', outcome: makeSkippedOutcome() },
      fakeState,
      { stepRunner: runner },
      2,
    );

    expect(observed).toEqual([
      { sessionId: 'provider-branch-1', resume: false },
      { sessionId: 'provider-branch-2', resume: false },
    ]);
  });

  it('negative — two concurrent branches share no session id, and neither reuses its own prior id', async () => {
    const mint = countingMint('isolated');
    const a = spyRunner([
      { success: false, output: 'A failed' },
      { success: true, output: 'A passed' },
    ]);
    const b = spyRunner([
      { success: false, output: 'B failed' },
      { success: true, output: 'B passed' },
    ]);

    await Promise.all([
      runGroupBranch(
        { name: 'manual_test', skill: 'manual-test', outcome: makeSkippedOutcome() },
        fakeState,
        { stepRunner: a, mintSessionId: mint },
        2,
      ),
      runGroupBranch(
        { name: 'prd_audit', skill: 'prd-audit', outcome: makeSkippedOutcome() },
        fakeState,
        { stepRunner: b, mintSessionId: mint },
        2,
      ),
    ]);

    const idsA = a.calls.map(({ opts }) => opts?.sessionId);
    const idsB = b.calls.map(({ opts }) => opts?.sessionId);
    const all = [...idsA, ...idsB];

    expect({
      perBranchDistinct: [new Set(idsA).size, new Set(idsB).size],
      crossBranchOverlap: idsA.filter((id) => idsB.includes(id)),
      globallyDistinct: new Set(all).size === all.length,
      resumeFlags: [...a.calls, ...b.calls].map(({ opts }) => opts?.resume),
    }).toEqual({
      perBranchDistinct: [2, 2],
      crossBranchOverlap: [],
      globallyDistinct: true,
      resumeFlags: [false, false, false, false],
    });
  });

  it('a sessionExpired branch re-run is a cold start AND still does not consume retry budget', async () => {
    const runner = spyRunner([
      { success: false, output: 'already in use', sessionExpired: true },
      { success: true, output: 'recovered' },
    ]);

    const outcome = await runGroupBranch(
      { name: 'manual_test', skill: 'manual-test', outcome: makeSkippedOutcome() },
      fakeState,
      { stepRunner: runner, mintSessionId: countingMint('expired') },
      // A budget of 1 proves the recovery re-run did not decrement it.
      1,
    );

    expect({
      dispatches: runner.calls.length,
      resumeFlags: runner.calls.map(({ opts }) => opts?.resume),
      distinctIds: new Set(runner.calls.map(({ opts }) => opts?.sessionId)).size,
      outcome,
    }).toEqual({
      dispatches: 2,
      resumeFlags: [false, false],
      distinctIds: 2,
      outcome: { kind: 'verdict', verdict: 'pass' },
    });
  });
});

describe('ST-1071-3 — the legacy scalar step-runner path never requests a resume', () => {
  let dir: string;
  let pipelineDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cold-start-scalar-'));
    pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function scalarRunner(provider: LLMProvider): DefaultStepRunner {
    return new DefaultStepRunner(provider, 'legacy-session', dir, {
      pipelineDir,
      mode: 'auto',
      config: { steps: { memory: { max_retries: 2 } } } as HarnessConfig,
    });
  }

  it('a single-provider run with no session store cold-starts its second attempt with a fresh id', async () => {
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      supportsSessionResume: declaredResumeCapability(
        new ClaudeProvider(),
      ) as boolean | undefined,
      invoke: vi.fn(async (options: InvokeOptions) => {
        calls.push(options);
        return ok('scalar attempt');
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const runner = scalarRunner(provider);

    await runner.run('memory', {} as ConductState);
    await runner.run('memory', {} as ConductState);

    expect({
      resumeFlags: calls.map((call) => call.resume),
      distinctIds: new Set(calls.map((call) => call.sessionId)).size,
    }).toEqual({ resumeFlags: [false, false], distinctIds: 2 });
  });

  it('negative — an inherited .pipeline/session-created marker never yields a resume, and is still persisted', async () => {
    // A marker left on disk by a prior process: the marker survives, only its
    // consequence changes (ST-1071-3 negative path 2).
    await writeFile(join(pipelineDir, 'session-created'), '1', 'utf-8');
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      supportsSessionResume: declaredResumeCapability(
        new ClaudeProvider(),
      ) as boolean | undefined,
      invoke: vi.fn(async (options: InvokeOptions) => {
        calls.push(options);
        return ok('scalar attempt');
      }),
      invokeInteractive: vi.fn(async () => {}),
    };
    const runner = scalarRunner(provider);

    await runner.run('memory', {} as ConductState);

    expect({
      resumeOnFirstDispatch: calls[0]?.resume,
      markerStillPersisted: existsSync(join(pipelineDir, 'session-created')),
    }).toEqual({ resumeOnFirstDispatch: false, markerStillPersisted: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-1071-5 — Recovery, diagnostics and telemetry survive intact
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-1071-5 — diagnostics and telemetry survive universal cold start', () => {
  it('emits the #1069 session_policy diagnostic ONCE PER STEP, not once per invocation', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude attempt'));
    (
      claude.provider as unknown as { supportsSessionResume?: unknown }
    ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'claude',
      runtimes: runtimesFor([['claude', claude.provider]]),
      sessions: new ProviderSessionScope(countingMint('policy')),
      transitions,
    };

    // Three suppressed Claude attempts in one step scope must read as ONE
    // policy statement — the diagnostic now fires on every dispatch, so its
    // once-per-step scoping is what keeps the audit trail readable.
    await dispatch(shared);
    await dispatch(shared);
    await dispatch(shared);

    const policies = transitions.filter(
      (transition) => transition.type === 'session_policy',
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      type: 'session_policy',
      step: 'build',
      provider: 'claude',
      reason: expect.stringMatching(/session resume/i),
    });
  });

  it('the SESSION_IN_USE / STALE_SESSION signals are not deleted as dead code', async () => {
    // ST-1071-5 negative path 1: cold start removes the most common trigger of
    // the identifier-rejection net; the net itself must survive the cleanup.
    const source = await readFile(
      new URL('../../src/execution/claude-provider.ts', import.meta.url),
      'utf-8',
    );
    const codexSource = await readFile(
      new URL('../../src/execution/codex-provider.ts', import.meta.url),
      'utf-8',
    );

    expect({
      sessionInUse: source.includes('SESSION_IN_USE_RE'),
      staleSession: source.includes('STALE_SESSION_RE'),
      claudeSessionExpired: source.includes('sessionExpired'),
      codexSessionExpired: codexSource.includes('CODEX_SESSION_EXPIRED_RE'),
    }).toEqual({
      sessionInUse: true,
      staleSession: true,
      claudeSessionExpired: true,
      codexSessionExpired: true,
    });
  });

  it('negative — .pipeline/conduct-session-id does not churn per provider invocation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cold-start-runid-'));
    const pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'conduct-session-id'),
      'feature-run-identity',
      'utf-8',
    );
    try {
      const provider = scriptedProvider(() => ok('attempt completed'));
      (
        provider.provider as unknown as { supportsSessionResume?: unknown }
      ).supportsSessionResume = declaredResumeCapability(new ClaudeProvider());
      const config: HarnessConfig = {
        llm_provider: 'claude',
        steps: { memory: { llm_provider: 'claude' } },
      } as HarnessConfig;
      const sessions = new ProviderSessionStore({
        createSessionId: countingMint('run-id-churn'),
      });
      const runner = new DefaultStepRunner(
        provider.provider,
        'feature-run-identity',
        dir,
        {
          pipelineDir,
          mode: 'auto',
          config,
          sessionStore: sessions,
          providerRuntimes: runtimesFor([['claude', provider.provider]]),
          configuredProviders: ['claude'],
        } as never,
      );

      const observed: string[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await runner.resetSession('memory');
        await runner.run('memory', {} as ConductState);
        observed.push(
          await readFile(join(pipelineDir, 'conduct-session-id'), 'utf-8'),
        );
      }

      // `conduct-session-id` backs `conductor.run.id` (otel/resource.ts:46-55).
      // Per-invocation provider identity must NOT leak into it, or every
      // cold-started attempt would emit spans under a different run.
      expect({
        distinctRunIds: new Set(observed).size,
        providerIdsChurned:
          new Set(provider.calls.map((call) => call.sessionId)).size,
      }).toEqual({ distinctRunIds: 1, providerIdsChurned: 3 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
