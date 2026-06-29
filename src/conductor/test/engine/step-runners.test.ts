import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import {
  DefaultStepRunner,
  parseTierFromOutput,
  parseSignalCountsFromOutput,
  scoreComplexityFromCounts,
} from '../../src/engine/step-runners.js';

function createMockProvider(): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      exitCode: 0,
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

const emptyState: ConductState = {};

describe('DefaultStepRunner', () => {
  it('all steps use invokeInteractive (stdio: inherit)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    expect(provider.invoke).not.toHaveBeenCalled();
  });

  it('passes correct prompt for brainstorm', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/brainstorm');
  });

  // Worktree isolation: the spawned claude must run in the runner's projectDir,
  // not the daemon's cwd. Without this, daemon feature builds committed to the
  // main checkout's branch instead of the per-feature worktree branch.
  it('passes projectDir as cwd to the provider (collaborative path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('brainstorm', emptyState);
    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  it('passes projectDir as cwd to the provider (autonomous path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('build', emptyState); // build is autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  it('passes correct prompt for build (pipeline)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    // Autonomous steps use invoke() (captured output) not invokeInteractive()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  // Regression: `remediate` is dispatched out-of-band when a prd_audit blocks
  // (conductor.ts). It's deliberately absent from the linear ALL_STEPS sequence,
  // so resolving its config/index/label threw "Unknown step: remediate" — which
  // the daemon caught and wrote to .pipeline/HALT, blocking autonomous SHIP
  // remediation entirely. run() must dispatch it like any other autonomous step.
  it('dispatches the out-of-band remediate step without throwing', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('remediate', emptyState);

    expect(result.success).toBe(true);
    // Autonomous → invoke(), and the prompt carries the /remediate command.
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/remediate');
    // No linear index → labelled header instead of "N/total".
    expect(opts.systemPrompt).toContain('Remediate');
  });

  it('autonomous steps use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('collaborative steps do NOT use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('in auto mode, collaborative steps DO skip permissions (no human to approve)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    // Otherwise the spawned claude launches in the user's default permission
    // mode (possibly `plan`), blocking the PRD write and looping the step.
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('worktree is autonomous', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState);

    // Autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('stories is collaborative', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('returns success on normal completion', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(true);
  });

  it('returns failure when session throws', async () => {
    const provider = createMockProvider();
    (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(false);
  });

  it('first step does not resume, subsequent steps do', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState); // autonomous → invoke
    await runner.run('memory', emptyState);   // autonomous → invoke

    const call1 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    const call2 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
    expect(call1.resume).toBe(false);
    expect(call2.resume).toBe(true);
  });

  // --- Feature 1: Step-scoped system prompts ---

  it('step runner passes system prompt with step context', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('[Conduct step 3/14]');
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
  });

  it('collaborative step system prompt includes "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // brainstorm is collaborative (not autonomous)
    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Complete ONLY this step');
    expect(opts.systemPrompt).toContain('Brainstorm');
  });

  it('autonomous step system prompt does NOT include "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // build is autonomous → invoke() path
    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
    expect(opts.systemPrompt).not.toContain('Complete ONLY this step');
  });

  // --- Auto-mode finish: completion markers use absolute worktree paths ---
  // Regression: in daemon mode the finish skill `cd`s into the main repo during
  // branch/PR/worktree cleanup, so relative `.pipeline/...` writes landed in the
  // wrong repo while the gate read the worktree — HALTing a feature whose PR was
  // genuinely created. The auto-finish prompt must direct writes to ABSOLUTE
  // worktree paths derived from pipelineDir.

  it('auto-mode finish prompt uses ABSOLUTE pipelineDir paths for the markers', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('/wt/feature-x/.pipeline/finish-choice');
    expect(opts.systemPrompt).toContain('/wt/feature-x/.pipeline/conduct-state.json');
    // Must not push the marker write to after cleanup.
    expect(opts.systemPrompt).not.toContain('must be your final action');
  });

  it('auto-mode finish prompt falls back to relative paths when pipelineDir is unset', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('`.pipeline/finish-choice`');
    expect(opts.systemPrompt).not.toContain('/.pipeline/finish-choice');
  });

  // --- Feature 2: Session creation marker ---

  describe('session marker persistence', () => {
    let pipeDir: string;

    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'step-runner-'));
    });

    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('persists session-created marker after first success', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      // Marker file should exist
      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(true);
    });

    it('reads existing session-created marker on init', async () => {
      // Pre-create the marker file
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // First run should use resume=true because marker exists
      await runner.run('brainstorm', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(true);
    });

    it('resetSession() overrides an inherited stale marker so the next step CREATES (no --resume)', async () => {
      // Reproduces the daemon worktree-reuse bug: a KEPT worktree carries a
      // stale `session-created` marker from the prior run, so a fresh runner's
      // lazy-init would set sessionStarted=true and `--resume` a brand-new
      // session id that was never created → "No conversation found" → "session
      // unavailable (expired or in use)". The conductor calls resetSession()
      // before each step under freshContextPerStep; it must win over the stale
      // marker and force a create.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'stale-id', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'fresh-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState); // autonomous → invoke()

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
    });

    it('persists session ID to conduct-session-id file', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'my-session-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const sessionIdPath = join(pipeDir, 'conduct-session-id');
      const content = await readFile(sessionIdPath, 'utf-8');
      expect(content.trim()).toBe('my-session-id');
    });

    it('does not write marker when step fails', async () => {
      const provider = createMockProvider();
      // worktree is autonomous → invoke() path. Mock it to return failure.
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'step exited nonzero',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(false);
    });
  });

  // --- Feature 3: Step cooldown ---

  describe('step cooldown', () => {
    it('tracks call count across steps', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      expect(runner.callCount).toBe(2);
    });

    it('skips cooldown for the very first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);

      // No sleep before the first step
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('applies cooldown after the first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      // Sleep called once before the second step
      expect(sleepSpy).toHaveBeenCalledOnce();
      expect(sleepSpy).toHaveBeenCalledWith(10000); // 10 seconds in ms
    });

    it('cooldown escalates after 10 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 11 steps (first has no cooldown, steps 2-10 use base, step 11 uses 2x).
      // complexity is engine-managed, so it is excluded from runner.run paths.
      const steps: StepName[] = [
        'worktree', 'memory', 'brainstorm', 'stories', 'conflict_check',
        'plan', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'build', 'manual_test',
      ];
      for (const step of steps) {
        await runner.run(step, emptyState);
      }

      // 10 sleep calls (steps 2-11)
      expect(sleepSpy).toHaveBeenCalledTimes(10);
      // Last call (11th step, callCount=10 at that point) should use 2x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('cooldown escalates to 3x after 20 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 5,
        sleepFn: sleepSpy,
      });

      // Simulate 21 calls by running same step repeatedly
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // Last call (21st step, callCount=20 at that point) should use 3x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(15000); // 3x * 5s
    });
  });

  describe('complexity assessment', () => {
    it('refuses to run() the complexity step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('complexity' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('refuses to run() the rebase step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('rebase' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('assessComplexity calls provider.invoke in print mode', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'Reasoning...\n\nTIER: M',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      const tier = await runner.assessComplexity();

      expect(provider.invoke).toHaveBeenCalledOnce();
      expect(provider.invokeInteractive).not.toHaveBeenCalled();
      expect(tier).toBe('M');
    });

    it('assessComplexity returns null when provider fails', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });

    it('assessComplexity returns null when output has no tier', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'I could not determine a clear tier from the brainstorm.',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });
  });

  describe('parseSignalCountsFromOutput', () => {
    it('extracts all five signals from well-formed output', () => {
      const output = `MODELS: 12
INTEGRATIONS: 3
AUTH: 2
STATE_MACHINES: 4
STORIES: 25
TIER: L`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 12,
        integrations: 3,
        auth: 2,
        stateMachines: 4,
        stories: 25,
      });
    });

    it('tolerates STATE MACHINES with space or hyphen', () => {
      expect(parseSignalCountsFromOutput('STATE MACHINES: 2').stateMachines).toBe(2);
      expect(parseSignalCountsFromOutput('STATE-MACHINES: 3').stateMachines).toBe(3);
      expect(parseSignalCountsFromOutput('STATEMACHINES: 1').stateMachines).toBe(1);
    });

    it('is case-insensitive and tolerates surrounding prose', () => {
      const output = `Here is my assessment.
models: 5
Some filler.
Integrations: 1
auth: 0
state_machines: 0
stories: 8
tier: m`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 5,
        integrations: 1,
        auth: 0,
        stateMachines: 0,
        stories: 8,
      });
    });

    it('returns an empty object when no signals found', () => {
      expect(parseSignalCountsFromOutput('nothing useful')).toEqual({});
      expect(parseSignalCountsFromOutput('TIER: S')).toEqual({});
    });

    it('omits signals whose value is not a non-negative integer', () => {
      const output = `MODELS: abc
INTEGRATIONS: 2
AUTH: 1
STORIES: 10`;
      const parsed = parseSignalCountsFromOutput(output);
      expect(parsed.models).toBeUndefined();
      expect(parsed.integrations).toBe(2);
      expect(parsed.auth).toBe(1);
      expect(parsed.stories).toBe(10);
    });
  });

  describe('scoreComplexityFromCounts', () => {
    it('scores a Large project (many models + integrations)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 12,     // L
          integrations: 3, // L
          auth: 2,         // L
          stateMachines: 2, // L
          stories: 25,     // L
        }),
      ).toBe('L');
    });

    it('scores a Small project (trivial across the board)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,
          integrations: 0,
          auth: 0,
          stateMachines: 0,
          stories: 3,
        }),
      ).toBe('S');
    });

    it('breaks ties toward the higher tier (2S + 2L + 1M → L)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,        // S
          integrations: 0,  // S
          auth: 1,          // M
          stateMachines: 2, // L
          stories: 50,      // L
        }),
      ).toBe('L');
    });

    it('returns null when fewer than 3 signals are available', () => {
      expect(scoreComplexityFromCounts({})).toBeNull();
      expect(scoreComplexityFromCounts({ models: 5 })).toBeNull();
      expect(
        scoreComplexityFromCounts({ models: 5, integrations: 1 }),
      ).toBeNull();
    });

    it('scores with exactly 3 signals (borderline)', () => {
      // 3 signals: 1S + 1M + 1L → tie break toward L per assessTier
      expect(
        scoreComplexityFromCounts({ models: 2, integrations: 2, stories: 20 }),
      ).toBe('L');
    });
  });

  describe('assessComplexity deterministic scoring', () => {
    it('prefers count-based scoring over Claude letter (L despite TIER: S)', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 15
INTEGRATIONS: 5
AUTH: 2
STATE_MACHINES: 3
STORIES: 40
TIER: S`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('L');
    });

    it('falls back to Claude letter when <3 counts extracted', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 2
TIER: M`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('M');
    });
  });

  describe('parseTierFromOutput', () => {
    it.each([
      ['TIER: S', 'S'],
      ['TIER: M', 'M'],
      ['TIER: L', 'L'],
      ['tier: s', 'S'],
      ['Reasoning about scope...\n\nFinal answer\n\nTIER: L', 'L'],
      ['TIER: M\nsome trailing text\nTIER: L', 'L'], // last match wins
    ])('extracts tier from %j → %s', (output, expected) => {
      expect(parseTierFromOutput(output)).toBe(expected);
    });

    it('falls back to trailing standalone letter', () => {
      expect(parseTierFromOutput('Analysis done.\n\nM.')).toBe('M');
      expect(parseTierFromOutput('Analysis done.\n\nL')).toBe('L');
    });

    it('returns null when no tier is present', () => {
      expect(parseTierFromOutput('')).toBeNull();
      expect(parseTierFromOutput('no tier here')).toBeNull();
      expect(parseTierFromOutput('TIER: X')).toBeNull();
    });
  });

  describe('rate-limit detection', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-ratelimit-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('surfaces rateLimited=true when provider reports it', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limit hit, try again',
        exitCode: 1,
        rateLimited: true,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.rateLimited).toBe(true);
      // No marker file → default wait
      expect(result.waitSeconds).toBe(300);
    });

    it('reads wait seconds from line 2 of the rate-limit-hit marker', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
        rateLimited: true,
      });
      await writeFile(join(pipeDir, 'rate-limit-hit'), 'timestamp\n450\n', 'utf-8');
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.waitSeconds).toBe(450);
    });

    it('surfaces sessionExpired=true when provider reports it', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'No conversation found with id abc',
        exitCode: 1,
        sessionExpired: true,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.sessionExpired).toBe(true);
    });
  });

  describe('resetSession', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-reset-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('deletes session-created marker and writes a fresh session ID', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // Simulate a prior successful autonomous run that wrote the marker.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'session-1', 'utf-8');

      await runner.resetSession();

      // Marker gone
      const stillExists = await access(join(pipeDir, 'session-created'))
        .then(() => true, () => false);
      expect(stillExists).toBe(false);

      // Fresh session ID persisted
      const newId = (await readFile(join(pipeDir, 'conduct-session-id'), 'utf-8')).trim();
      expect(newId).not.toBe('session-1');
      expect(newId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('tolerates resetSession when the marker never existed', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });
      await expect(runner.resetSession()).resolves.toBeUndefined();
    });

    it('after reset, next autonomous run uses --session-id (not --resume)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // First run — creates session
      await runner.run('worktree', emptyState);
      // Second run — would normally use resume (sessionStarted=true)
      await runner.run('memory', emptyState);

      // Reset and run again — should go back to resume=false. Use a
      // per-feature step (bootstrap/assess are project-level preludes, not in
      // ALL_STEPS — see runProjectPrelude).
      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState);

      const calls = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0].resume).toBe(false);  // first
      expect(calls[1][0].resume).toBe(true);   // second
      expect(calls[2][0].resume).toBe(false);  // post-reset
    });
  });

  describe('interactive REPL dispatch for conversational steps', () => {
    const replSteps: StepName[] = [
      'brainstorm',
      'stories',
      'plan',
      'architecture_review',
      'manual_test',
      'finish',
    ];

    for (const step of replSteps) {
      it(`${step}: passes interactive: true when mode is 'default'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(true);
      });

      it(`${step}: does NOT pass interactive: true when mode is 'auto'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'auto',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      });
    }

    it('complexity-adjacent one-shot steps stay print-mode even in default mode', async () => {
      const oneShotSteps: StepName[] = [
        'conflict_check',
        'architecture_diagram',
        'retro',
      ];
      for (const step of oneShotSteps) {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      }
    });

    it('default mode is the default when options.mode is absent', async () => {
      const provider = createMockProvider();
      // No options → mode defaults to 'default'
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.run('brainstorm', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(true);
    });
  });
});
