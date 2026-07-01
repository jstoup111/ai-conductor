// owner-gate/machine-identity.ts — machine-scoped operator identity (D1).
//
// The daemon and authoring must answer "who am I building for?" from the
// OPERATOR'S MACHINE, never from the shared repo. `spec_owner` is therefore read
// only from the user config (~/.ai-conductor/config.yml) and fed into the
// existing `resolveDaemonOwner` chain. The project-over-user merge is NEVER
// consulted for identity, so a `spec_owner` committed into a shared repo cannot
// leak one operator's identity onto everyone who pulls (ADR
// adr-2026-07-01-machine-scoped-operator-identity, D1).
//
// Structural guarantee: `resolveMachineSpecOwner` takes a USER config object and
// returns ONLY its `spec_owner`. There is no parameter through which project
// config could enter the identity path — the leak is impossible by construction.
//
// Seam preserved: resolution still runs behind `resolveDaemonOwner`, so a future
// `PlatformIdentity` (EKS/OIDC) resolver slots in ahead of the user-config read
// without touching the gate ("design for isolated EKS, keep identity seams
// swappable").

import {
  resolveDaemonOwner,
  type GhRunner,
  type OwnerConfig,
  type OwnerResolution,
} from './identity.js';
import { readUserConfig } from '../user-config.js';

/** The narrow user-config surface the identity path reads: `spec_owner` only. */
export interface MachineIdentityConfig {
  spec_owner?: string | null;
}

/**
 * Extract the machine-scoped `OwnerConfig` from a USER config object (D1).
 * Returns ONLY `spec_owner` — no other key can enter the identity chain, and no
 * project config is ever consulted. A missing value normalizes to `null` so the
 * downstream chain engages the gh fallback.
 */
export function resolveMachineSpecOwner(userConfig: MachineIdentityConfig): OwnerConfig {
  return { spec_owner: userConfig.spec_owner ?? null };
}

/**
 * Read the machine (user) config from disk and return the identity `OwnerConfig`
 * (D1). Wraps `readUserConfig` so the daemon/authoring never touch project
 * config for identity. The reader is injectable for tests.
 */
export async function readMachineOwnerConfig(
  readUser: () => Promise<{ config: MachineIdentityConfig }> = readUserConfig,
): Promise<OwnerConfig> {
  const { config } = await readUser();
  return resolveMachineSpecOwner(config);
}

/**
 * Build the daemon's owner-resolution thunk (A2). Resolves FRESH on every call
 * (no caching) so a reconfigured `spec_owner` or changed gh login takes effect
 * on the next discovery pass (FR-14). Identity comes from the user config →
 * `gh` login → unresolved chain; project config is never in the path.
 */
export function makeMachineOwnerResolver(
  gh: GhRunner,
  cwd: string,
  readUser: () => Promise<{ config: MachineIdentityConfig }> = readUserConfig,
): () => Promise<OwnerResolution> {
  return async () => resolveDaemonOwner(await readMachineOwnerConfig(readUser), gh, cwd);
}
