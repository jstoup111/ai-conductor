// Covers: task:14
import { describe, expect, it } from 'vitest';
import { resumeOwnershipMode } from '../../../src/engine/engineer/resume.js';

describe('resume ownership', () => {
  it('Covers: Task 14 requires an interactive approved takeover and otherwise remains local-only', () => {
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: false, approved: true })).toBe('taken-over');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: true, approved: true })).toBe('local-only');
  });
});
