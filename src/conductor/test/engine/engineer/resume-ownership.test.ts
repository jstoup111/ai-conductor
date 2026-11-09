// Covers: task:14
import { describe, expect, it } from 'vitest';
import { resumeOwnershipMode } from '../../../src/engine/engineer/resume.js';
import { decideSpecGate } from '../../../src/engine/owner-gate/gate.js';

describe('resume ownership', () => {
  it('Covers: Task 14 requires an interactive approved takeover and otherwise remains local-only', () => {
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: false, approved: true })).toBe('taken-over');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: true, approved: true })).toBe('local-only');
  });

  it('Covers: Task 14 refuses unresolved ownership and never grants takeover to declined, non-TTY, or daemon sessions', () => {
    expect(() => resumeOwnershipMode({ committedOwner: 'A', daemonSession: false, interactive: true })).toThrow(/identity is unresolved/);
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: false, approved: false })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false, approved: true })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: true, approved: true })).toBe('local-only');
  });

  it('Covers: Task 14 gates the re-stamped owner branch to that daemon owner only', () => {
    const stamp = { present: true as const, id: 'B' };
    expect(decideSpecGate({ daemonOwner: { id: 'B' }, stamp, mergeTime: null, cutover: null })).toEqual({ build: true });
    expect(decideSpecGate({ daemonOwner: { id: 'A' }, stamp, mergeTime: null, cutover: null })).toEqual({ build: false, reason: 'other-owner', other: 'B' });
  });
});
