import { describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { enforceFreshSessionOptions } from '../../src/execution/fresh-session.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// Fresh-session enforcement at the provider adapter boundary. Session reuse
// was removed from this harness by design; on 2026-08-14 a store-derived
// session id resurrected a ~1.28M-token resumed conversation shared across
// all four build_review rubric branches. These tests pin the deterministic
// boundary invariant: a fresh session id and resume:false on every
// invocation, with `dangerouslyReuseSession: true` as the only override.

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
    await provider.invokeInteractive({ ...baseOptions, interactive: false });

    const ids = calls.map(sessionIdFromArgs);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('enforces the same invariant on the interactive entry', async () => {
    const { calls, provider } = claudeCapture();

    await provider.invokeInteractive({ ...baseOptions, interactive: false });

    const args = calls[0]!;
    expect(sessionIdFromArgs(args)).not.toBe('caller-reused-session-id');
    expect(args).not.toContain('--resume');
  });

  it('preserves the supplied session id only through the explicit dangerouslyReuseSession valve', async () => {
    const { calls, provider } = claudeCapture();

    await provider.invoke({ ...baseOptions, dangerouslyReuseSession: true });

    expect(sessionIdFromArgs(calls[0]!)).toBe('caller-reused-session-id');
  });

  it('reports each replacement through the threaded diagnostic channel', async () => {
    const { provider } = claudeCapture();
    const diagnosticLog = vi.fn();

    await provider.invoke({ ...baseOptions, diagnosticLog });

    const notice = diagnosticLog.mock.calls
      .map(([message]) => message as string)
      .find((message) => message.includes('caller-reused-session-id'));
    expect(notice).toContain('fresh session');
    expect(notice).toContain('suppressed resume');
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
        stdout: JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Done.' },
        }),
        stderr: '',
        exitCode: 0,
        failed: false,
      }) as any;
    });
    return { argv, provider: new CodexProvider(runDoctor, 'codex', undefined, subprocessFactory as any) };
  }

  it('never forwards the caller-supplied session id and reports the replacement', async () => {
    const { argv, provider } = codexCapture();
    const diagnosticLog = vi.fn();

    const result = await provider.invoke({ ...baseOptions, diagnosticLog });

    expect(result.success).toBe(true);
    expect(argv[0]!.join(' ')).not.toContain('caller-reused-session-id');
    const notice = diagnosticLog.mock.calls
      .map(([message]) => message as string)
      .find((message) => message.includes('caller-reused-session-id'));
    expect(notice).toContain('fresh session');
  });
});

describe('enforceFreshSessionOptions', () => {
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

  it('leaves options untouched only when dangerouslyReuseSession is exactly true', () => {
    const reused = enforceFreshSessionOptions(
      { ...baseOptions, dangerouslyReuseSession: true },
      'claude',
    );
    expect(reused.sessionId).toBe('caller-reused-session-id');
    expect(reused.resume).toBe(true);

    const truthyButNotTrue = enforceFreshSessionOptions(
      { ...baseOptions, dangerouslyReuseSession: 1 as unknown as boolean },
      'claude',
    );
    expect(truthyButNotTrue.sessionId).not.toBe('caller-reused-session-id');
    expect(truthyButNotTrue.resume).toBe(false);
  });

  it('warns on console only for an actual resume suppression when no diagnostic log is threaded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      enforceFreshSessionOptions({ ...baseOptions, resume: false }, 'claude');
      expect(warn).not.toHaveBeenCalled();

      enforceFreshSessionOptions(baseOptions, 'claude');
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain('suppressed resume');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('dangerouslyReuseSession stays a dead valve in production code', () => {
  it('appears only in the type definition and the boundary enforcement module', async () => {
    const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url));
    const allowed = new Set([
      'execution/llm-provider.ts', // InvokeOptions field declaration
      'execution/fresh-session.ts', // the enforcement check itself
    ]);

    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const absolute = join(entry.parentPath, entry.name);
      const relative = absolute.slice(sourceRoot.length + 1).split('\\').join('/');
      if (relative.startsWith('dist-versions/')) continue;
      const content = await readFile(absolute, 'utf-8');
      if (!content.includes('dangerouslyReuseSession')) continue;
      if (!allowed.has(relative)) offenders.push(relative);
    }

    expect(offenders).toEqual([]);
  });
});
