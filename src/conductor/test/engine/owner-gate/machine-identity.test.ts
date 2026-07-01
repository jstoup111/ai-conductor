import { describe, it, expect } from 'vitest';
import {
  resolveMachineSpecOwner,
  readMachineOwnerConfig,
  makeMachineOwnerResolver,
} from '../../../src/engine/owner-gate/machine-identity.js';
import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';

// A gh runner that would resolve to a DIFFERENT login than any configured
// spec_owner, so tests can prove the user-config value wins (Story 8) and that
// the fallback is reached only when user config is absent (Story 1).
const ghAs = (login: string): GhRunner => async () => ({ stdout: `${login}\n` });
const ghUnauth: GhRunner = async () => {
  throw new Error('gh: not authenticated');
};

describe('owner-gate/machine-identity — machine-scoped identity read (D1)', () => {
  describe('resolveMachineSpecOwner', () => {
    it('extracts spec_owner from a USER config object', () => {
      expect(resolveMachineSpecOwner({ spec_owner: 'jstoup111' })).toEqual({
        spec_owner: 'jstoup111',
      });
    });

    it('returns spec_owner null when absent (so the gh fallback engages)', () => {
      expect(resolveMachineSpecOwner({})).toEqual({ spec_owner: null });
    });

    it('reads ONLY spec_owner — every other config key is dropped from the identity path', () => {
      // Structural anti-leak (D1): the function takes a user-config object and
      // yields ONLY its spec_owner. No project config surface can enter identity.
      const userCfg = {
        spec_owner: 'bill',
        harness_version: '>=1.0.0',
        owner_gate_cutover: '2026-06-30T00:00:00Z',
      } as { spec_owner?: string | null };
      expect(resolveMachineSpecOwner(userCfg)).toEqual({ spec_owner: 'bill' });
    });
  });

  describe('readMachineOwnerConfig', () => {
    it('reads spec_owner from the injected user-config reader only', async () => {
      const readUser = async () => ({ config: { spec_owner: 'jstoup111' } });
      expect(await readMachineOwnerConfig(readUser)).toEqual({ spec_owner: 'jstoup111' });
    });

    it('yields spec_owner null when the user config has none', async () => {
      const readUser = async () => ({ config: {} as { spec_owner?: string | null } });
      expect(await readMachineOwnerConfig(readUser)).toEqual({ spec_owner: null });
    });
  });

  describe('makeMachineOwnerResolver (daemon wiring seam — A2)', () => {
    it('resolves the owner from USER config, never project config', async () => {
      // Story 1 (negative / leak attempt): a project value must never be read.
      // The resolver only takes the user-config reader + gh, so a committed
      // project spec_owner is structurally out of reach. gh would resolve to a
      // *different* login, proving the user value is what wins.
      const readUser = async () => ({ config: { spec_owner: 'bill' } });
      const resolve = makeMachineOwnerResolver(ghAs('someone-else'), '/repo', readUser);
      expect(await resolve()).toEqual({ resolved: true, id: 'bill' });
    });

    it('falls back to gh login when user config has no spec_owner', async () => {
      const readUser = async () => ({ config: {} as { spec_owner?: string | null } });
      const resolve = makeMachineOwnerResolver(ghAs('jstoup111'), '/repo', readUser);
      expect(await resolve()).toEqual({ resolved: true, id: 'jstoup111' });
    });

    it('explicit user spec_owner wins over an ambient gh login (Story 8)', async () => {
      const readUser = async () => ({ config: { spec_owner: 'jstoup111' } });
      const resolve = makeMachineOwnerResolver(ghAs('jstoup-alt'), '/repo', readUser);
      expect(await resolve()).toEqual({ resolved: true, id: 'jstoup111' });
    });

    it('is unresolved when neither user config nor gh resolves (fail-closed input)', async () => {
      const readUser = async () => ({ config: {} as { spec_owner?: string | null } });
      const resolve = makeMachineOwnerResolver(ghUnauth, '/repo', readUser);
      expect(await resolve()).toEqual({ resolved: false });
    });
  });
});
