import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, InvokeOptions } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { dispatchAttributionVerifier } from '../../src/engine/attribution-lane.js';

// ── Fresh-session verifier dispatch (Task 7) ──────────────────────────────
//
// The attribution verifier runs in a fresh, isolated session — never resumes
// the main conductor session. It follows the same one-shot pattern as
// runBuildReview: fresh uuid, resume: false, walked through the model fallback
// ladder. Dispatch creates the session with proper step ID and CWD configuration.

describe('dispatchAttributionVerifier', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-verifier-'));
    planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      `# Plan

## Task 1
Implement the sweep feature.

**Files:** src/sweep.ts

## Task 2
Add tests for sweep.

**Files:** test/sweep.test.ts
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dispatches with a fresh uuid and resume:false, never the conductor session', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{"schema": 1}',
      exitCode: 0,
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
    });

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.resume).toBe(false);
    expect(opts.sessionId).toBeTruthy();
    // A real uuid, not empty/undefined.
    expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses step ID attribution_verify', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{"schema": 1}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    // The system prompt should reference the step name or ID
    expect(opts.systemPrompt).toBeTruthy();
    expect(opts.systemPrompt).toContain('attribution_verify');
  });

  it('sets session CWD to feature worktree', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const featureWorktreeDir = join(dir, 'feature-worktree');
    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: featureWorktreeDir,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe(featureWorktreeDir);
  });

  it('resolves model and effort from config', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const config: HarnessConfig = {
      model_fallback_ladder: ['claude-opus', 'claude-sonnet'],
      steps: {
        attribution_verify: {
          model: 'claude-opus',
          effort: 'medium',
        },
      },
    };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      config,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.model).toBe('claude-opus');
    expect(opts.effort).toBe('medium');
  });

  it('includes residue tasks and candidate commits in prompt', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toBeTruthy();
    // Prompt should include residue task sections
    expect(opts.prompt).toContain('Residue Tasks for Attribution Verification');
  });

  it('uses dangerouslySkipPermissions:true for isolated dispatch', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('returns success when invoke succeeds', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'attribution complete',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('attribution complete');
  });

  it('returns failure on rate limit', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'rate limited',
      rateLimited: true,
      waitSeconds: 60,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    expect(result.success).toBe(false);
    expect(result.rateLimited).toBe(true);
    expect(result.waitSeconds).toBe(60);
  });

  it('returns failure on auth failure', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'auth failed',
      authFailure: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    expect(result.success).toBe(false);
    expect(result.authFailure).toBe(true);
  });

  it('returns failure on session expired', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'session expired',
      sessionExpired: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
    });

    expect(result.success).toBe(false);
    expect(result.sessionExpired).toBe(true);
  });

  it('names attempted models on full ladder exhaustion', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'no models available',
      modelUnavailable: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const config: HarnessConfig = {
      model_fallback_ladder: ['claude-opus', 'claude-sonnet', 'claude-haiku'],
      steps: {
        attribution_verify: {
          model: 'claude-opus',
          effort: 'medium',
        },
      },
    };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      config,
    });

    expect(result.success).toBe(false);
    // Output should indicate multiple models were tried
    expect(result.output).toMatch(/model fallback ladder exhausted/i);
  });
});
