// Covers: task:18
import { describe, expect, it, vi } from 'vitest';
import {
  DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS,
  installDaemonOtelSighupHandler,
  type DaemonProcessAdapter,
} from '../src/daemon-cli.js';

function processProbe(): {
  adapter: DaemonProcessAdapter;
  listeners: Map<NodeJS.Signals, () => void>;
  calls: string[];
  kill: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<NodeJS.Signals, () => void>();
  const calls: string[] = [];
  const kill = vi.fn((pid: number, signal: NodeJS.Signals) => {
    calls.push(`kill:${pid}:${signal}`);
  });
  return {
    adapter: {
      pid: 481,
      on: vi.fn((signal: NodeJS.Signals, listener: () => void) => {
        calls.push(`on:${signal}`);
        listeners.set(signal, listener);
      }),
      off: vi.fn((signal: NodeJS.Signals, listener: () => void) => {
        calls.push(`off:${signal}`);
        expect(listeners.get(signal)).toBe(listener);
        listeners.delete(signal);
      }),
      kill,
    },
    listeners,
    calls,
    kill,
  };
}

describe('Task 18: daemon OTel SIGHUP wiring', () => {
  it('stops OTel before removing its listener and re-raising SIGHUP through the injected process adapter', async () => {
    const probe = processProbe();
    const stop = vi.fn(async () => {
      probe.calls.push('stop');
    });

    installDaemonOtelSighupHandler({
      daemonOtel: { stop },
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });

    // The listener is registered through the production wiring before any
    // signal is exercised; the fake process boundary owns all signal effects.
    expect(probe.adapter.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    await probe.listeners.get('SIGHUP')!();

    expect(stop).toHaveBeenCalledOnce();
    expect(probe.calls).toEqual(['on:SIGHUP', 'stop', 'off:SIGHUP', 'kill:481:SIGHUP']);
    expect(probe.kill).toHaveBeenCalledWith(481, 'SIGHUP');
  });

  it('abandons a hanging OTel stop at the bounded export timeout and still re-raises SIGHUP', async () => {
    const probe = processProbe();
    const stop = vi.fn(() => new Promise<void>(() => {}));
    const awaitStop = vi.fn(async (_operation: Promise<void>, timeoutMs: number) => {
      expect(timeoutMs).toBe(DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS);
      return 'timed-out' as const;
    });

    installDaemonOtelSighupHandler({
      daemonOtel: { stop },
      processAdapter: probe.adapter,
      awaitStop,
    });
    await probe.listeners.get('SIGHUP')!();

    expect(stop).toHaveBeenCalledOnce();
    expect(awaitStop).toHaveBeenCalledOnce();
    expect(probe.calls).toEqual(['on:SIGHUP', 'off:SIGHUP', 'kill:481:SIGHUP']);
  });
});
