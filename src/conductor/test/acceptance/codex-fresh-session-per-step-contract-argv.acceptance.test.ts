/**
 * RED acceptance spec — a Codex resume invocation is structurally
 * unconstructable (#903, story S1 happy path bullets 4–5).
 *
 * This is the replacement-task guard (§3b): it drives the REAL provider entry
 * points — `CodexProvider.invoke` (codex-provider.ts:172) and
 * `CodexProvider.invokeInteractive` (:224) — with the adversarial input the
 * capability gate is supposed to make impossible (`resume: true`), and asserts
 * the observable artifact: the argv handed to the Codex CLI. It fails while the
 * `exec resume` branch (codex-provider.ts:524-526) still exists, even if the
 * upstream gate is already correct.
 *
 * The Codex CLI itself is faked at the execa boundary; no real binary runs.
 * The opt-in real-CLI probe lives in test/execution/codex-provider.smoke.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';

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
  resume: true,
  cwd: '/workspace/project',
};

function jsonlMessage(text: string): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: 'codex-minted-thread' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join('\n');
}

function readyDoctorResult() {
  return {
    stdout: JSON.stringify({
      schemaVersion: 1,
      auth: { selectedMode: 'cached-login', configured: true },
      transport: { authenticated: true },
    }),
    exitCode: 0,
  };
}

describe('CodexProvider argv never expresses a session resume', () => {
  let provider: CodexProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = new CodexProvider(vi.fn(async () => readyDoctorResult()) as never);
  });

  it('starts a cold `exec` at both call sites even when handed resume: true', async () => {
    mockExeca.mockResolvedValue({
      stdout: jsonlMessage('cold start'),
      exitCode: 0,
    } as never);

    await provider.invoke({ ...baseOptions });
    await provider.invokeInteractive({ ...baseOptions, interactive: false });

    const observed = mockExeca.mock.calls.map(([, args]) => ({
      head: args[0],
      resumeVerb: args.includes('resume'),
      leaksSessionId: args.includes(baseOptions.sessionId),
      cwdFlag: args.includes('--cd') && args[args.indexOf('--cd') + 1] === '/workspace/project',
      stdinSentinel: args[args.length - 1],
    }));

    expect(observed).toEqual([
      { head: 'exec', resumeVerb: false, leaksSessionId: false, cwdFlag: true, stdinSentinel: '-' },
      { head: 'exec', resumeVerb: false, leaksSessionId: false, cwdFlag: true, stdinSentinel: '-' },
    ]);
  });

  it('keeps the model/effort argv and the stdin sentinel in order on a cold start', async () => {
    mockExeca.mockResolvedValue({
      stdout: jsonlMessage('ordered'),
      exitCode: 0,
    } as never);

    await provider.invoke({ ...baseOptions, model: 'gpt-5.4', effort: 'high' });

    const [, args] = mockExeca.mock.calls[0];
    expect(args.slice(0, 6)).toEqual([
      'exec',
      '--model',
      'gpt-5.4',
      '--config',
      'model_reasoning_effort="high"',
      '--config',
    ]);
    expect(args).toEqual(
      expect.arrayContaining(['--cd', '/workspace/project', '--json']),
    );
    expect(args[args.length - 1]).toBe('-');
  });
});
