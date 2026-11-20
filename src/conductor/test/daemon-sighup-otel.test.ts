// Covers: task:18
import { existsSync, readdirSync } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS,
  installDaemonOtelSighupHandler,
  installDaemonOtelSigintHandler,
  stopDispatchVisualizer,
  type DaemonProcessAdapter,
} from '../src/daemon-cli.js';
import { wireDaemonOtel } from '../src/engine/otel/wire.js';
import { wireOtelVisualizer } from '../src/engine/otel/wire.js';
import { SpoolStore } from '../src/engine/otel/spool-store.js';
import { registerSighupPersistence } from '../src/engine/sighup-persistence.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

// These fixtures exercise the durable local spool, not a live OTLP export.
// Construction must therefore not inherit the suite-wide direct-export refusal.
const otelFixtureEnv = { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined };

function processProbe(): {
  adapter: DaemonProcessAdapter;
  listeners: Map<NodeJS.Signals, () => Promise<void>>;
  calls: string[];
  kill: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<NodeJS.Signals, () => Promise<void>>();
  const calls: string[] = [];
  const kill = vi.fn((pid: number, signal: NodeJS.Signals) => {
    calls.push(`kill:${pid}:${signal}`);
  });
  return {
    adapter: {
      pid: 481,
      on: vi.fn((signal: NodeJS.Signals, listener: () => void) => {
        calls.push(`on:${signal}`);
        listeners.set(signal, listener as () => Promise<void>);
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
    const root = await mkdtemp(join(tmpdir(), 'daemon-sighup-otel-'));
    const spoolDirectory = join(root, '.daemon', 'otel-spool');
    let leasePresentAtKill: boolean | undefined;
    let spoolFilesAtKill: string[] | undefined;
    probe.kill.mockImplementation((pid: number, signal: NodeJS.Signals) => {
      leasePresentAtKill = existsSync(join(spoolDirectory, 'lease.json'));
      const traceDirectory = join(spoolDirectory, 'traces');
      spoolFilesAtKill = existsSync(traceDirectory) ? readdirSync(traceDirectory) : [];
      probe.calls.push(`kill:${pid}:${signal}`);
    });
    const config = {
      otel: {
        exporter: 'otlp',
        endpoint: 'http://127.0.0.1:1',
        spool: { enabled: true },
      },
    } as const;
    const daemonOtel = wireDaemonOtel(config, {
      mainRoot: root,
      project: root,
      projectName: 'test',
      rootEvents: new ConductorEventEmitter(),
      env: otelFixtureEnv,
    });
    expect(daemonOtel).not.toBeNull();
    const stop = daemonOtel!.stop.bind(daemonOtel);
    daemonOtel!.stop = async () => {
      await stop();
      probe.calls.push('otel-stop');
    };
    const events = new ConductorEventEmitter();
    const visualizer = wireOtelVisualizer(
      config,
      {
        pipelineDir: join(root, '.pipeline'),
        runId: 'run',
        feature: 'feature',
        project: root,
        branch: 'feature',
        engineVersion: 'test',
        harnessVersion: 'test',
        env: otelFixtureEnv,
      },
      events,
      daemonOtel!.spoolRuntime,
    );
    if (!visualizer) throw new Error('expected dispatch visualizer');
    await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await events.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });

    installDaemonOtelSighupHandler({
      daemonOtel,
      activeDispatchVisualizers: new Set([{ stop: visualizer.stop.bind(visualizer) }]),
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });

    // The listener is registered through the production wiring before any
    // signal is exercised; the fake process boundary owns all signal effects.
    expect(probe.adapter.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    await probe.listeners.get('SIGHUP')!();

    await expect(access(join(spoolDirectory, 'lease.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(probe.calls).toEqual(['on:SIGHUP', 'otel-stop', 'off:SIGHUP', 'kill:481:SIGHUP']);
    expect(probe.kill).toHaveBeenCalledWith(481, 'SIGHUP');
    expect(leasePresentAtKill).toBe(false);
    expect(spoolFilesAtKill).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it('awaits every registered conductor persistence hook before stopping OTel and re-raising SIGHUP', async () => {
    const probe = processProbe();
    const order: string[] = [];
    const release = registerSighupPersistence(async () => {
      order.push('persist');
    });
    const failing = registerSighupPersistence(async () => {
      throw new Error('persist failed');
    });
    const stop = vi.fn(async () => {
      order.push('stop');
    });

    installDaemonOtelSighupHandler({
      daemonOtel: { stop },
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });
    await probe.listeners.get('SIGHUP')!();
    release();
    failing();

    expect(order).toEqual(['persist', 'stop']);
    expect(probe.calls).toEqual(['on:SIGHUP', 'off:SIGHUP', 'kill:481:SIGHUP']);
  });

  it('flushes pending spans from active dispatch visualizers into the spool before re-raising SIGHUP', async () => {
    const probe = processProbe();
    const root = await mkdtemp(join(tmpdir(), 'daemon-sighup-dispatch-span-'));
    const config = { otel: { exporter: 'otlp' as const, endpoint: 'http://127.0.0.1:1', spool: { enabled: true } } };
    const daemon = wireDaemonOtel(config, {
      mainRoot: root,
      project: root,
      projectName: 'test',
      rootEvents: new ConductorEventEmitter(),
      env: otelFixtureEnv,
    });
    const events = new ConductorEventEmitter();
    const visualizer = wireOtelVisualizer(
      config,
      {
        pipelineDir: join(root, '.pipeline'),
        runId: 'run',
        feature: 'feature',
        project: root,
        branch: 'feature',
        engineVersion: 'test',
        harnessVersion: 'test',
        env: otelFixtureEnv,
      },
      events,
      daemon?.spoolRuntime,
    );
    if (!visualizer) throw new Error('expected dispatch visualizer');
    const activeDispatchVisualizers = new Set([{ stop: visualizer.stop.bind(visualizer) }]);
    await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await events.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });

    installDaemonOtelSighupHandler({
      daemonOtel: daemon,
      activeDispatchVisualizers,
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });
    await probe.listeners.get('SIGHUP')!();

    await expect(new SpoolStore(join(root, '.daemon', 'otel-spool')).list('traces')).resolves.toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it('abandons a hanging OTel stop at the bounded export timeout and still re-raises SIGHUP', async () => {
    const probe = processProbe();
    const stop = vi.fn(() => new Promise<void>(() => {}));
    let releaseTimeout!: () => void;
    const exportTimeoutElapsed = new Promise<void>((resolve) => {
      releaseTimeout = resolve;
    });
    const awaitStop = vi.fn(async (_operation: Promise<void>, timeoutMs: number) => {
      expect(timeoutMs).toBe(DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS);
      await exportTimeoutElapsed;
      return 'timed-out' as const;
    });

    installDaemonOtelSighupHandler({
      daemonOtel: { stop },
      processAdapter: probe.adapter,
      awaitStop,
    });
    const handling = probe.listeners.get('SIGHUP')!();

    // stop() starts after the persistence hooks settle, inside the bounded operation.
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(awaitStop).toHaveBeenCalledOnce();
    expect(probe.calls).toEqual(['on:SIGHUP']);
    releaseTimeout();
    await handling;
    expect(probe.calls).toEqual(['on:SIGHUP', 'off:SIGHUP', 'kill:481:SIGHUP']);
  });

  // Covers: task:4
  it('keeps an ending dispatch visualizer active until its pending stop lets SIGHUP re-raise', async () => {
    const probe = processProbe();
    let resolveStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const stop = vi.fn(() => stopped);
    const visualizer = { stop };
    const activeDispatchVisualizers = new Set([visualizer]);

    const ending = stopDispatchVisualizer(visualizer, activeDispatchVisualizers);
    expect(stop).toHaveBeenCalledOnce();
    expect(activeDispatchVisualizers).toContain(visualizer);

    installDaemonOtelSighupHandler({
      daemonOtel: null,
      activeDispatchVisualizers,
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });
    const handling = probe.listeners.get('SIGHUP')!();

    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    expect(probe.kill).not.toHaveBeenCalled();
    resolveStop();
    await Promise.all([ending, handling]);

    expect(activeDispatchVisualizers).not.toContain(visualizer);
    expect(probe.kill).toHaveBeenCalledWith(481, 'SIGHUP');
  });

  // Covers: task:4
  it('does not stop or await an already-settled dispatch visualizer when SIGHUP arrives later', async () => {
    const probe = processProbe();
    const neverSettles = new Promise<void>(() => {});
    const stop = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(neverSettles);
    const visualizer = { stop };
    const activeDispatchVisualizers = new Set([visualizer]);

    await stopDispatchVisualizer(visualizer, activeDispatchVisualizers);
    expect(activeDispatchVisualizers).not.toContain(visualizer);

    installDaemonOtelSighupHandler({
      daemonOtel: null,
      activeDispatchVisualizers,
      processAdapter: probe.adapter,
      awaitStop: async (operation) => operation,
    });
    const handling = probe.listeners.get('SIGHUP')!();

    await vi.waitFor(() => expect(probe.kill).toHaveBeenCalledWith(481, 'SIGHUP'));
    await handling;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops every active dispatch visualizer on SIGINT before re-raising SIGINT through the injected process adapter', async () => {
    const probe = processProbe();
    const first = { stop: vi.fn(async () => void probe.calls.push('stop:first')) };
    const second = { stop: vi.fn(async () => void probe.calls.push('stop:second')) };
    const awaitStop = vi.fn(async (operation: Promise<void>, timeoutMs: number) => {
      expect(timeoutMs).toBe(DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS);
      return operation;
    });

    installDaemonOtelSigintHandler({
      activeDispatchVisualizers: new Set([first, second]),
      processAdapter: probe.adapter,
      awaitStop,
    });

    // The fake process boundary owns registration and the re-raise; no real
    // signal reaches the test process.
    expect(probe.adapter.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    await probe.listeners.get('SIGINT')!();

    expect(awaitStop).toHaveBeenCalledOnce();
    expect(probe.calls).toEqual(['on:SIGINT', 'stop:first', 'stop:second', 'off:SIGINT', 'kill:481:SIGINT']);
  });
});
