import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import {
  DefaultStepRunner,
  parseRebaseResolutionOutput,
} from '../../src/engine/step-runners.js';
import type { ResolutionContext } from '../../src/engine/rebase.js';

// ── Stub boundary ─────────────────────────────────────────────────────────────
// Tests stub `provider.invoke` — the same seam used by all other step-runner
// tests. No real `claude` binary is spawned. `invokeInteractive` is provided
// but should never be called by resolveRebaseConflict.

function makeProvider(invokeResult: Partial<InvokeResult> = {}): LLMProvider {
  const defaults: InvokeResult = { success: true, output: '', exitCode: 0 };
  return {
    invoke: vi.fn().mockResolvedValue({ ...defaults, ...invokeResult }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

const sampleCtx: ResolutionContext = {
  conflicts: ['src/foo.ts', 'src/bar.ts'],
  projectRoot: '/wt/feature-x',
  baseRef: 'abc1234',
};

// ── parseRebaseResolutionOutput (unit) ────────────────────────────────────────

describe('parseRebaseResolutionOutput', () => {
  it('returns {resolved:true} when stdout ends with {"resolved": true}', () => {
    const result = parseRebaseResolutionOutput('Some log output\n{"resolved": true}');
    expect(result).toEqual({ resolved: true });
  });

  it('returns {resolved:false, reason} when stdout has {"resolved": false, "reason": "..."}', () => {
    const result = parseRebaseResolutionOutput(
      'log lines\n{"resolved": false, "reason": "needs human"}',
    );
    expect(result).toEqual({ resolved: false, reason: 'needs human' });
  });

  it('parses the LAST JSON object when extra log lines appear before it (last wins)', () => {
    const output =
      'Checking status...\n' +
      'Some intermediate note {"foo": 1}\n' +
      'Resolving conflict in src/foo.ts\n' +
      '{"resolved": true}';
    const result = parseRebaseResolutionOutput(output);
    expect(result).toEqual({ resolved: true });
  });

  it('returns {resolved:false} with non-empty reason when stdout has no parseable JSON', () => {
    const result = parseRebaseResolutionOutput('just some prose\nno json here');
    expect(result.resolved).toBe(false);
    expect(typeof (result as { resolved: false; reason: string }).reason).toBe('string');
    expect((result as { resolved: false; reason: string }).reason.length).toBeGreaterThan(0);
  });

  it('returns {resolved:false} with non-empty reason on empty output', () => {
    const result = parseRebaseResolutionOutput('');
    expect(result.resolved).toBe(false);
    expect((result as { resolved: false; reason: string }).reason.length).toBeGreaterThan(0);
  });

  it('returns {resolved:false} for JSON without a boolean resolved field', () => {
    const result = parseRebaseResolutionOutput('{"status": "ok"}');
    expect(result.resolved).toBe(false);
  });

  it('treats {"resolved": false} with no reason as unspecified (not empty string)', () => {
    const result = parseRebaseResolutionOutput('{"resolved": false}');
    expect(result.resolved).toBe(false);
    const r = result as { resolved: false; reason: string };
    expect(r.reason).toBe('unspecified');
  });

  it('never returns {resolved:true} when the last JSON line is resolved:false', () => {
    const output =
      '{"resolved": true}\n' +
      'More output\n' +
      '{"resolved": false, "reason": "conflict too complex"}';
    const result = parseRebaseResolutionOutput(output);
    expect(result.resolved).toBe(false);
    expect((result as { resolved: false; reason: string }).reason).toBe('conflict too complex');
  });
});

// ── DefaultStepRunner.resolveRebaseConflict (integration with stubbed provider)

describe('DefaultStepRunner.resolveRebaseConflict', () => {
  it('returns {resolved:true} when skill stdout ends with {"resolved": true}', async () => {
    const provider = makeProvider({ success: true, output: 'log\n{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    const result = await runner.resolveRebaseConflict(sampleCtx);

    expect(result).toEqual({ resolved: true });
    expect(provider.invoke).toHaveBeenCalledOnce();
    expect(provider.invokeInteractive).not.toHaveBeenCalled();
  });

  it('returns {resolved:false, reason} when skill reports false', async () => {
    const provider = makeProvider({
      success: false,
      output: 'some log\n{"resolved": false, "reason": "needs human"}',
      exitCode: 1,
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    const result = await runner.resolveRebaseConflict(sampleCtx);

    expect(result).toEqual({ resolved: false, reason: 'needs human' });
  });

  it('parses true from stdout with extra log lines before the final JSON', async () => {
    const output =
      'Checking rebase state...\n' +
      'Resolving src/foo.ts\n' +
      'Running git add src/foo.ts\n' +
      'Running git rebase --continue\n' +
      '{"resolved": true}';
    const provider = makeProvider({ success: true, output, exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    const result = await runner.resolveRebaseConflict(sampleCtx);

    expect(result).toEqual({ resolved: true });
  });

  it('returns {resolved:false} with non-empty reason when stdout has no parseable JSON', async () => {
    const provider = makeProvider({ success: true, output: 'some prose, no JSON at all', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    const result = await runner.resolveRebaseConflict(sampleCtx);

    expect(result.resolved).toBe(false);
    const reason = (result as { resolved: false; reason: string }).reason;
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
    // Critically: never claim success on garbage output
    expect(result.resolved).not.toBe(true);
  });

  it('dispatches the /rebase skill prompt (not a regular step prompt)', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict(sampleCtx);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toBe('/rebase');
  });

  it('runs with dangerouslySkipPermissions: true (unattended)', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict(sampleCtx);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('uses ctx.projectRoot as cwd (runs in the conflicted worktree)', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict({ ...sampleCtx, projectRoot: '/wt/conflict-worktree' });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/conflict-worktree');
  });

  it('uses resume:false (fresh one-shot session, not the main conductor session)', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict(sampleCtx);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.resume).toBe(false);
  });

  it('uses a different session ID from the main conductor session', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'conductor-session-id', '/wt/feature-x');

    await runner.resolveRebaseConflict(sampleCtx);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.sessionId).not.toBe('conductor-session-id');
  });

  it('includes conflicted files in the system prompt', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict({ ...sampleCtx, conflicts: ['src/auth.ts'] });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('src/auth.ts');
  });

  it('includes the baseRef in the system prompt', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');

    await runner.resolveRebaseConflict({ ...sampleCtx, baseRef: 'deadbeef' });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('deadbeef');
  });

  it('does not advance callCount (isolated from main step dispatch)', async () => {
    const provider = makeProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    const countBefore = runner.callCount;

    await runner.resolveRebaseConflict(sampleCtx);

    // resolveRebaseConflict is a one-shot helper — it must not increment the
    // main step call count (which drives cooldown escalation).
    expect(runner.callCount).toBe(countBefore);
  });
});
