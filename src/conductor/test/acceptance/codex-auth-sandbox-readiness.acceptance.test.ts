/**
 * RED acceptance specs for #905. These drive the real Codex provider entrypoint
 * and mock only its external Codex CLI process boundary. They deliberately fail
 * until the approved readiness, source, policy, and sanitization contract exists.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);
const secret = 'sk-905-secret-never-log';
const base: InvokeOptions = {
  prompt: 'Implement the approved change.',
  sessionId: 'codex-905-session',
  resume: false,
  cwd: '/workspace/feature-905',
};

function doctorReady() {
  return JSON.stringify({
    schemaVersion: 1,
    auth: { selectedMode: 'cached-login', configured: true },
    transport: { authenticated: true },
  });
}

describe('acceptance: Codex auth and bounded unattended execution (#905)', () => {
  let priorKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    priorKey = process.env.CODEX_API_KEY;
    delete process.env.CODEX_API_KEY;
  });

  afterEach(() => {
    if (priorKey === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = priorKey;
  });

  // Covers: FR-1, FR-6, FR-7, FR-8, FR-9
  it('freshly probes cached login before every unattended initial and resumed execution', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'resumed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);
    await provider.invoke({ ...base, resume: true });

    expect(mockExeca).toHaveBeenCalledTimes(4);
    for (const index of [0, 2]) {
      const [command, args] = mockExeca.mock.calls[index] as [string, string[]];
      expect(command).toBe('codex');
      expect(args).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    }
  });

  // Covers: FR-2, FR-3, FR-4, FR-5, FR-12
  it('selects a supplied API key for both readiness and execution without exposing it', async () => {
    process.env.CODEX_API_KEY = secret;
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    const result = await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(2);
    for (const [, args, options] of mockExeca.mock.calls as Array<[string, string[], any]>) {
      expect(args).not.toContain(secret);
      expect(options.env?.CODEX_API_KEY).toBe(secret);
    }
    expect(result.output).not.toContain(secret);
  });

  // Covers: FR-10, FR-11, FR-19, FR-20, FR-22
  it('fails closed on rejected selected authentication without dispatching or falling back', async () => {
    process.env.CODEX_API_KEY = secret;
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'api-key', configured: true, rejected: true } }),
      stderr: `401 invalid key ${secret}`,
      exitCode: 1,
    } as any);
    const provider = new CodexProvider();

    const result = await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(1);
    const [, args] = mockExeca.mock.calls[0] as [string, string[]];
    expect(args).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    expect(args).not.toContain('exec');
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/codex.*api-key.*unusable/i);
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toMatch(/claude|anthropic/i);
  });

  // Covers: FR-13, FR-14, FR-15, FR-16, FR-17, FR-18
  it('applies the same explicit bounded policy on initial and resumed unattended calls', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'resumed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);
    await provider.invoke({ ...base, resume: true });

    for (const index of [1, 3]) {
      const [, args] = mockExeca.mock.calls[index] as [string, string[]];
      expect(args).toEqual(expect.arrayContaining([
        'sandbox_mode="workspace-write"',
        'approval_policy="on-request"',
        'approvals_reviewer="auto_review"',
        'shell_environment_policy.ignore_default_excludes=false',
      ]));
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    }
  });

  // Covers: FR-21
  it('keeps the Codex readiness and policy boundary self-host compatible without Claude configuration', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: doctorReady(), stderr: '', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'completed', stderr: '', exitCode: 0 } as any);
    const provider = new CodexProvider();

    await provider.invoke(base);

    expect(mockExeca).toHaveBeenCalledTimes(2);
    const [doctorCommand, doctorArgs, doctorOptions] = mockExeca.mock.calls[0] as [string, string[], any];
    const [, execArgs, execOptions] = mockExeca.mock.calls[1] as [string, string[], any];
    expect(doctorCommand).toBe('codex');
    expect(doctorArgs).toEqual(expect.arrayContaining(['doctor', '--json', '--summary']));
    expect(execArgs).toEqual(expect.arrayContaining(['approvals_reviewer="auto_review"']));
    expect(doctorOptions.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(doctorOptions.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(execOptions.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(execOptions.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
