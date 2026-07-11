import { describe, it, expect } from 'vitest';

import type { ConductorEvent } from '../src/types/events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: type-level acceptance test for the new build_progress /
// build_no_progress event kinds (adr-2026-07-10-intra-step-build-progress-events).
//
// This is a compile-time assertion: if `ConductorEvent` does not include these
// members with these exact fields, `npx tsc --noEmit` fails on this file. The
// runtime assertions just prove the values survive assignment unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe('ConductorEvent union includes build_progress and build_no_progress', () => {
  it('accepts a minimal build_progress event', () => {
    const event: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 5,
      total: 21,
    };

    expect(event.type).toBe('build_progress');
  });

  it('accepts a fully-populated build_progress event', () => {
    const event: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 6,
      total: 21,
      currentTaskId: '21',
      currentTaskName: 'Wire watcher into conductor',
      commitCount: 3,
      noEvidenceAttempts: 0,
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };

    expect(event.type).toBe('build_progress');
    if (event.type === 'build_progress') {
      expect(event.resolved).toBe(6);
      expect(event.total).toBe(21);
      expect(event.featureSlug).toBe('emit-intra-step-build-progress-and-stall-as-events');
    }
  });

  it('accepts a minimal build_no_progress event', () => {
    const event: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
    };

    expect(event.type).toBe('build_no_progress');
  });

  it('accepts a fully-populated build_no_progress event', () => {
    const event: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      lastCommitAt: 1720000000000,
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };

    expect(event.type).toBe('build_no_progress');
    if (event.type === 'build_no_progress') {
      expect(event.quietMinutes).toBe(15);
      expect(event.lastCommitAt).toBe(1720000000000);
    }
  });
});
