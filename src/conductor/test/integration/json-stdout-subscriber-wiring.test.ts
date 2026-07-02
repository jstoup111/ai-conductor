import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import { JsonStdoutSubscriber } from '../../../../plugins/json-stdout-subscriber/index.ts';
import type { ConductorEvent } from '../../src/types/index.js';
import type { UISubscriber } from '../../src/ui/types.js';

/**
 * Story 3.2-3 happy path: "events flow through JsonStdoutSubscriber ... when
 * the conductor starts" — driven through the SAME wiring src/index.ts uses
 * (registry selection + subscriber.start(), then events dispatched via the
 * real ConductorEventEmitter.emit()), not by calling subscriber.handle()
 * directly. Calling handle() directly only proves the class can serialize
 * an event; it does not prove the conductor's event bus ever delivers a
 * live event to it.
 */
function selectAndStart(
  uiRendererName: string,
  emitter: ConductorEventEmitter,
  renderCallback: (event: ConductorEvent) => void,
): UISubscriber {
  const registry = new PluginRegistry();
  registry.register('ui_renderer', 'terminal', new TerminalSubscriber(emitter, renderCallback));
  registry.register('ui_renderer', 'json-stdout', new JsonStdoutSubscriber(emitter));
  registry.markInitialized();

  const subscriber = registry.get<UISubscriber>('ui_renderer', uiRendererName);
  subscriber.start();
  return subscriber;
}

describe('json-stdout subscriber — real event-bus wiring (Story 3.2-3, 3.2-4)', () => {
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

  it('an event emitted on the real bus reaches JsonStdoutSubscriber without calling handle() directly', async () => {
    const subscriber = selectAndStart('json-stdout', emitter, renderCallback);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('step_started');
    expect(parsed.step).toBe('brainstorm');
    expect(parsed.ts).toBeDefined();

    subscriber.stop();
  });

  it('step_started and step_completed both reach stdout as parseable JSON lines in sequence', async () => {
    const subscriber = selectAndStart('json-stdout', emitter, renderCallback);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).toHaveBeenCalledTimes(2);
    const lines = stdoutWriteSpy.mock.calls.map((call) => JSON.parse((call[0] as string).trimEnd()));
    expect(lines.some((l) => l.type === 'step_started')).toBe(true);
    expect(lines.some((l) => l.type === 'step_completed')).toBe(true);

    subscriber.stop();
  });

  it('after stop(), further real bus emissions produce no stdout output', async () => {
    const subscriber = selectAndStart('json-stdout', emitter, renderCallback);
    subscriber.stop();

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
