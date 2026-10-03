/** The managed PATH entry is always named exactly like the executable it observes. */
export const GH_OBSERVER_EXECUTABLE_NAME = 'gh';

/**
 * Render the tiny engine-packaged executable. The preparation boundary supplies
 * the compiled observer module URL and the provisioned environment; this asset
 * neither resolves PATH nor invents any attribution.
 */
export function renderGhObserverAsset(observerModuleUrl: string): string {
  return `#!/usr/bin/env node\nimport { runGhObserverFromEnvironment } from ${JSON.stringify(observerModuleUrl)};\nconst result = await runGhObserverFromEnvironment();\nif (result.signal) process.kill(process.pid, result.signal);\nprocess.exitCode = result.exitCode ?? 1;\n`;
}
