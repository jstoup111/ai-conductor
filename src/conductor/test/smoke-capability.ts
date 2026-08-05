/** The complete set of capabilities a smoke test may require. */
export const SMOKE_CAPABILITIES = [
  'hermetic',
  'toolchain',
  'credentialed',
] as const;

export type SmokeCapability = (typeof SMOKE_CAPABILITIES)[number];

const declarations = new Map<string, SmokeCapability>();

/** Records the capability required by a smoke test file. */
export function declareSmokeCapability(
  file: string,
  capability: SmokeCapability,
): void {
  declarations.set(file, capability);
}

/** Returns a smoke test file's declared capability, if it has one. */
export function getDeclaredSmokeCapability(
  file: string,
): SmokeCapability | undefined {
  return declarations.get(file);
}
