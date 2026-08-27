// Covers: task:5, task:6, task:9
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildVisualizers,
  createVisualizerStartContext,
  resolveCurrentBranch,
  selectVisualizers,
} from '../../src/index.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type {
  VisualizerFactory,
  VisualizerFactoryContext,
  VisualizerPlugin,
  VisualizerStartContext,
} from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

class FakeVisualizer implements VisualizerPlugin {
  readonly received: string[] = [];
  emitter?: ConductorEventEmitter;
  context?: VisualizerStartContext;

  constructor(readonly name: string) {}

  start(emitter: ConductorEventEmitter, context: VisualizerStartContext): void {
    this.emitter = emitter;
    this.context = context;
    emitter.on('feature_complete', (event) => {
      if (event.type === 'feature_complete') {
        this.received.push(event.featureDesc ?? '');
      }
    });
  }

  async stop(): Promise<void> {}
}

function factoryFor(
  visualizer: FakeVisualizer,
  onCreate: (context: VisualizerFactoryContext) => void,
): VisualizerFactory {
  return (context) => {
    onCreate(context);
    return visualizer;
  };
}

function createFactoryContext(
  emitter: ConductorEventEmitter,
  visualizers?: string[],
  startContext: Partial<VisualizerStartContext> = {},
): VisualizerFactoryContext {
  return {
    config: { visualizers } as HarnessConfig,
    pipelineDir: '/tmp/visualizer-selection',
    emitter,
    startContext: {
      runId: 'run-1516',
      project: '/project',
      branch: 'feat/visualizer-selection',
      feature: 'connector-seam-for-event-submissions-is-registered',
      engineVersion: '0.0.0-test',
      pipelineDir: '/tmp/visualizer-selection',
      ...startContext,
    },
  };
}

describe('visualizer selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds production connector identity without fabricating unavailable fields', () => {
    expect(createVisualizerStartContext({
      runId: 'run-1516',
      project: '/project',
      feature: 'connector-seam-for-event-submissions-is-registered',
      branch: undefined,
      engineVersion: 'dev',
      pipelineDir: '/tmp/visualizer-selection',
    })).toEqual({
      runId: 'run-1516',
      project: '/project',
      feature: 'connector-seam-for-event-submissions-is-registered',
      branch: undefined,
      engineVersion: 'dev',
      pipelineDir: '/tmp/visualizer-selection',
    });
  });

  it('derives the checked-out branch and leaves detached HEAD explicitly absent', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'visualizer-branch-'));
    try {
      await execa('git', ['init', '--initial-branch', 'feature/visualizer'], { cwd: projectRoot });
      await execa('git', ['config', 'user.email', 'visualizer@example.test'], { cwd: projectRoot });
      await execa('git', ['config', 'user.name', 'Visualizer test'], { cwd: projectRoot });
      await writeFile(join(projectRoot, 'README.md'), 'fixture\n');
      await execa('git', ['add', 'README.md'], { cwd: projectRoot });
      await execa('git', ['commit', '-m', 'fixture'], { cwd: projectRoot });

      const branch = await resolveCurrentBranch(projectRoot);
      await execa('git', ['checkout', '--detach'], { cwd: projectRoot });

      expect({ branch, detachedBranch: await resolveCurrentBranch(projectRoot) }).toEqual({
        branch: 'feature/visualizer',
        detachedBranch: undefined,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('starts a configured factory with run identity and delivers emitted events', async () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const fake = new FakeVisualizer('fake');
    const context = createFactoryContext(emitter, ['fake']);
    let factoryContext: VisualizerFactoryContext | undefined;
    registry.register('visualizer', 'fake', factoryFor(fake, (value) => { factoryContext = value; }));

    const selected = selectVisualizers(registry, context.config, context);
    buildVisualizers(selected, emitter, context.startContext);
    await emitter.emit({ type: 'feature_complete', featureDesc: 'selected-feature' });

    expect({
      selected: selected.map((visualizer) => visualizer.name),
      factoryContext,
      emitter: fake.emitter,
      context: fake.context,
      received: fake.received,
    }).toEqual({
      selected: ['fake'],
      factoryContext: context,
      emitter,
      context: context.startContext,
      received: ['selected-feature'],
    });
  });

  it('delivers the same event to each configured visualizer', async () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const first = new FakeVisualizer('first');
    const second = new FakeVisualizer('second');
    const context = createFactoryContext(emitter, ['first', 'second']);
    registry.register('visualizer', 'first', factoryFor(first, () => {}));
    registry.register('visualizer', 'second', factoryFor(second, () => {}));

    const selected = selectVisualizers(registry, context.config, context);
    buildVisualizers(selected, emitter, context.startContext);
    await emitter.emit({ type: 'feature_complete', featureDesc: 'shared-feature' });

    expect([first.received, second.received]).toEqual([
      ['shared-feature'],
      ['shared-feature'],
    ]);
  });

  it('warns once and skips a configured visualizer that is not registered', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const context = createFactoryContext(emitter, ['ghost', 'ghost']);
    registry.register('visualizer', 'registered', factoryFor(new FakeVisualizer('registered'), () => {}));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const selected = selectVisualizers(registry, context.config, context);

    expect({ selected, warnings: warning.mock.calls }).toEqual({
      selected: [],
      warnings: [[
        'visualizer "ghost" is not registered; registered visualizers: registered.',
      ]],
    });
  });

  it('warns and skips a configured factory that throws while retaining valid siblings', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const valid = new FakeVisualizer('valid');
    const context = createFactoryContext(emitter, ['broken', 'valid']);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register('visualizer', 'broken', () => {
      throw new Error('factory failed');
    });
    registry.register('visualizer', 'valid', factoryFor(valid, () => {}));

    let selected: VisualizerPlugin[] = [];
    expect(() => { selected = selectVisualizers(registry, context.config, context); }).not.toThrow();
    expect({ selected, warnings: warning.mock.calls }).toEqual({
      selected: [valid],
      warnings: [['Plugin broken factory failed: Error: factory failed']],
    });
  });

  it('warns and skips a factory product missing stop while retaining valid siblings', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const valid = new FakeVisualizer('valid');
    const context = createFactoryContext(emitter, ['broken', 'valid']);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register('visualizer', 'broken', () => ({
      name: 'broken',
      start(): void {},
    }) as unknown as VisualizerPlugin);
    registry.register('visualizer', 'valid', factoryFor(valid, () => {}));

    expect({ selected: selectVisualizers(registry, context.config, context), warnings: warning.mock.calls }).toEqual({
      selected: [valid],
      warnings: [['Plugin broken missing required method: stop']],
    });
  });

  it('silently skips a configured factory that opts out with null', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const context = createFactoryContext(emitter, ['disabled']);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register('visualizer', 'disabled', () => null);

    expect({ selected: selectVisualizers(registry, context.config, context), warnings: warning.mock.calls }).toEqual({
      selected: [],
      warnings: [],
    });
  });

  it('warns once and ignores otel in visualizers because its block owns enablement', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const context = createFactoryContext(emitter, ['otel', 'otel']);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const selected = selectVisualizers(registry, context.config, context);

    expect({ selected, warnings: warning.mock.calls }).toEqual({
      selected: [],
      warnings: [[
        'visualizer "otel" is configured through the "otel:" block; remove it from "visualizers".',
      ]],
    });
  });

  it.each([[], undefined])('starts no visualizers when visualizers is %j and OTel is disabled', (visualizers) => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const context = createFactoryContext(emitter, visualizers);

    expect(selectVisualizers(registry, context.config, context)).toEqual([]);
  });

  // Regression: selection must preserve an underivable identity field rather
  // than replacing it with a synthetic value before the connector starts.
  it('delivers an explicitly undefined underivable branch and still starts the connector', () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const fake = new FakeVisualizer('fake');
    const context = createFactoryContext(emitter, ['fake'], { branch: undefined });
    let observedBranch: string | undefined = 'not-called';
    registry.register('visualizer', 'fake', factoryFor(fake, ({ startContext }) => {
      observedBranch = startContext.branch;
      expect(Object.hasOwn(startContext, 'branch')).toBe(true);
    }));

    const selected = selectVisualizers(registry, context.config, context);
    const started = buildVisualizers(selected, emitter, context.startContext);

    expect({ observedBranch, started, startContext: fake.context }).toEqual({
      observedBranch: undefined,
      started: [fake],
      startContext: context.startContext,
    });
  });

  // Regression: connectors that do not need identity context remain valid
  // listeners on the same event emitter.
  it('starts a connector that ignores context and still delivers events', async () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const received: string[] = [];
    const contextIgnoring = {
      name: 'context-ignoring',
      start(eventEmitter: ConductorEventEmitter): void {
        eventEmitter.on('feature_complete', (event) => {
          if (event.type === 'feature_complete') received.push(event.featureDesc ?? '');
        });
      },
      async stop(): Promise<void> {},
    } satisfies VisualizerPlugin;
    const context = createFactoryContext(emitter, ['context-ignoring']);
    registry.register('visualizer', 'context-ignoring', () => contextIgnoring);

    const started = buildVisualizers(
      selectVisualizers(registry, context.config, context),
      emitter,
      context.startContext,
    );
    await emitter.emit({ type: 'feature_complete', featureDesc: 'context-is-optional' });

    expect({ started, received }).toEqual({ started: [contextIgnoring], received: ['context-is-optional'] });
  });

  // Regression: the configured connector continues to receive events when the
  // built-in OTel factory opts out because its block is disabled.
  it('delivers fake connector events when OTel is disabled', async () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const fake = new FakeVisualizer('fake');
    const context = createFactoryContext(emitter, ['fake']);
    registry.register('visualizer', 'fake', factoryFor(fake, () => {}));
    registerBuiltins(registry, emitter, () => {});

    const started = buildVisualizers(
      selectVisualizers(registry, context.config, context),
      emitter,
      context.startContext,
    );
    await emitter.emit({ type: 'feature_complete', featureDesc: 'fake-without-otel' });

    expect({ started, received: fake.received }).toEqual({
      started: [fake],
      received: ['fake-without-otel'],
    });
  });

  // Regression: OTel can own the emitter alone; no configured fake connector
  // is needed for the file transport to receive the emitted event.
  it('writes OTel file transport events with no fake connector configured', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'visualizer-selection-'));
    try {
      const registry = new PluginRegistry();
      const emitter = new ConductorEventEmitter();
      registerBuiltins(registry, emitter, () => {});
      const context = createFactoryContext(emitter, undefined, {
        pipelineDir,
      });
      context.pipelineDir = pipelineDir;
      context.config.otel = { exporter: 'file' };

      const started = buildVisualizers(
        selectVisualizers(registry, context.config, context),
        emitter,
        context.startContext,
      );
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      await emitter.emit({ type: 'feature_complete', featureDesc: 'otel-without-fake' });
      await Promise.all(started.map((visualizer) => visualizer.stop()));

      expect(started.map((visualizer) => visualizer.name)).toEqual(['otel']);
      expect(await readFile(join(pipelineDir, 'otel.jsonl'), 'utf8')).toContain('bootstrap');
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });
});
