/** The complete set of capabilities a smoke test may require. */
export const SMOKE_CAPABILITIES = [
  'hermetic',
  'toolchain',
  'credentialed',
] as const;

export type SmokeCapability = (typeof SMOKE_CAPABILITIES)[number];

const declarations = new Map<string, SmokeCapability>();

/** Rejects a smoke run that did not discover any test files. */
export function assertSmokeDiscovery(discovered: { readonly length: number }): void {
  if (discovered.length === 0) {
    throw new Error('Smoke discovery found no test files');
  }
}

/** Records the capability required by a smoke test file. */
export function declareSmokeCapability(
  file: string,
  capability: SmokeCapability,
): void {
  if (!SMOKE_CAPABILITIES.includes(capability)) {
    throw new Error(`Smoke file ${file} declares invalid capability ${capability}`);
  }
  declarations.set(file, capability);
}

/** Returns a smoke test file's declared capability. */
export function getDeclaredSmokeCapability(
  file: string,
): SmokeCapability {
  const capability = declarations.get(file);
  if (capability === undefined) {
    throw new Error(`Smoke file ${file} declares no capability`);
  }
  return capability;
}
