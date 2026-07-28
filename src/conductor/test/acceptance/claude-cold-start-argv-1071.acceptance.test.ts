/**
 * RED acceptance spec — a Claude resume invocation is structurally
 * unconstructable (#1071, story ST-1071-1 happy path bullet 1 and negative
 * path 1; ST-1071-3 negative path 2 for the legacy `SessionManager` argv).
 *
 * Track: technical (no PRD) — no FR-coverage table applies.
 *
 * This is the replacement-task guard (§3b) and the per-call-site adversarial
 * derivation guard (§3d): it drives the REAL production entry points with the
 * adversarial input the upstream capability gate is supposed to make
 * impossible (`resume: true`, or a `session-created` marker already on disk),
 * and asserts the observable artifact — the argv handed to the Claude CLI —
 * rather than a return value in isolation. It fails while the `--resume`
 * branch exists even if every upstream gate is already correct.
 *
 * Production call sites of the Claude resume argv derivation (§3d):
 *   - src/conductor/src/execution/claude-provider.ts:505 `invoke`
 *   - src/conductor/src/execution/claude-provider.ts:561 `invokeInteractive`
 *     (both reach the private `buildArgs` at :669-677, the `--resume` branch)
 *   - src/conductor/src/execution/session.ts:80-100 `buildClaudeArgs`, the
 *     legacy `SessionManager` argv used by the scalar dispatch path.
 *
 * The Claude CLI itself is faked at the execa boundary; no real binary runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { SessionManager } from '../../src/execution/session.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn<
    (
      file: string,
      args: readonly string[],
      options: ExecaOptions,
    ) => Promise<ExecaResult>
  >(),
}));
vi.mock('execa', () => ({ execa: mockExeca }));

const baseOptions: InvokeOptions = {
  prompt: 'Make the no-op change',
  systemPrompt: 'You are the conductor.',
  sessionId: 'harness-minted-uuid-v4',
  // The adversarial input: a caller that asks for a resume directly, bypassing
  // every upstream gate. The invariant must hold structurally.
  resume: true,
  cwd: '/workspace/project',
};

function claudeJsonResult(text: string) {
  return {
    stdout: JSON.stringify({
      type: 'result',
      result: text,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    exitCode: 0,
  };
}

describe('ClaudeProvider argv never expresses a session resume (#1071)', () => {
  let provider: ClaudeProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    mockExeca.mockResolvedValue(claudeJsonResult('cold start') as never);
    provider = new ClaudeProvider();
  });

  it('emits --session-id and never --resume at BOTH entry points, even when handed resume: true', async () => {
    await provider.invoke({ ...baseOptions });
    await provider.invokeInteractive({ ...baseOptions, interactive: false });

    const observed = mockExeca.mock.calls.map(([, args]) => ({
      resumeFlag: args.includes('--resume'),
      sessionIdFlag: args.includes('--session-id'),
      idFollowsSessionIdFlag:
        args[args.indexOf('--session-id') + 1] === baseOptions.sessionId,
    }));

    expect(observed).toEqual([
      { resumeFlag: false, sessionIdFlag: true, idFollowsSessionIdFlag: true },
      { resumeFlag: false, sessionIdFlag: true, idFollowsSessionIdFlag: true },
    ]);
  });

  it('keeps every other argv element intact on a cold start', async () => {
    await provider.invoke({
      ...baseOptions,
      model: 'opus',
      dangerouslySkipPermissions: true,
      sessionName: 'build-attempt-2',
    });

    const [, args] = mockExeca.mock.calls[0];
    expect(args.slice(0, 2)).toEqual(['--session-id', 'harness-minted-uuid-v4']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--dangerously-skip-permissions',
        '--name',
        'build-attempt-2',
        '--append-system-prompt',
        'You are the conductor.',
        '--model',
        'opus',
        '--print',
        '--output-format',
        'json',
      ]),
    );
    expect(args).not.toContain('--resume');
  });

  it('cold-starts an interactive REPL dispatch too — the recovery path cannot resume either', async () => {
    await provider.invokeInteractive({
      ...baseOptions,
      interactive: true,
      resume: true,
    });

    const [, args] = mockExeca.mock.calls[0];
    expect({
      resumeFlag: args.includes('--resume'),
      sessionIdFlag: args.includes('--session-id'),
    }).toEqual({ resumeFlag: false, sessionIdFlag: true });
  });
});

describe('SessionManager.buildClaudeArgs never expresses a session resume (#1071)', () => {
  let dir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'cold-start-session-manager-'));
  });

  it('emits --session-id after the created marker is set, and still persists the marker', async () => {
    const manager = new SessionManager(join(dir, '.pipeline'));
    await manager.getSessionId();
    // The adversarial state: this process has already dispatched once, so the
    // legacy marker says "created". Today that alone produces `--resume`.
    await manager.markSessionCreated();

    const autonomous = manager.buildClaudeArgs({ interactive: false });
    const interactive = manager.buildClaudeArgs({ interactive: true });

    expect({
      autonomousResume: autonomous.includes('--resume'),
      autonomousSessionId: autonomous.includes('--session-id'),
      interactiveResume: interactive.includes('--resume'),
      interactiveSessionId: interactive.includes('--session-id'),
      markerStillPersisted: existsSync(
        join(dir, '.pipeline', 'session-created'),
      ),
      markerStillReported: await manager.isSessionCreated(),
    }).toEqual({
      autonomousResume: false,
      autonomousSessionId: true,
      interactiveResume: false,
      interactiveSessionId: true,
      // The marker keeps its persistence contract; only its consequence changes.
      markerStillPersisted: true,
      markerStillReported: true,
    });

    await rm(dir, { recursive: true, force: true });
  });
});

describe('the session-rejection safety net survives the change (#1071, ST-1071-5)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('still classifies "already in use" and "No conversation found" as sessionExpired', async () => {
    const provider = new ClaudeProvider();
    const outputs = [
      'Error: session ID harness-minted-uuid-v4 is already in use',
      'No conversation found with session ID harness-minted-uuid-v4',
    ];
    const classified: Array<boolean | undefined> = [];

    for (const output of outputs) {
      mockExeca.mockResolvedValueOnce({ stdout: output, exitCode: 1 } as never);
      const result = await provider.invoke({ ...baseOptions, resume: false });
      classified.push(result.sessionExpired);
    }

    expect(classified).toEqual([true, true]);
  });
});
