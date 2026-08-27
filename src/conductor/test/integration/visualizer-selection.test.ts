// Covers: task:5, task:6
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectVisualizers, buildVisualizers } from '../../src/index.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
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
    },
  };
}

describe('visualizer selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
