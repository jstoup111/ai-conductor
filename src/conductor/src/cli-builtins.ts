import type { HarnessConfig } from './types/index.js';
import type { ConductorEventEmitter } from './engine/conductor-event-emitter.js';
import type { TerminalRendererOptions } from './ui/terminal-renderer.js';
import { registerBuiltins } from './engine/plugin-loader.js';
import type { PluginRegistry } from './engine/plugin-registry.js';
import type { BuiltInProviderId } from './execution/provider-catalog.js';
import { registerTerminalBuiltins } from './terminal-builtins.js';

/** CLI composition seam: keep the resolved doctor timeout isolated to Codex registration. */
export function registerCliBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  config: HarnessConfig | undefined,
  rendererOpts?: TerminalRendererOptions,
  installed?: ReadonlySet<BuiltInProviderId>,
  startSubscriber = true,
) {
  registerBuiltins(registry, config?.codex_doctor_timeout_seconds, installed);
  return registerTerminalBuiltins(registry, events, rendererOpts, [], startSubscriber);
}
