import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DAEMON_SESSION_MARKER,
  emitDaemonSessionRefusal,
  guardDaemonSessionInvocation,
} from '../../src/execution/daemon-session.js';
import type { SessionEventProducerContext } from '../../src/execution/session-event-producer.js';
import { dispatchCliEntry } from '../../src/index.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const argv = ['node', 'ai-conductor', 'daemon', 'park', 'feature-a'];
const context: SessionEventProducerContext = {
  projectRoot: '/project',
  worktreeRoot: '/project/.worktrees/feature-a',
  producerRoot: '/project/.worktrees/feature-a/.pipeline/session-events/dispatch-1',
  dispatchId: 'dispatch-1',
  provider: 'codex',
  scope: { kind: 'feature', featureSlug: 'feature-a' },
};

function refusal() {
  const verdict = guardDaemonSessionInvocation(argv, { [DAEMON_SESSION_MARKER]: '1' });
  if (verdict.allowed) throw new Error('fixture must be refused');
  return verdict;
}

describe('daemon-session CLI refusal telemetry', () => {
  it('refuses through the production entry before daemon dispatch and projects its provisioned occurrence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-command-refusal-'));
    const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-1');
    await mkdir(producerRoot, { recursive: true });
    const globalEvents = new ConductorEventEmitter();
    const daemonLog = vi.fn();
    const persistence = startFeatureEventPersistence(root, globalEvents, 'feature-a');
    persistence.events.on('session_command_refused', daemonLog);
    const handler = vi.fn(async () => 0);
    try {
      const outcome = await dispatchCliEntry({
        argv,
        environment: {
          [DAEMON_SESSION_MARKER]: '1',
          CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify({ ...context, projectRoot: root, worktreeRoot: root, producerRoot }),
        },
        dispatch: handler,
        diagnostic: vi.fn(),
      });

      await persistence.drain();
      expect(outcome).toEqual({ exitCode: 1, refused: true });
      expect(handler).not.toHaveBeenCalled();
      expect(await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).toContain('"subcommand":"daemon"');
      expect(daemonLog).toHaveBeenCalledWith(expect.objectContaining({
        type: 'session_command_refused', subcommand: 'daemon',
        scope: { kind: 'feature', featureSlug: 'feature-a' }, dispatchId: 'dispatch-1',
      }));
    } finally {
      persistence.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['finish-record', 'test-suite', 'build-review'] as const)(
    'keeps %s refused before its handler in every managed lifecycle context',
    async (subcommand) => {
      const handler = vi.fn(async () => 0);
      await expect(dispatchCliEntry({
        argv: ['node', 'ai-conductor', subcommand],
        environment: { [DAEMON_SESSION_MARKER]: '1' },
        dispatch: handler,
        diagnostic: vi.fn(),
      })).resolves.toEqual({ exitCode: 1, refused: true });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('dispatches allowed worker commands without emitting a refusal', async () => {
    const handler = vi.fn(async () => 17);
    const emitRefusal = vi.fn();
    await expect(dispatchCliEntry({
      argv: ['node', 'ai-conductor', 'scoped-run', 'test/file.test.ts'],
      environment: { [DAEMON_SESSION_MARKER]: '1' },
      dispatch: handler,
      emitRefusal,
      diagnostic: vi.fn(),
    })).resolves.toEqual({ exitCode: 17, refused: false });
    expect(handler).toHaveBeenCalledOnce();
    expect(emitRefusal).not.toHaveBeenCalled();
  });

  it('appends the guarded refusal with provisioned feature attribution before dispatch', async () => {
    const append = vi.fn(async () => undefined);
    const producer = {
      refusal: vi.fn((input: { subcommand: unknown }) => ({
        type: 'session_command_refused' as const,
        eventId: 'event-1', sourceTime: '2026-10-02T12:00:00.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'feature' as const, featureSlug: 'feature-a' },
        subcommand: typeof input.subcommand === 'string' ? input.subcommand : 'unknown',
      })),
      append,
    };
    const createProducer = vi.fn(() => producer);

    await expect(emitDaemonSessionRefusal(refusal(), {
      environment: {
        CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify(context),
        CONDUCT_MANAGED_FEATURE: 'feature-a',
        CONDUCT_MANAGED_DISPATCH: 'dispatch-1',
        CONDUCT_MANAGED_PROVIDER: 'codex',
      },
      createProducer,
    })).resolves.toBe('recorded');

    expect(createProducer).toHaveBeenCalledWith(context);
    expect(producer.refusal).toHaveBeenCalledWith({ subcommand: 'daemon' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'session_command_refused', subcommand: 'daemon' }));
  });

  it('rejects inconsistent feature claims without guessing or recording attribution', async () => {
    const createProducer = vi.fn();
    const diagnostic = vi.fn();

    await expect(emitDaemonSessionRefusal(refusal(), {
      environment: {
        CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify(context),
        CONDUCT_MANAGED_FEATURE: 'another-feature',
      },
      createProducer,
      diagnostic,
    })).resolves.toBe('unavailable');

    expect(createProducer).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith('session refusal telemetry unavailable');
  });

  it('keeps the refusal when event persistence fails and emits only a bounded diagnostic', async () => {
    const diagnostic = vi.fn();
    const producer = {
      refusal: () => ({
        type: 'session_command_refused' as const,
        eventId: 'event-1', sourceTime: '2026-10-02T12:00:00.000Z', dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'feature' as const, featureSlug: 'feature-a' }, subcommand: 'daemon',
      }),
      append: vi.fn(async () => { throw new Error('token=secret'); }),
    };

    await expect(emitDaemonSessionRefusal(refusal(), {
      environment: { CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify(context) },
      createProducer: () => producer,
      diagnostic,
    })).resolves.toBe('failed');

    expect(diagnostic).toHaveBeenCalledWith('session refusal telemetry degraded');
    expect(diagnostic.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});
