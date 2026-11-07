// Covers: task:2
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { TerminalSubscriber } from '../src/ui/subscriber.js';
import { PluginRegistry } from '../src/engine/plugin-registry.js';
import { registerTerminalBuiltins } from '../src/terminal-builtins.js';
import type { UIRenderer } from '../src/ui/types.js';

describe('registerTerminalBuiltins', () => {
  const subscribers: TerminalSubscriber[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(subscribers.splice(0).map((subscriber) => subscriber.stop()));
  });

  it('registers terminal separately from subscriber start so callers can select a configured renderer', () => {
    const start = vi.spyOn(TerminalSubscriber.prototype, 'start');
    const withRendererRegistry = new PluginRegistry();
    const withRendererSubscriber = registerTerminalBuiltins(
      withRendererRegistry,
      new ConductorEventEmitter(),
      {
        stateFilePath: '/tmp/conduct-state.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
      },
      [],
      false,
    );
    subscribers.push(withRendererSubscriber);
    const withoutRendererRegistry = new PluginRegistry();
    const withoutRendererSubscriber = registerTerminalBuiltins(
      withoutRendererRegistry,
      new ConductorEventEmitter(),
    );
    subscribers.push(withoutRendererSubscriber);

    expect({
      renderer: withRendererRegistry.tryGet('ui_renderer', 'terminal'),
      starts: start.mock.calls.map((args) => args[0]?.length ?? 0),
      subscribers: [withRendererSubscriber, withoutRendererSubscriber].every(
        (subscriber) => subscriber instanceof TerminalSubscriber,
      ),
      withoutRenderer: withoutRendererRegistry.tryGet('ui_renderer', 'terminal'),
    }).toEqual({
      renderer: expect.objectContaining({ name: 'terminal' }),
      starts: [0],
      subscribers: true,
      withoutRenderer: undefined,
    });
  });

  it('delivers CLI composition events to a configured non-terminal renderer', async () => {
    const registry = new PluginRegistry();
    const events = new ConductorEventEmitter();
    const configuredRenderer: UIRenderer = {
      name: 'configured',
      handle: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    registry.register('ui_renderer', 'configured', configuredRenderer);
    const subscriber = registerTerminalBuiltins(
      registry,
      events,
      {
        stateFilePath: '/tmp/conduct-state.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
      },
      [],
      false,
    );
    subscribers.push(subscriber);
    registry.markInitialized();

    const config = { ui_renderer: 'configured' };
    subscriber.start([
      registry.get<UIRenderer>('ui_renderer', config.ui_renderer ?? 'terminal'),
    ]);
    await events.emit({ type: 'step_started', step: 'build', index: 1 });

    expect(configuredRenderer.handle).toHaveBeenCalledOnce();
    expect(registry.get('ui_renderer', 'terminal')).not.toBe(configuredRenderer);
  });
});
