import type { HarnessConfig } from '../types/index.js';
import type { UIEventHandler } from '../ui/subscriber.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { registerBuiltins } from './plugin-loader.js';
import type { PluginRegistry } from './plugin-registry.js';

/** CLI composition seam: keep the resolved doctor timeout isolated to Codex registration. */
export function registerCliBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  renderEvent: UIEventHandler,
  config: HarnessConfig | undefined,
) {
  return registerBuiltins(
    registry,
    events,
    renderEvent,
    undefined,
    config?.codex_doctor_timeout_seconds,
  );
}
