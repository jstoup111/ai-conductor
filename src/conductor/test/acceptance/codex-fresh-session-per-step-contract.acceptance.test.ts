/**
 * RED acceptance specs for the Codex fresh-session-per-step contract (#903).
 *
 * Track: technical (no PRD / FR coverage table — see .docs/plans/
 * codex-fresh-session-per-step-contract.md). The oracle is
 * `.docs/stories/codex-fresh-session-per-step-contract.md` (S1–S4) and
 * adr-2026-07-27-codex-never-resumes-a-harness-minted-session, not the current
 * implementation.
 *
 * These are multi-step flows: the session scope is driven across two dispatches
 * within one step (S1/S3), and the conductor is driven end to end across a
 * failed-then-retried Codex step (S2/S4). Provider doubles stand in only for the
 * real Codex/Claude process boundary; every internal seam is the production one.
 *
 * Production call sites of the resume derivation covered here (§3d):
 *   - src/conductor/src/engine/provider-execution.ts:397 (`invokeProviderCandidate`),
 *     reached from `executeProviderCandidates` (:537) — exercised directly and
 *     through the live conductor.
 *   - src/conductor/src/execution/codex-provider.ts:172 (`invoke`) and :224
 *     (`invokeInteractive`) — both covered in the sibling argv spec,
 *     codex-fresh-session-per-step-contract-argv.acceptance.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
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
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { ConductorEvent, HarnessConfig, StepName } from '../../src/types/index.js';

const UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A recorded `warn` transition; `session_policy` is not yet in the union. */
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
  return (loaded as unknown as {
    executeProviderCandidates: ExecuteProviderCandidates;
  }).executeProviderCandidates;
}

interface CodexProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
  /** Thread ids the fake itself minted — never the harness-supplied session id. */
  threadIds: string[];
}

type CodexFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

/**
 * The shared faithful Codex fake (plan Task 5). Loaded dynamically so a missing
 * fixture fails as an assertion inside a test rather than as a collection error
 * that would never establish RED.
 */
async function loadCodexProviderFake(): Promise<
  (script?: CodexFakeScript) => CodexProviderFake
> {
  const loaded = await import('../fixtures/codex-provider-fake.js').catch(
    () => null,
  );
  expect(
    loaded,
    'test/fixtures/codex-provider-fake.ts must exist and export the shared faithful Codex fake',
  ).not.toBeNull();
  const factory = (
    loaded as unknown as {
      createCodexProviderFake?: (script?: CodexFakeScript) => CodexProviderFake;
    } | null
  )?.createCodexProviderFake;
  expect(
    typeof factory,
    'codex-provider-fake.ts must export createCodexProviderFake',
  ).toBe('function');
  return factory as (script?: CodexFakeScript) => CodexProviderFake;
}

/** An inline double for the non-Codex halves of the contract. */
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
    invokeInteractive: vi.fn(async () => {}),
  };
  if (capability !== undefined) {
    (provider as unknown as { supportsSessionResume: boolean }).supportsSessionResume =
      capability;
  }
  return { provider, calls };
}

const ok = (output: string): InvokeResult => ({
  success: true,
  output,
  exitCode: 0,
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
      runtime(key, provider, key === 'codex' ? CODEX_MODEL_POLICY : CLAUDE_MODEL_POLICY),
    ),
  );
}

/**
 * Dispatch one step attempt through the real candidate loop, sharing one
 * step-scoped session across attempts exactly as the step runner does.
 */
async function dispatch(input: {
  execute: ExecuteProviderCandidates;
  step: StepName;
  provider: string;
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  transitions: RecordedTransition[];
  selfHost?: boolean;
}): Promise<void> {
  await input.execute({
    step: input.step,
    configuredProviders: [input.provider],
    preferredProvider: input.provider,
    runtimes: input.runtimes,
    sessions: input.sessions,
    options: { prompt: `acceptance dispatch for ${input.step}` },
    warn: (_message: string, transition: RecordedTransition) => {
      input.transitions.push(transition);
    },
    ...(input.selfHost
      ? {
          prepareCandidateSelfHost: async () => ({
            executable: '/resolved/codex',
            env: { CODEX_HOME: '/tmp/isolated-codex-home' },
            args: [] as readonly string[],
            teardown: async () => {},
          }),
        }
      : {}),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S1 — Codex dispatch never requests session resume', () => {
  it('declares session resume as a provider capability: Codex false, Claude true', () => {
    const codex = new CodexProvider(
      vi.fn(async () => ({ stdout: '{}', exitCode: 0 })) as never,
    );
    const claude = new ClaudeProvider();

    expect({
      codex: declaredResumeCapability(codex),
      claude: declaredResumeCapability(claude),
    }).toEqual({ codex: false, claude: true });
  });

  it('suppresses a would-be Codex resume on a second same-step dispatch', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ok('codex attempt'), false);
    const sessions = new ProviderSessionScope(() => 'harness-minted-uuid');
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'codex',
      runtimes: runtimesFor([['codex', codex.provider]]),
      sessions,
      transitions,
    };

    await dispatch(shared);
    // The scope itself still wants a resume — only the capability gate says no.
    const scopeWantsResume = (await sessions.prepare('codex')).resume;
    await dispatch(shared);

    expect({
      scopeWantsResume,
      resumeFlags: codex.calls.map((call) => call.resume),
      sessionIds: codex.calls.map((call) => call.sessionId),
    }).toEqual({
      scopeWantsResume: true,
      resumeFlags: [false, false],
      sessionIds: ['harness-minted-uuid', 'harness-minted-uuid'],
    });
  });

  it('fails closed for a provider that never declares the capability', async () => {
    const execute = await loadExecuteProviderCandidates();
    const undeclared = scriptedProvider(() => ok('undeclared attempt'));
    const sessions = new ProviderSessionScope(() => 'undeclared-session');
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'codex',
      runtimes: runtimesFor([['codex', undeclared.provider]]),
      sessions,
      transitions,
    };

    await dispatch(shared);
    await dispatch(shared);

    expect({
      declared: declaredResumeCapability(undeclared.provider),
      resumeFlags: undeclared.calls.map((call) => call.resume),
    }).toEqual({ declared: undefined, resumeFlags: [false, false] });
  });

  it('leaves Claude resume behavior unchanged on a same-step retry', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude attempt'), true);
    const sessions = new ProviderSessionScope(() => 'claude-session');
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

    expect({
      resumeFlags: claude.calls.map((call) => call.resume),
      sessionIds: claude.calls.map((call) => call.sessionId),
      transitionTypes: transitions.map((transition) => transition.type),
    }).toEqual({
      resumeFlags: [false, true],
      sessionIds: ['claude-session', 'claude-session'],
      transitionTypes: [],
    });
  });

  it('composes with forceFreshSession without an error or a doubled diagnostic', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ok('self-host attempt'), false);
    const sessions = new ProviderSessionScope(() => 'self-host-session');
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'codex',
      runtimes: runtimesFor([['codex', codex.provider]]),
      sessions,
      transitions,
      selfHost: true,
    };

    await dispatch(shared);
    await dispatch(shared);

    expect({
      resumeFlags: codex.calls.map((call) => call.resume),
      sessionPolicyCount: transitions.filter(
        (transition) => transition.type === 'session_policy',
      ).length,
    }).toEqual({ resumeFlags: [false, false], sessionPolicyCount: 1 });
  });
});

describe('S3 — a capability-suppressed resume is visible in the audit trail', () => {
  it('emits exactly one session_policy diagnostic per step naming provider, step, and reason', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ok('codex attempt'), false);
    const sessions = new ProviderSessionScope(() => 'diagnostic-session');
    const transitions: RecordedTransition[] = [];
    const shared = {
      execute,
      step: 'build' as StepName,
      provider: 'codex',
      runtimes: runtimesFor([['codex', codex.provider]]),
      sessions,
      transitions,
    };

    // Three suppressed attempts in one step scope must still read as one policy.
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
      provider: 'codex',
      reason: expect.stringMatching(/session resume/i),
    });
  });

  it('emits no session_policy diagnostic on a cold first Codex dispatch', async () => {
    const execute = await loadExecuteProviderCandidates();
    const codex = scriptedProvider(() => ok('first attempt'), false);
    const transitions: RecordedTransition[] = [];

    await dispatch({
      execute,
      step: 'build',
      provider: 'codex',
      runtimes: runtimesFor([['codex', codex.provider]]),
      sessions: new ProviderSessionScope(() => 'cold-session'),
      transitions,
    });

    expect({
      resume: codex.calls[0]?.resume,
      transitionTypes: transitions.map((transition) => transition.type),
    }).toEqual({ resume: false, transitionTypes: [] });
  });

  it('emits no session_policy diagnostic when a Claude resume proceeds normally', async () => {
    const execute = await loadExecuteProviderCandidates();
    const claude = scriptedProvider(() => ok('claude attempt'), true);
    const sessions = new ProviderSessionScope(() => 'claude-quiet-session');
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

    expect({
      resumed: claude.calls[1]?.resume,
      sessionPolicyCount: transitions.filter(
        (transition) => transition.type === 'session_policy',
      ).length,
    }).toEqual({ resumed: true, sessionPolicyCount: 0 });
  });
});

describe('S4 — the faithful Codex fake models a server-minted thread id', () => {
  it('mints its own uuidv7-shaped thread id and rejects a resume of an id it never minted', async () => {
    const createCodexProviderFake = await loadCodexProviderFake();
    const fake = createCodexProviderFake();

    const cold = await fake.provider.invoke({
      prompt: 'first turn',
      sessionId: 'harness-minted-uuid-v4',
      resume: false,
    });
    const resumed = await fake.provider.invoke({
      prompt: 'second turn',
      sessionId: 'harness-minted-uuid-v4',
      resume: true,
    });

    expect({
      capability: declaredResumeCapability(fake.provider),
      coldSuccess: cold.success,
      mintedShape: fake.threadIds.map((id) => UUIDV7_RE.test(id)),
      echoedHarnessId: fake.threadIds.includes('harness-minted-uuid-v4'),
      resumeSuccess: resumed.success,
      resumeOutput: resumed.output,
    }).toEqual({
      capability: false,
      coldSuccess: true,
      mintedShape: [true],
      echoedHarnessId: false,
      resumeSuccess: false,
      resumeOutput: 'no rollout found for thread id harness-minted-uuid-v4',
    });
  });
});

describe('S2/S4 — a multi-attempt Codex step cold-starts end to end', () => {
  let dir: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codex-fresh-session-'));
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('retries a failed Codex step with a cold session that carries the full RETRY-prefixed prompt', async () => {
    const createCodexProviderFake = await loadCodexProviderFake();
    let memoryCalls = 0;
    const fake = createCodexProviderFake((options) => {
      if (!options.prompt.includes('$memory')) {
        return { success: true, output: 'non-target step completed', exitCode: 0 };
      }
      memoryCalls += 1;
      if (memoryCalls === 1) {
        return { success: false, output: 'ordinary retryable failure', exitCode: 1 };
      }
      return undefined;
    });

    const runtimes = runtimesFor([['codex', fake.provider]]);
    const sessions = new ProviderSessionStore({
      createSessionId: () => 'memory-codex-harness-uuid',
    });
    const beginStep = vi.spyOn(sessions, 'beginStep');
    const transitions: RecordedTransition[] = [];
    const config: HarnessConfig = {
      llm_provider: ['codex'],
      steps: {
        memory: { llm_provider: 'codex', max_retries: 2 },
      },
    };
    const runner = new DefaultStepRunner(fake.provider, 'legacy-session', dir, {
      config,
      sessionStore: sessions,
      providerRuntimes: runtimes,
      configuredProviders: ['codex'],
      providerWarn: (_message: string, transition: RecordedTransition) => {
        transitions.push(transition);
        // Mirror the production wiring in daemon-cli.ts:809.
        return events.emit(transition as unknown as ConductorEvent);
      },
    } as never);
    const resetSession = vi.spyOn(runner, 'resetSession');
    const sessionResets: ConductorEvent[] = [];
    events.on('session_reset', (event) => {
      sessionResets.push(event);
    });

    const conductor = new Conductor({
      stateFilePath: join(dir, 'conduct-state.json'),
      stepRunner: runner,
      events,
      projectRoot: dir,
      config,
      onCheckpoint: async (step: StepName) =>
        step === 'memory' ? 'continue' : 'quit',
    });

    await conductor.run();

    const memoryAttempts = fake.calls.filter((call) =>
      call.prompt.includes('$memory'),
    );

    expect({
      attempts: memoryAttempts.length,
      resumeFlags: memoryAttempts.map((call) => call.resume),
      rolloutMisses: fake.calls.filter((call) => call.resume === true).length,
      sessionResetEvents: sessionResets.length,
      beginStepCalls: beginStep.mock.calls.filter(([step]) => step === 'memory')
        .length,
      staleRecoveryResets: resetSession.mock.calls.filter(
        ([step]) => step === undefined,
      ).length,
      stepBoundaryResets: resetSession.mock.calls.filter(
        ([step]) => step === 'memory',
      ).length,
      sessionPolicyDiagnostics: transitions.filter(
        (transition) =>
          transition.type === 'session_policy' && transition.step === 'memory',
      ).length,
    }).toEqual({
      attempts: 2,
      resumeFlags: [false, false],
      rolloutMisses: 0,
      sessionResetEvents: 0,
      beginStepCalls: 1,
      staleRecoveryResets: 0,
      stepBoundaryResets: 1,
      sessionPolicyDiagnostics: 1,
    });

    // The retry carries the whole step prompt, not a continuation turn.
    expect(memoryAttempts[1].prompt.startsWith('RETRY: ')).toBe(true);
    expect(memoryAttempts[1].prompt.endsWith(`\n${memoryAttempts[0].prompt}`)).toBe(
      true,
    );
  });
});
