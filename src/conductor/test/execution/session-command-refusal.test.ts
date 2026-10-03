import { describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DAEMON_SESSION_MARKER,
  emitDaemonSessionRefusal,
  guardDaemonSessionInvocation,
} from '../../src/execution/daemon-session.js';
import type { SessionEventProducerContext } from '../../src/execution/session-event-producer.js';

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
  it('refuses through the production entry before daemon dispatch and writes its provisioned occurrence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-command-refusal-'));
    const producerRoot = join(root, '.worktrees', 'feature-a', '.pipeline', 'session-events', 'dispatch-1');
    try {
      await mkdir(producerRoot, { recursive: true });
      const result = await execa(process.execPath, [
        '--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'daemon', 'park', 'feature-a',
      ], {
        cwd: root,
        reject: false,
        env: {
          [DAEMON_SESSION_MARKER]: '1',
          CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW: '',
          CONDUCT_MANAGED_SESSION_CONTEXT: JSON.stringify({ ...context, projectRoot: root, worktreeRoot: join(root, '.worktrees', 'feature-a'), producerRoot }),
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('blocked subcommand: daemon');
      const [producerFile] = await readdir(producerRoot);
      expect(await readFile(join(producerRoot, producerFile!), 'utf8')).toContain('"subcommand":"daemon"');
      await expect(access(join(root, '.daemon'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
