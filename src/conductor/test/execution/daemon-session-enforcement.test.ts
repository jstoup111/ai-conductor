import { describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import {
  DAEMON_SESSION_MARKER,
  guardDaemonSessionInvocation,
  withDaemonSessionMarker,
} from '../../src/execution/daemon-session.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// Daemon-session boundary enforcement. Engine-dispatched maker sessions have
// attempted to run conduct-ts themselves (including daemon park/unpark/
// restart and reseal). These tests pin the two deterministic seams: every
// provider child session env carries CONDUCT_DAEMON_SESSION=1, and the
// conduct-ts entry guard refuses invocations carrying the marker except the
// session-sanctioned worker subcommands the harness's own skills mandate.

const argvFor = (...rest: string[]): string[] => ['node', 'conduct-ts', ...rest];
const markedEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  [DAEMON_SESSION_MARKER]: '1',
  ...extra,
});

describe('guardDaemonSessionInvocation', () => {
  it('refuses any conductor invocation when the daemon-session marker is set', () => {
    for (const argv of [
      argvFor('daemon', 'park', 'some-slug'),
      argvFor('daemon', 'restart'),
      argvFor('reseal', '--feature', 'x'),
      argvFor('shipped-record', '--slug', 'x', '--pr', 'url'),
      argvFor('engineer'),
      argvFor('--interactive'),
      argvFor(),
    ]) {
      const verdict = guardDaemonSessionInvocation(argv, markedEnv());
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) {
        expect(verdict.message).toContain(
          'conduct-ts may not be invoked from inside a daemon-managed session',
        );
        expect(verdict.message).toContain(
          'the engine owns all conductor operations for this run',
        );
      }
    }
  });

  it('names the blocked subcommand in the refusal', () => {
    const verdict = guardDaemonSessionInvocation(
      argvFor('daemon', 'park', 'slug'),
      markedEnv(),
    );
    expect(verdict).toEqual({
      allowed: false,
      message: expect.stringContaining('blocked subcommand: daemon'),
    });
  });

  it('allows normal dispatch when the marker is unset (or not exactly "1")', () => {
    expect(guardDaemonSessionInvocation(argvFor('daemon', 'status'), {})).toEqual({ allowed: true });
    expect(
      guardDaemonSessionInvocation(argvFor('daemon', 'status'), { [DAEMON_SESSION_MARKER]: '' }),
    ).toEqual({ allowed: true });
    expect(
      guardDaemonSessionInvocation(argvFor('daemon', 'status'), { [DAEMON_SESSION_MARKER]: 'true' }),
    ).toEqual({ allowed: true });
  });

  it('allows exactly the session-sanctioned worker subcommands under the marker', () => {
    for (const sanctioned of [
      argvFor('scoped-run', 'test/foo.test.ts'),
      argvFor('overlap-scan', '--files', 'a,b'),
      argvFor('plan-protected-targets', '.docs/plans/x.md'),
      argvFor('manual-test-record', '--skip', '--reason', 'r'),
      argvFor('closeout-event', 'evaluator', '1', '2'),
      argvFor('derive-feedback', '--sha', 'abc'),
    ]) {
      expect(guardDaemonSessionInvocation(sanctioned, markedEnv())).toEqual({ allowed: true });
    }
    // The sanctioned set is worker commands only — orchestration verbs stay blocked.
    expect(guardDaemonSessionInvocation(argvFor('task', 'done', 't1'), markedEnv()).allowed).toBe(false);
    expect(guardDaemonSessionInvocation(argvFor('test-suite'), markedEnv()).allowed).toBe(false);
  });

  it('honors the test-only unsafe valve only when exactly "1"', () => {
    expect(
      guardDaemonSessionInvocation(
        argvFor('daemon', 'park', 'slug'),
        markedEnv({ CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW: '1' }),
      ),
    ).toEqual({ allowed: true });
    expect(
      guardDaemonSessionInvocation(
        argvFor('daemon', 'park', 'slug'),
        markedEnv({ CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW: 'true' }),
      ).allowed,
    ).toBe(false);
  });
});

describe('withDaemonSessionMarker', () => {
  it('adds the marker without mutating the input env', () => {
    const input: NodeJS.ProcessEnv = { FOO: 'bar' };
    const marked = withDaemonSessionMarker(input);
    expect(marked).toEqual({ FOO: 'bar', [DAEMON_SESSION_MARKER]: '1' });
    expect(input[DAEMON_SESSION_MARKER]).toBeUndefined();
  });
});

// ── Marker injection at the provider adapter boundary ────────────────────────

type CapturedSpawn = { args: string[]; env: NodeJS.ProcessEnv | undefined };

const baseOptions: InvokeOptions = {
  prompt: 'Do the thing',
  sessionId: 'daemon-session-env-test',
  resume: false,
};

function claudeCapture() {
  const calls: CapturedSpawn[] = [];
  const subprocessFactory = vi.fn(
    (_file: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ args: [...args], env: options.env });
      return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, failed: false }) as any;
    },
  );
  return { calls, provider: new ClaudeProvider(undefined, subprocessFactory) };
}

function codexCapture() {
  const runDoctor = vi.fn(async () => ({
    stdout: JSON.stringify({
      schemaVersion: 1,
      auth: { selectedMode: 'cached-login', configured: true },
      transport: { authenticated: true },
    }),
    exitCode: 0,
  }));
  const calls: CapturedSpawn[] = [];
  const subprocessFactory = vi.fn(
    (_file: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ args: [...args], env: options.env });
      return Promise.resolve({
        stdout: JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Done.' },
        }),
        stderr: '',
        exitCode: 0,
        failed: false,
      }) as any;
    },
  );
  return { calls, provider: new CodexProvider(runDoctor, 'codex', undefined, subprocessFactory as any) };
}

describe('daemon-session marker injection (claude adapter)', () => {
  it('stamps CONDUCT_DAEMON_SESSION=1 into every invoke() session env', async () => {
    const { calls, provider } = claudeCapture();
    await provider.invoke(baseOptions);
    expect(calls[0]!.env?.[DAEMON_SESSION_MARKER]).toBe('1');
  });

  it('stamps the marker on the interactive entry too', async () => {
    const { calls, provider } = claudeCapture();
    await provider.invokeInteractive({ ...baseOptions, interactive: false });
    expect(calls[0]!.env?.[DAEMON_SESSION_MARKER]).toBe('1');
  });

  it('keeps self-host env additions and stamps the marker alongside them', async () => {
    const { calls, provider } = claudeCapture();
    await provider.invoke({
      ...baseOptions,
      effort: 'high',
      selfHost: {
        executable: 'claude',
        env: { CLAUDE_CONFIG_DIR: '/throwaway/home' },
        args: [],
        teardown: async () => {},
      },
    });
    const env = calls[0]!.env!;
    expect(env[DAEMON_SESSION_MARKER]).toBe('1');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/throwaway/home');
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
  });
});

describe('daemon-session marker injection (codex adapter)', () => {
  it('stamps CONDUCT_DAEMON_SESSION=1 into every invoke() session env', async () => {
    const { calls, provider } = codexCapture();
    const result = await provider.invoke(baseOptions);
    expect(result.success).toBe(true);
    expect(calls[0]!.env?.[DAEMON_SESSION_MARKER]).toBe('1');
  });

  it('stamps the marker on the interactive entry and preserves self-host env', async () => {
    const { calls, provider } = codexCapture();
    await provider.invokeInteractive({
      ...baseOptions,
      interactive: false,
      selfHost: {
        executable: 'codex',
        env: { CODEX_HOME: '/throwaway/home' },
        args: [],
        teardown: async () => {},
      },
    });
    const env = calls[0]!.env!;
    expect(env[DAEMON_SESSION_MARKER]).toBe('1');
    expect(env.CODEX_HOME).toBe('/throwaway/home');
  });
});

// ── Structural pins ──────────────────────────────────────────────────────────

describe('CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW stays a dead valve in production code', () => {
  it('appears only in the boundary enforcement module', async () => {
    const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url));
    const allowed = new Set([
      'execution/daemon-session.ts', // the enforcement check itself
    ]);

    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const absolute = join(entry.parentPath, entry.name);
      const relative = absolute.slice(sourceRoot.length + 1).split('\\').join('/');
      if (relative.startsWith('dist-versions/')) continue;
      const content = await readFile(absolute, 'utf-8');
      if (!content.includes('CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW')) continue;
      if (!allowed.has(relative)) offenders.push(relative);
    }

    expect(offenders).toEqual([]);
  });

  it('is wired at the conduct-ts entry before any subcommand detection', async () => {
    const indexSource = await readFile(
      fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      'utf-8',
    );
    const guardAt = indexSource.indexOf('guardDaemonSessionInvocation(process.argv)');
    const firstDetectAt = indexSource.indexOf('detectBuildReviewAcceptCommand(process.argv)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstDetectAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstDetectAt);
  });
});
