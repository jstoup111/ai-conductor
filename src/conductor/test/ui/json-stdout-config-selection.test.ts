// Covers: task:2
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { JsonStdoutSubscriber } from '../../../../plugins/json-stdout-subscriber/index.ts';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import type { UIRenderer } from '../../src/ui/types.js';
import { Writable } from 'node:stream';

class CaptureStream extends Writable { _write(_chunk: Buffer | string, _e: string, cb: (e?: Error | null) => void) { cb(); } }

describe('Config-driven renderer selection', () => {
  afterEach(() => vi.restoreAllMocks());
  it('selects json stdout as a UIRenderer without subscriber lifecycle gating', async () => {
    const registry = new PluginRegistry();
    registry.register('ui_renderer', 'json-stdout', new JsonStdoutSubscriber());
    registry.markInitialized();
    const renderer = registry.get<UIRenderer>('ui_renderer', 'json-stdout');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await renderer.handle({ type: 'build_progress', step: 'build', resolved: 1, total: 2 });
    expect(write).toHaveBeenCalledOnce();
  });

  it('selects terminal as a UIRenderer', () => {
    const registry = new PluginRegistry();
    registry.register('ui_renderer', 'terminal', new TerminalRenderer({ stateFilePath: '/tmp/state', steps: [], readStateFn: async () => ({ ok: true, value: {} }), liveRegion: createLiveRegion({ stream: new CaptureStream(), forceTTY: false }) }));
    registry.markInitialized();
    expect(registry.get<UIRenderer>('ui_renderer', 'terminal')).toBeInstanceOf(TerminalRenderer);
  });
});
