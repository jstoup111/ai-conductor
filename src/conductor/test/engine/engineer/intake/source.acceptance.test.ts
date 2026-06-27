// Acceptance: IntakeSource capture interface (FR-25, Story 1).
// RED until intake/source.ts exists. The engineer core depends on this interface,
// never a concrete adapter; claude-session stays synchronous (not an IntakeSource).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function loadSource() {
  return import('../../../../src/engine/engineer/intake/source.js') as Promise<any>;
}

describe('FR-25 IntakeSource capture interface', () => {
  it('exposes an IntakeSource contract with poll()', async () => {
    const mod = await loadSource();
    // A conforming object must have poll(): Promise<Envelope[]>.
    const conforming = { poll: async () => [] };
    // isIntakeSource is the runtime guard the module exports for the contract.
    expect(typeof mod.isIntakeSource).toBe('function');
    expect(mod.isIntakeSource(conforming)).toBe(true);
  });

  it('rejects an object missing poll() as not an IntakeSource', async () => {
    const mod = await loadSource();
    expect(mod.isIntakeSource({})).toBe(false);
    expect(mod.isIntakeSource({ report: async () => {} })).toBe(false);
  });

  it('loop.ts imports no concrete intake adapter (loose coupling)', () => {
    const loopSrc = readFileSync(
      join(__dirname, '../../../../src/engine/engineer/loop.ts'),
      'utf8',
    );
    expect(loopSrc).not.toMatch(/from '\.\/intake\/github-issues/);
    expect(loopSrc).not.toMatch(/from '\.\/intake\/claude-session/);
  });
});
