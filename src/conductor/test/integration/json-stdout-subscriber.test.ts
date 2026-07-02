import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverPlugins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { selectUISubscriber } from '../../src/index.js';
import type { UISubscriber } from '../../src/ui/types.js';

/**
 * Story 3.2-3/3.2-4, real wiring: this spec drives the SAME path the live
 * conductor uses in src/index.ts —
 *
 *   discoverPlugins(...)              (index.ts ~638)
 *   selectUISubscriber(registry, ...) (index.ts ~649, calls registry.get()
 *                                       then subscriber.bind(events) exactly
 *                                       as the real run() does)
 *   subscriber.start()                (index.ts ~654)
 *
 * — then emits on a real ConductorEventEmitter and asserts parseable JSON
 * lines land on process.stdout. It does NOT construct
 * `new JsonStdoutSubscriber(emitter)` directly: that bypasses discovery and
 * the emitter-less default export the loader actually instantiates, so it
 * cannot catch a missing/broken bind() wiring in production.
 *
 * The discovered plugin dir mirrors the shape produced from
 * plugins/json-stdout-subscriber (manifest + a bind()-capable JS entrypoint,
 * matching the real TS source at plugins/json-stdout-subscriber/index.ts),
 * the same pattern test/engine/json-stdout-plugin-loader.test.ts uses to
 * exercise discoverPlugins without a TS-compile step in the test run.
 */
const REAL_PLUGIN_DIR = join(
  new URL('../../../../plugins/json-stdout-subscriber', import.meta.url).pathname
);

function buildDiscoverablePluginDir(): { pluginsDir: string; globalDir: string } {
  const pluginsDir = mkdtempSync(join(tmpdir(), 'json-stdout-real-wiring-'));
  const globalDir = mkdtempSync(join(tmpdir(), 'no-global-plugins-'));
  const pluginDir = join(pluginsDir, 'json-stdout-subscriber');
  mkdirSync(pluginDir, { recursive: true });

  const manifest = readFileSync(join(REAL_PLUGIN_DIR, 'plugin.yml'), 'utf-8');
  writeFileSync(join(pluginDir, 'plugin.yml'), manifest);

  // Compiled-JS stand-in for plugins/json-stdout-subscriber/index.ts — same
  // shape as production, including bind(), start()/stop() subscribing to
  // the real event bus, and a no-emitter default export.
  writeFileSync(
    join(pluginDir, 'index.js'),
    `
const SUBSCRIBED_EVENT_TYPES = ['step_started', 'step_completed', 'step_failed'];

export class JsonStdoutSubscriber {
  constructor(eventEmitter) {
    this.started = false;
    this.eventEmitter = eventEmitter;
    this.handlers = [];
  }

  bind(events) {
    if (this.started && this.eventEmitter) {
      for (const { type, handler } of this.handlers) {
        this.eventEmitter.off(type, handler);
      }
      this.handlers = [];
    }
    this.eventEmitter = events;
    if (this.started) {
      for (const type of SUBSCRIBED_EVENT_TYPES) {
        const handler = (event) => this.handle(event);
        this.handlers.push({ type, handler });
        this.eventEmitter.on(type, handler);
      }
    }
  }

  start() {
    this.started = true;
    if (this.eventEmitter) {
      for (const type of SUBSCRIBED_EVENT_TYPES) {
        const handler = (event) => this.handle(event);
        this.handlers.push({ type, handler });
        this.eventEmitter.on(type, handler);
      }
    }
  }

  stop() {
    this.started = false;
    if (this.eventEmitter) {
      for (const { type, handler } of this.handlers) {
        this.eventEmitter.off(type, handler);
      }
      this.handlers = [];
    }
  }

  handle(event) {
    if (!this.started) return;
    process.stdout.write(JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\\n');
  }
}

export default new JsonStdoutSubscriber();
`
  );

  return { pluginsDir, globalDir };
}

describe('json-stdout subscriber — real discoverPlugins + bind wiring (Story 3.2-3, 3.2-4)', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let dirs: { pluginsDir: string; globalDir: string };
  let subscriber: UISubscriber;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dirs = buildDiscoverablePluginDir();
    emitter = new ConductorEventEmitter();

    const registry = new PluginRegistry();
    await discoverPlugins(dirs.globalDir, dirs.pluginsDir, registry);
    registry.markInitialized();

    // Exactly the wiring src/index.ts performs at ~649-654: registry.get()
    // then a generic bind() call, before start().
    subscriber = selectUISubscriber(registry, 'json-stdout', emitter);
    subscriber.start();
  });

  afterEach(() => {
    subscriber.stop();
    stdoutWriteSpy.mockRestore();
    rmSync(dirs.pluginsDir, { recursive: true, force: true });
    rmSync(dirs.globalDir, { recursive: true, force: true });
  });

  it('a step_started event emitted on the real bus reaches stdout as a parseable JSON line', async () => {
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('step_started');
    expect(parsed.step).toBe('brainstorm');
    expect(parsed.ts).toBeDefined();
  });

  it('step_started then step_completed both reach stdout as JSON lines in sequence', async () => {
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).toHaveBeenCalledTimes(2);
    const lines = stdoutWriteSpy.mock.calls.map((call) => JSON.parse((call[0] as string).trimEnd()));
    expect(lines.some((l) => l.type === 'step_started')).toBe(true);
    expect(lines.some((l) => l.type === 'step_completed')).toBe(true);
  });

  it('after stop(), further real bus emissions produce no stdout output', async () => {
    subscriber.stop();

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 0 });

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
