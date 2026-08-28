import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { EngineerRunStore } from '../../src/engine/engineer/run-store.js';
import { runEngineerVisualizerLifecycle } from '../../src/index.js';
import type { VisualizerPlugin } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('Engineer visualizer lifecycle', () => {
  it('starts registered visualizers before Engineer events and stops them after the command', async () => {
    const observed: string[] = [];
    const stop = vi.fn(async () => {});
    const visualizer: VisualizerPlugin = {
      name: 'engineer-observer',
      start(events) {
        observed.push('started');
        events.on('engineer_run_started', (event) => {
          if (event.type === 'engineer_run_started') observed.push(event.engineerRunId);
        });
      },
      stop,
    };
    const registry = new PluginRegistry();
    registry.register('visualizer', visualizer.name, visualizer);
    registry.markInitialized();
    const events = new ConductorEventEmitter();

    const result = await runEngineerVisualizerLifecycle(registry, events, async () => {
      await events.emit({
        type: 'engineer_run_started',
        schemaVersion: 1,
        engineerRunId: 'run-1',
        correlationId: null,
        attemptKey: 'attempt-1',
        attempt: 1,
        previousEngineerRunId: null,
        repoRoot: '/repo',
        revision: 2,
        ts: '2026-08-27T00:00:00.000Z',
      });
      return 7;
    });

    expect(result).toBe(7);
    expect(observed).toEqual(['started', 'run-1']);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('isolates visualizer start, handler, and stop failures from Engineer commands', async () => {
    const healthy = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PluginRegistry();
    registry.register('visualizer', 'bad-start', {
      name: 'bad-start',
      start() { throw new Error('start broke'); },
      stop() { throw new Error('stop broke'); },
    } satisfies VisualizerPlugin);
    registry.register('visualizer', 'bad-handler', {
      name: 'bad-handler',
      start(events) { events.on('engineer_run_started', () => { throw new Error('handler broke'); }); },
      async stop() {},
    } satisfies VisualizerPlugin);
    registry.register('visualizer', 'healthy', {
      name: 'healthy',
      start(events) { events.on('engineer_run_started', healthy); },
      async stop() {},
    } satisfies VisualizerPlugin);
    registry.markInitialized();
    const events = new ConductorEventEmitter();

    await expect(runEngineerVisualizerLifecycle(registry, events, async () => {
      await events.emit({
        type: 'engineer_run_started',
        schemaVersion: 1,
        engineerRunId: 'run-2',
        correlationId: null,
        attemptKey: 'attempt-2',
        attempt: 1,
        previousEngineerRunId: null,
        repoRoot: '/repo',
        revision: 2,
        ts: '2026-08-27T00:00:00.000Z',
      });
      return 'ok';
    })).resolves.toBe('ok');
    expect(healthy).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('isolates a failing visualizer from real durable store emission', async () => {
    const engineerDir = await mkdtemp(join(tmpdir(), 'engineer-visualizer-store-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'engineer-visualizer-repo-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new PluginRegistry();
      registry.register('visualizer', 'bad-store-handler', {
        name: 'bad-store-handler',
        start(events) {
          events.on('engineer_run_created', () => { throw new Error('handler broke'); });
        },
        async stop() {},
      } satisfies VisualizerPlugin);
      registry.markInitialized();
      const events = new ConductorEventEmitter();

      await expect(runEngineerVisualizerLifecycle(registry, events, async () => {
        const store = new EngineerRunStore({ engineerDir, events });
        return store.create({ repoRoot, idea: 'Visualize this run', attemptKey: 'attempt-1' });
      })).resolves.toMatchObject({ state: 'created', eventRevision: 1 });

      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(engineerDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
