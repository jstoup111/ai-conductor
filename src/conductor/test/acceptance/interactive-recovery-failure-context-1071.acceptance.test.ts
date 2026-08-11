/**
 * RED acceptance specs — interactive recovery cold-starts on a session that
 * states what failed (#1071, story ST-1071-4).
 *
 * Track: technical (no PRD) — no FR-coverage table applies.
 *
 * §3d per-call-site coverage. `runInteractive` is a derivation whose defect
 * lives in the WIRING between the conductor's two recovery call sites and the
 * step runner: today the runner builds a 12-word stub with an empty system
 * prompt and `resume: true`, and neither call site hands it the failure it is
 * recovering from. A unit test that calls `runInteractive` directly with a
 * hand-injected context would pass while both real call sites still pass
 * nothing. So every production call site is driven through `Conductor.run()`
 * with a REAL failure, and the observable guarantee asserted at that site.
 *
 * Production call sites of `runInteractive` (§3d):
 *   - src/conductor/src/engine/conductor.ts:4954 — the build stall-breaker
 *     ("hand off: open an interactive session so the user can break the
 *     stall"), reached in non-auto mode once `stalled` is classified.
 *   - src/conductor/src/engine/conductor.ts:5985 — the recovery menu's
 *     "interactive fix" option.
 *   - Interface declaration: conductor.ts:547.
 * Implementation under test: src/conductor/src/engine/step-runners.ts:1232.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type {
  InvokeOptions,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { HarnessConfig, StepName } from '../../src/types/index.js';

const STALL_REASON = 'ACCEPTANCE-STALL-REASON: cannot choose between plan A and plan B';
const MENU_REASON = 'ACCEPTANCE-MENU-REASON: spec/integration/links_spec.rb:42 failed';

/**
 * `runInteractive`'s failure-context parameter does not exist yet, so its shape
 * is read structurally rather than through today's single-argument type.
 */
function contextOf(call: unknown[] | undefined): string {
  if (!call) return '<runInteractive was never called>';
  return call.slice(1).map((arg) => JSON.stringify(arg) ?? String(arg)).join(' ');
}

function makeRunner(
  run: StepRunner['run'],
): StepRunner & { runInteractive: ReturnType<typeof vi.fn> } {
  return {
    run,
    runInteractive: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as StepRunner & { runInteractive: ReturnType<typeof vi.fn> };
}

// ── Fixtures for reaching the real build stall-breaker ───────────────────────
// Ported from builds-stall-when-work-lands-without-task-trailer-.acceptance
// .test.ts, which ported them from test/engine/conductor.test.ts's own
// file-private stall fixture. Copied rather than shared because neither
// source exports them.

async function initGitRepo(dir: string): Promise<void> {
  await execa('git', ['init', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# Test\n');
  await execa('git', ['add', 'README.md'], { cwd: dir });
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
}

async function seedAllArtifactsExceptTaskStatus(dir: string): Promise<void> {
  const artifacts: Array<[string, string]> = [
    ['.docs/decisions/technical-assessment-2026-07-23.md', 'x'],
    ['.docs/specs/2026-07-23-feature.md', 'x'],
    ['.docs/stories/epic-1/a.md', 'x'],
    ['.docs/conflicts/2026-07-23.md', 'x'],
    ['.docs/architecture/arch.md', 'x'],
    ['.docs/decisions/adr-001.md', 'x'],
    ['.docs/coherence/coherence.md', 'x'],
    ['spec/acceptance/feature_spec.rb', 'x'],
    [
      '.pipeline/acceptance-specs-red.json',
      JSON.stringify({
        command: 'bundle exec rspec spec/acceptance',
        targetSpecs: ['spec/acceptance/feature_spec.rb'],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
        failingTests: [{ name: 'feature acceptance contract', reason: 'expected behavior is not implemented' }],
        ranAt: '2026-08-10T00:00:00.000Z',
        intentRationale: 'The fixture records an executed, failing feature acceptance spec.',
      }),
    ],
    ['.docs/retros/2026-07-23-retro.md', 'x'],
  ];
  for (const [rel, content] of artifacts) {
    const full = join(dir, rel);
    await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, content);
  }
}

async function writePlanAndStatus(dir: string, total: number): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  const planLines: string[] = ['# Plan', ''];
  for (let i = 1; i <= total; i++) planLines.push(`### Task ${i}: Step ${i}`, '');
  await writeFile(join(dir, '.docs/plans/2026-07-23-plan.md'), planLines.join('\n'));
  const tasks = Array.from({ length: total }, (_, idx) => ({
    id: idx + 1,
    status: 'pending',
  }));
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  await execa('git', ['add', '.docs'], { cwd: dir });
  await execa('git', ['commit', '-m', 'docs: approve decide artifacts'], { cwd: dir });
}

describe('ST-1071-4 — both conductor call sites hand runInteractive the failure context', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'interactive-recovery-1071-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stall-breaker call site (conductor.ts:4954) names the failed step and carries the stall reason', async () => {
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
    await writePlanAndStatus(dir, 3);

    const runner = makeRunner(
      vi.fn(async (step: StepName) => {
        if (step === 'build') {
          // The pipeline skill wrote a halt marker it could not resolve itself
          // — the exact condition the stall-breaker hands off to a human for.
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            `${STALL_REASON}\n`,
            'utf-8',
          );
          // The dispatch itself "succeeded" — Claude ran, wrote a question it
          // could not answer, and left the plan tasks unresolved. That is the
          // exact shape the stall circuit breaker classifies as `halt_marker`.
          return { success: true, output: STALL_REASON };
        }
        return { success: true };
      }) as unknown as StepRunner['run'],
    );

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
      onRecovery: vi.fn().mockResolvedValue('quit' as const),
    });

    await conductor.run();

    const call = runner.runInteractive.mock.calls[0] as unknown[] | undefined;
    expect(runner.runInteractive).toHaveBeenCalled();
    expect(call?.[0]).toBe('build');
    // The handed-off session must not require the operator to reconstruct the
    // failure themselves.
    expect(contextOf(call)).toContain(STALL_REASON);
  });

  it('recovery-menu call site (conductor.ts:5985) names the failed step and carries the failure reason', async () => {
    const runner = makeRunner(
      vi.fn(async (step: StepName) =>
        step === 'memory'
          ? { success: false, output: MENU_REASON }
          : { success: true },
      ) as unknown as StepRunner['run'],
    );
    let asked = 0;
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'default',
      config: { steps: { memory: { max_retries: 1 } } } as HarnessConfig,
      onRecovery: vi.fn(async () => (++asked === 1 ? 'interactive' : 'quit')),
    });

    await conductor.run();

    const call = runner.runInteractive.mock.calls[0] as unknown[] | undefined;
    expect(runner.runInteractive).toHaveBeenCalled();
    expect(call?.[0]).toBe('memory');
    expect(contextOf(call)).toContain(MENU_REASON);
  });
});

describe('ST-1071-4 — runInteractive renders the context and cold-starts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'run-interactive-1071-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeProvider() {
    const calls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async () => ({ success: true, output: 'ok', exitCode: 0 })),
      invokeInteractive: vi.fn(async (options: InvokeOptions) => {
        const permit = options.spawnPermit?.();
        if (permit && !permit.permitted) {
          return { success: false, output: `test provider spawn denied: ${permit.reason}`, exitCode: 1 };
        }
        calls.push(options);
        return { success: true, output: 'operator finished', exitCode: 0 };
      }),
    };
    return { provider, calls };
  }

  /** Invoke the (not-yet-widened) failure-context parameter structurally. */
  async function callRunInteractive(
    runner: DefaultStepRunner,
    step: StepName,
    context: unknown,
  ): Promise<void> {
    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context?: unknown,
      ) => Promise<void>
    )(step, context);
  }

  it('legacy path — the prompt names the failed step and the failure reason, and does not resume', async () => {
    const { provider, calls } = makeProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', dir, {
      pipelineDir: join(dir, '.pipeline'),
      mode: 'default',
    });

    await callRunInteractive(runner, 'build', {
      step: 'build',
      reason: MENU_REASON,
    });

    const rendered = `${calls[0]?.prompt ?? ''}\n${calls[0]?.systemPrompt ?? ''}`;
    expect({
      namesStep: rendered.includes('build'),
      carriesReason: rendered.includes(MENU_REASON),
      resume: calls[0]?.resume,
    }).toEqual({ namesStep: true, carriesReason: true, resume: false });
  });

  it('provider-aware path — same contract, and no resume on the provider dispatch', async () => {
    const { provider, calls } = makeProvider();
    const config: HarnessConfig = {
      llm_provider: 'claude',
      steps: { build: { llm_provider: 'claude' } },
    } as HarnessConfig;
    const runner = new DefaultStepRunner(provider, 'legacy-session', dir, {
      pipelineDir: join(dir, '.pipeline'),
      mode: 'default',
      config,
      sessionStore: new ProviderSessionStore({
        createSessionId: () => 'interactive-session',
      }),
      providerRuntimes: new ProviderRuntimeSet([
        {
          key: 'claude',
          provider,
          policy: CLAUDE_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(
            CLAUDE_MODEL_POLICY.modelFallbackLadder,
          ),
        },
      ]),
      configuredProviders: ['claude'],
    } as never);
    await runner.resetSession('build');

    await callRunInteractive(runner, 'build', {
      step: 'build',
      reason: MENU_REASON,
    });

    const rendered = `${calls[0]?.prompt ?? ''}\n${calls[0]?.systemPrompt ?? ''}`;
    expect({
      namesStep: rendered.includes('build'),
      carriesReason: rendered.includes(MENU_REASON),
      resume: calls[0]?.resume,
    }).toEqual({ namesStep: true, carriesReason: true, resume: false });
  });

  it('negative — a blank failure reason still states which step failed and that no reason was captured', async () => {
    const { provider, calls } = makeProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', dir, {
      pipelineDir: join(dir, '.pipeline'),
      mode: 'default',
    });

    await callRunInteractive(runner, 'manual_test', {
      step: 'manual_test',
      reason: '',
    });

    const rendered = `${calls[0]?.prompt ?? ''}\n${calls[0]?.systemPrompt ?? ''}`;
    expect({
      namesStep: rendered.includes('manual_test'),
      statesNoReason: /no (failure )?reason (was )?captured/i.test(rendered),
      resume: calls[0]?.resume,
    }).toEqual({ namesStep: true, statesNoReason: true, resume: false });
  });
});
