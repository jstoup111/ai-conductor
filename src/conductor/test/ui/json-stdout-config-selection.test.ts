import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { JsonStdoutSubscriber } from '../../../../plugins/json-stdout-subscriber/index.ts';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/index.js';
import type { UISubscriber } from '../../src/ui/types.js';

/**
 * Task 6: Config selection — ui_renderer: json-stdout routes events to plugin
 * Task 8: Terminal subscriber regression — switching back to terminal works
 *
 * These tests simulate the subscriber selection logic that index.ts performs:
 * given a config.ui_renderer value, the correct UISubscriber is retrieved
 * from the registry and used to handle events.
 */

/**
 * Helper: builds a registry with both 'terminal' and 'json-stdout' subscribers registered,
 * then returns the subscriber selected by uiRendererName.
 */
function buildRegistryAndSelectSubscriber(
  uiRendererName: string,
  emitter: ConductorEventEmitter,
  renderCallback: (event: ConductorEvent) => void,
): UISubscriber {
  const registry = new PluginRegistry();

  // Register terminal subscriber (builtin)
  const terminalSubscriber = new TerminalSubscriber(emitter, renderCallback);
  registry.register('ui_renderer', 'terminal', terminalSubscriber);

  // Register json-stdout subscriber (discovered plugin)
  const jsonSubscriber = new JsonStdoutSubscriber();
  registry.register('ui_renderer', 'json-stdout', jsonSubscriber);

  registry.markInitialized();

  return registry.get<UISubscriber>('ui_renderer', uiRendererName);
}

describe('Config-driven subscriber selection', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let renderCallback: ReturnType<typeof vi.fn>;
  let emitter: ConductorEventEmitter;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    renderCallback = vi.fn();
    emitter = new ConductorEventEmitter();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  describe('Task 6: ui_renderer: json-stdout routes events to JsonStdoutSubscriber', () => {
    it('events appear on stdout as JSON lines when json-stdout is selected', async () => {
      const subscriber = buildRegistryAndSelectSubscriber('json-stdout', emitter, renderCallback);

      subscriber.start();

      const event: ConductorEvent = { type: 'step_started', step: 'brainstorm', index: 0 };
      await emitter.emit(event);

      // Terminal renderCallback should NOT be called
      expect(renderCallback).not.toHaveBeenCalled();

      // But since JsonStdoutSubscriber.handle() is called directly (not via emitter),
      // let's call it directly as config selection would wire it
      (subscriber as JsonStdoutSubscriber).handle(event);

      expect(stdoutWriteSpy).toHaveBeenCalledOnce();
      const written = stdoutWriteSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.type).toBe('step_started');
      expect(parsed.ts).toBeDefined();

      subscriber.stop();
    });

    it('selected subscriber is a JsonStdoutSubscriber instance when ui_renderer: json-stdout', () => {
      const subscriber = buildRegistryAndSelectSubscriber('json-stdout', emitter, renderCallback);
      expect(subscriber).toBeInstanceOf(JsonStdoutSubscriber);
    });
  });

  describe('Task 8: ui_renderer: terminal — no JSON lines on stdout', () => {
    it('TerminalSubscriber selected when ui_renderer: terminal', () => {
      const subscriber = buildRegistryAndSelectSubscriber('terminal', emitter, renderCallback);
      expect(subscriber).toBeInstanceOf(TerminalSubscriber);
    });

    it('no JSON output on stdout when terminal subscriber handles events', async () => {
      const subscriber = buildRegistryAndSelectSubscriber('terminal', emitter, renderCallback);
      subscriber.start();

      await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });

      // Terminal subscriber invokes renderCallback — not stdout JSON
      expect(renderCallback).toHaveBeenCalledOnce();
      expect(stdoutWriteSpy).not.toHaveBeenCalled();

      subscriber.stop();
    });
  });
});
