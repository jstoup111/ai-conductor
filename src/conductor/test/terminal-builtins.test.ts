// Covers: task:2
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { TerminalSubscriber } from '../src/ui/subscriber.js';
import { PluginRegistry } from '../src/engine/plugin-registry.js';
import { registerTerminalBuiltins } from '../src/terminal-builtins.js';

describe('registerTerminalBuiltins', () => {
  const subscribers: TerminalSubscriber[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(subscribers.splice(0).map((subscriber) => subscriber.stop()));
  });

  it('registers and starts the terminal renderer only when renderer options are supplied', () => {
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
      starts: start.mock.calls.map(([renderers]) => renderers.length),
      subscribers: [withRendererSubscriber, withoutRendererSubscriber].every(
        (subscriber) => subscriber instanceof TerminalSubscriber,
      ),
      withoutRenderer: withoutRendererRegistry.tryGet('ui_renderer', 'terminal'),
    }).toEqual({
      renderer: expect.objectContaining({ name: 'terminal' }),
      starts: [1, 0],
      subscribers: true,
      withoutRenderer: undefined,
    });
  });
});
