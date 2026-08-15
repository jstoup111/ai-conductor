import type { HarnessConfig } from '../types/index.js';
import type { UIEventHandler } from '../ui/subscriber.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { TerminalRendererOptions } from '../ui/terminal-renderer.js';
import { registerBuiltins } from './plugin-loader.js';
import type { PluginRegistry } from './plugin-registry.js';

/** CLI composition seam: keep the resolved doctor timeout isolated to Codex registration. */
export function registerCliBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  renderEvent: UIEventHandler,
  config: HarnessConfig | undefined,
  rendererOpts?: TerminalRendererOptions,
) {
  return registerBuiltins(
    registry,
    events,
    renderEvent,
    rendererOpts,
    config?.codex_doctor_timeout_seconds,
  );
}
