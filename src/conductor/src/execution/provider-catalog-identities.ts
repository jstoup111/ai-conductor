/**
 * Leaf provider identities shared by the catalog and execution helpers that
 * run while the catalog is constructing adapters. Keeping these values below
 * the catalog prevents those helpers from creating an import cycle.
 */
export const BUILT_IN_PROVIDER_IDENTITIES = [
  {
    id: 'claude',
    displayName: 'Claude',
    defaultExecutable: 'claude',
    executableOverrideEnv: 'CLAUDE_EXECUTABLE',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    defaultExecutable: 'codex',
    executableOverrideEnv: 'CODEX_EXECUTABLE',
  },
  {
    id: 'pi',
    displayName: 'Pi',
    defaultExecutable: 'pi',
    executableOverrideEnv: 'PI_EXECUTABLE',
  },
] as const;

export const CLAUDE_PROVIDER = BUILT_IN_PROVIDER_IDENTITIES[0].id;
export const CODEX_PROVIDER = BUILT_IN_PROVIDER_IDENTITIES[1].id;
export const PI_PROVIDER = BUILT_IN_PROVIDER_IDENTITIES[2].id;
export const CLAUDE_DISPLAY_NAME = BUILT_IN_PROVIDER_IDENTITIES[0].displayName;
export const CODEX_DISPLAY_NAME = BUILT_IN_PROVIDER_IDENTITIES[1].displayName;
export const PI_DISPLAY_NAME = BUILT_IN_PROVIDER_IDENTITIES[2].displayName;

export function providerExecutable(provider: string): string {
  const identity = BUILT_IN_PROVIDER_IDENTITIES.find(({ id }) => id === provider);
  return identity === undefined ? provider : process.env[identity.executableOverrideEnv] ?? identity.defaultExecutable;
}
