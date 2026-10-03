import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGhObserverFromEnvironment, runObservedGh, type GhObserverTransport } from '../../src/execution/gh-observer.js';
import { SessionEventProducer } from '../../src/execution/session-event-producer.js';

function producer() {
  return new SessionEventProducer({
    projectRoot: '/project', worktreeRoot: '/project/worktree', producerRoot: '/project/worktree/.pipeline/session-events/dispatch-1',
    dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'feature', featureSlug: 'feature-a' },
  }, { producerId: 'producer-a', generateId: (() => { let n = 0; return () => `event-${++n}`; })(), now: () => '2026-10-02T12:00:00.000Z' });
}

describe('runObservedGh', () => {
  it('reaches the injected real transport for a benign invocation before mutating argv fixtures', async () => {
    const transport = vi.fn<GhObserverTransport>().mockResolvedValue({ exitCode: 0, signal: undefined });

    await runObservedGh({ realExecutable: '/usr/bin/gh', argv: ['pr', 'view'], stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, producer: producer(), transport });

    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('/usr/bin/gh', ['pr', 'view'], expect.objectContaining({ stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }));
  });

  it('records an attempt before forwarding a raw mutation exactly once and correlates its terminal CLI outcome', async () => {
    const calls: string[] = [];
    const eventProducer = producer();
    const append = vi.spyOn(eventProducer, 'append').mockImplementation(async (event) => { calls.push(event.type); return '/events'; });
    const transport = vi.fn<GhObserverTransport>().mockImplementation(async () => {
      calls.push('transport');
      return { exitCode: 0, signal: undefined };
    });
    const stdin = { marker: 'stdin' } as never;
    const stdout = { marker: 'stdout' } as never;
    const stderr = { marker: 'stderr' } as never;
    const argv = ['issue', 'create', '--title', 'hello'];

    const result = await runObservedGh({ realExecutable: '/usr/bin/gh', argv, stdin, stdout, stderr, producer: eventProducer, transport });

    expect(result).toEqual({ exitCode: 0, signal: undefined });
    expect(calls).toEqual(['github_bypass_attempt', 'transport', 'github_bypass_result']);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('/usr/bin/gh', argv, { stdin, stdout, stderr });
    expect(append.mock.calls.map(([event]) => event)).toMatchObject([
      { type: 'github_bypass_attempt', eventId: 'event-1', operation: 'issue-create' },
      { type: 'github_bypass_result', attemptId: 'event-1', outcome: 'cli-succeeded' },
    ]);
  });

  it('preserves a failed exit and terminal signal while recording a failed CLI result', async () => {
    const eventProducer = producer();
    const append = vi.spyOn(eventProducer, 'append').mockResolvedValue('/events');
    const terminal = { exitCode: 137, signal: 'SIGTERM' as NodeJS.Signals };
    const transport = vi.fn<GhObserverTransport>().mockResolvedValue(terminal);

    await expect(runObservedGh({ realExecutable: '/usr/bin/gh', argv: ['repo', 'delete'], stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, producer: eventProducer, transport })).resolves.toBe(terminal);

    expect(append.mock.calls[1]![0]).toMatchObject({ type: 'github_bypass_result', outcome: 'cli-failed' });
  });

  it('records an unknown result when the child closes without an exit status or signal', async () => {
    const eventProducer = producer();
    const append = vi.spyOn(eventProducer, 'append').mockResolvedValue('/events');
    const terminal = { exitCode: null, signal: undefined };
    const transport = vi.fn<GhObserverTransport>().mockResolvedValue(terminal);

    await expect(runObservedGh({ realExecutable: '/usr/bin/gh', argv: ['pr', 'create'], stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, producer: eventProducer, transport })).resolves.toBe(terminal);

    expect(transport).toHaveBeenCalledOnce();
    expect(append.mock.calls[1]![0]).toMatchObject({ type: 'github_bypass_result', outcome: 'unknown' });
  });

  it('reports an unknown terminal result after a transport failure without retrying or swallowing the original error', async () => {
    const eventProducer = producer();
    const append = vi.spyOn(eventProducer, 'append').mockResolvedValue('/events');
    const failure = new Error('transport failure with secret');
    const transport = vi.fn<GhObserverTransport>().mockRejectedValue(failure);

    await expect(runObservedGh({ realExecutable: '/usr/bin/gh', argv: ['pr', 'create'], stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, producer: eventProducer, transport })).rejects.toBe(failure);

    expect(transport).toHaveBeenCalledOnce();
    expect(append.mock.calls[1]![0]).toMatchObject({ type: 'github_bypass_result', outcome: 'unknown' });
  });

  it('reports degraded telemetry without changing an opaque invocation transport', async () => {
    const eventProducer = producer();
    vi.spyOn(eventProducer, 'append').mockRejectedValue(new Error('write failed'));
    const diagnostic = vi.fn();
    const transport = vi.fn<GhObserverTransport>().mockResolvedValue({ exitCode: 0, signal: undefined });
    const argv = ['api', 'graphql', '--raw-field', 'query=mutation { x }'];

    await runObservedGh({ realExecutable: '/usr/bin/gh', argv, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, producer: eventProducer, transport, diagnostic });

    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('/usr/bin/gh', argv, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
    expect(diagnostic).toHaveBeenCalledWith('gh observation telemetry degraded');
  });
});

describe('runGhObserverFromEnvironment', () => {
  it('refuses forged attribution but forwards the original transport once', async () => {
    const transport = vi.fn<GhObserverTransport>();
    const createProducer = vi.fn();

    await runGhObserverFromEnvironment({
      CONDUCT_GH_REAL_EXECUTABLE: '/usr/bin/gh',
      CONDUCT_SESSION_EVENT_ROOT: '/attacker/events',
      CONDUCT_SESSION_DISPATCH_ID: 'forged-dispatch',
      CONDUCT_SESSION_PROVIDER: 'forged-provider',
      CONDUCT_SESSION_FEATURE_SLUG: 'forged-feature',
    }, { argv: ['issue', 'create'], transport, createProducer });

    expect(createProducer).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce();
  });

  it('validates the serialized engine context then forwards its original command once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gh-observer-context-'));
    try {
      const projectRoot = join(root, 'project');
      const worktreeRoot = join(projectRoot, '.worktrees', 'feature-a');
      const producerRoot = join(worktreeRoot, '.pipeline', 'session-events', 'dispatch-1');
      await mkdir(producerRoot, { recursive: true });
      const context = {
        projectRoot, worktreeRoot, producerRoot, dispatchId: 'dispatch-1', provider: 'codex',
        scope: { kind: 'feature' as const, featureSlug: 'feature-a' },
      };
      const eventProducer = producer();
      const createProducer = vi.fn(() => eventProducer);
      const transport = vi.fn<GhObserverTransport>().mockResolvedValue({ exitCode: 0, signal: undefined });
      const argv = ['issue', 'create', '--title', 'unchanged'];

      await runGhObserverFromEnvironment({
        CONDUCT_GH_REAL_EXECUTABLE: '/usr/bin/gh',
        CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify(context),
        CONDUCT_SESSION_EVENT_ROOT: '/attacker/events',
      }, { argv, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, transport, createProducer });

      expect(createProducer).toHaveBeenCalledWith(expect.objectContaining({
        projectRoot, worktreeRoot, producerRoot, dispatchId: 'dispatch-1', provider: 'codex',
      }));
      expect(transport).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledWith('/usr/bin/gh', argv, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
