import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { enforceFreshSessionOptions } from '../../src/execution/fresh-session.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// Fresh-session enforcement at the provider adapter boundary. Session reuse
// was removed from this harness by design; on 2026-08-14 a store-derived
// session id resurrected a ~1.28M-token resumed conversation shared across
// all four build_review rubric branches. These tests pin the deterministic
// boundary invariant: a fresh session id and resume:false on every
// invocation.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseOptions: InvokeOptions = {
  prompt: 'Do the thing',
  sessionId: 'caller-reused-session-id',
  resume: true,
};

function claudeCapture() {
  const calls: string[][] = [];
  const subprocessFactory = vi.fn((_file: string, args: readonly string[]) => {
    calls.push([...args]);
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, failed: false }) as any;
  });
  return { calls, provider: new ClaudeProvider(undefined, subprocessFactory) };
}

function sessionIdFromArgs(args: string[]): string {
  const index = args.indexOf('--session-id');
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1]!;
}

describe('fresh-session enforcement (claude adapter)', () => {
  it('replaces a caller-supplied session id with a fresh UUID and never passes a resume flag', async () => {
    const { calls, provider } = claudeCapture();

    await provider.invoke(baseOptions);

    const args = calls[0]!;
    const sessionId = sessionIdFromArgs(args);
    expect(sessionId).not.toBe('caller-reused-session-id');
    expect(sessionId).toMatch(UUID_RE);
    expect(args).not.toContain('--resume');
  });

  it('never lets two invocations share a session id, even for identical options', async () => {
    const { calls, provider } = claudeCapture();

    await provider.invoke(baseOptions);
    await provider.invoke(baseOptions);
    await provider.invoke({ ...baseOptions, interactive: false });

    const ids = calls.map(sessionIdFromArgs);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('enforces the same invariant on the interactive entry', async () => {
    const { calls, provider } = claudeCapture();

    await provider.invoke({ ...baseOptions, interactive: false });

    const args = calls[0]!;
    expect(sessionIdFromArgs(args)).not.toBe('caller-reused-session-id');
    expect(args).not.toContain('--resume');
  });

  // Covers: task:18
  it('reports resume suppression through the threaded diagnostic channel', async () => {
    const { provider } = claudeCapture();
    const diagnosticLog = vi.fn();

    await provider.invoke({ ...baseOptions, diagnosticLog });

    const notice = diagnosticLog.mock.calls
      .map(([message]) => message as string)
      .find((message) => message.includes('resume was suppressed'));
    expect(notice).toContain('no action needed');
  });
});

describe('fresh-session enforcement (codex adapter)', () => {
  function codexCapture() {
    const runDoctor = vi.fn(async () => ({
      stdout: JSON.stringify({
        schemaVersion: 1,
        auth: { selectedMode: 'cached-login', configured: true },
        transport: { authenticated: true },
      }),
      exitCode: 0,
    }));
    const argv: string[][] = [];
    const subprocessFactory = vi.fn((_file: string, args: readonly string[]) => {
      argv.push([...args]);
      return Promise.resolve({
        stdout: [
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'Done.' },
          }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'),
        stderr: '',
        exitCode: 0,
        failed: false,
      }) as any;
    });
    return { argv, provider: new CodexProvider(runDoctor, 'codex', undefined, subprocessFactory as any) };
  }

  // Covers: task:18
  it('never forwards the caller-supplied session id and reports resume suppression', async () => {
    const { argv, provider } = codexCapture();
    const diagnosticLog = vi.fn();

    const result = await provider.invoke({ ...baseOptions, diagnosticLog });

    expect(result.success).toBe(true);
    expect(argv[0]!.join(' ')).not.toContain('caller-reused-session-id');
    const notice = diagnosticLog.mock.calls
      .map(([message]) => message as string)
      .find((message) => message.includes('resume was suppressed'));
    expect(notice).toContain('no action needed');
  });
});

describe('enforceFreshSessionOptions', () => {
  // Covers: task:18
  it('keeps routine fresh-session replacement silent', () => {
    const diagnosticLog = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const enforced = enforceFreshSessionOptions(
        { ...baseOptions, resume: false, diagnosticLog },
        'claude',
      );

      expect(enforced.sessionId).toMatch(UUID_RE);
      expect(enforced.sessionId).not.toBe(baseOptions.sessionId);
      expect(enforced.resume).toBe(false);
      expect(diagnosticLog).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Covers: task:18
  it('reports resume suppression through diagnostics with the no-action suffix', () => {
    const diagnosticLog = vi.fn();

    const enforced = enforceFreshSessionOptions({ ...baseOptions, diagnosticLog }, 'claude');

    expect(enforced.resume).toBe(false);
    expect(diagnosticLog).toHaveBeenCalledOnce();
    const [notice] = diagnosticLog.mock.calls[0]! as [string];
    expect(notice).toContain('resume was suppressed');
    expect(notice).toMatch(
      / — no action needed: every provider dispatch starts a fresh session by design$/,
    );
  });

  it('mints a unique fresh UUID and forces resume off on every call', () => {
    const first = enforceFreshSessionOptions(baseOptions, 'claude');
    const second = enforceFreshSessionOptions(baseOptions, 'claude');

    for (const enforced of [first, second]) {
      expect(enforced.sessionId).toMatch(UUID_RE);
      expect(enforced.sessionId).not.toBe(baseOptions.sessionId);
      expect(enforced.resume).toBe(false);
    }
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it('warns on console only for an actual resume suppression when no diagnostic log is threaded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      enforceFreshSessionOptions({ ...baseOptions, resume: false }, 'claude');
      expect(warn).not.toHaveBeenCalled();

      enforceFreshSessionOptions(baseOptions, 'claude');
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain('resume was suppressed');
    } finally {
      warn.mockRestore();
    }
  });
});
