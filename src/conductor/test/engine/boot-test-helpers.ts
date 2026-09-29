// Covers: task:21
import type { ProviderVersionProbeRunner } from '../../src/engine/provider-discovery.js';

/**
 * Keeps boot tests independent of whichever provider executables happen to be
 * installed on the machine running them.
 */
export function allInstalledProviderDiscoveryRunner(
  onProbe?: (executable: string) => void,
): ProviderVersionProbeRunner {
  return async (executable) => {
    onProbe?.(executable);
    return { exitCode: 0 };
  };
}
