// Covers: task:15
// The overlap preflight records its decision through the canonical event spine;
// it never opens a separate diagnostic file or stream.

import { describe, expect, it, vi } from 'vitest';

const { appendFileSpy, appendFileSyncSpy, createWriteStreamSpy, writeFileSpy, writeFileSyncSpy } = vi.hoisted(() => ({
  appendFileSpy: vi.fn(),
  appendFileSyncSpy: vi.fn(),
  createWriteStreamSpy: vi.fn(),
  writeFileSpy: vi.fn(),
  writeFileSyncSpy: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFile: appendFileSpy,
    appendFileSync: appendFileSyncSpy,
    createWriteStream: createWriteStreamSpy,
    writeFile: writeFileSpy,
    writeFileSync: writeFileSyncSpy,
  };
});

import {
  intakeOverlapCheckedEvent,
  runOverlapPreflight,
  type OverlapDecision,
} from '../../src/engine/engineer/intake/overlap-preflight.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';

function input() {
  return {
    title: 'Compare the evidence paths',
    body: 'The affected path is src/review/rubric.ts.',
    dependsOn: [],
    interactive: false,
  };
}

describe('intake overlap check events', () => {
  it('emits one persisted-spine event for a no-overlap check without opening a filesystem writer', async () => {
    const events = new ConductorEventEmitter();
    const seen: ConductorEvent[] = [];
    events.on('intake_overlap_checked', (event) => { seen.push(event); });
    await runOverlapPreflight(input(), {
      repository: 'acme/conductor',
      events,
      suggestions: async () => ({ shown: [], preAccepted: [], advisory: [] }),
    });

    expect(seen).toEqual([{
      type: 'intake_overlap_checked',
      repository: 'acme/conductor',
      outcome: 'proceeded',
      suggested: [],
      accepted: [],
      declined: [],
      undecided: [],
      advisoryCount: 0,
      skipped: [],
    }]);
    expect(
      appendFileSpy.mock.calls.length
      + appendFileSyncSpy.mock.calls.length
      + createWriteStreamSpy.mock.calls.length
      + writeFileSpy.mock.calls.length
      + writeFileSyncSpy.mock.calls.length,
    ).toBe(0);
  });

  it('records proceeded accepted and declined suggestions as decision fields', () => {
    const decision: OverlapDecision = {
      kind: 'proceed',
      accepted: ['acme/conductor#1579'],
      declined: ['acme/conductor#1487'],
      advisory: [],
      skipNotes: [],
      omittedCount: 0,
    };

    expect(intakeOverlapCheckedEvent('acme/conductor', {
      shown: [
        { issue: 'acme/conductor#1579', sharedPaths: ['src/review/rubric.ts'] },
        { issue: 'acme/conductor#1487', sharedPaths: ['src/review/rubric.ts'] },
      ],
      preAccepted: [],
      advisory: [],
    }, decision)).toMatchObject({
      outcome: 'proceeded',
      suggested: ['acme/conductor#1579', 'acme/conductor#1487'],
      accepted: ['acme/conductor#1579'],
      declined: ['acme/conductor#1487'],
      skipped: [],
    });
  });

  it('records pre-accepted and declined suggestions for a non-interactive filing', async () => {
    const events = new ConductorEventEmitter();
    const seen: ConductorEvent[] = [];
    events.on('intake_overlap_checked', (event) => { seen.push(event); });

    await runOverlapPreflight({
      ...input(),
      dependsOn: ['acme/app#1579'],
      declineOverlap: ['acme/app#1487'],
    }, {
      repository: 'acme/app',
      events,
      suggestions: async () => ({
        preAccepted: [{ issue: 'acme/app#1579', sharedPaths: ['src/review/rubric.ts'] }],
        shown: [{ issue: 'acme/app#1487', sharedPaths: ['src/review/rubric.ts'] }],
        advisory: [],
      }),
    });

    expect(seen).toEqual([expect.objectContaining({
      outcome: 'proceeded',
      suggested: ['acme/app#1579', 'acme/app#1487'],
      accepted: ['acme/app#1579'],
      declined: ['acme/app#1487'],
    })]);
  });

  it('records refused undecided suggestions', () => {
    const decision: OverlapDecision = {
      kind: 'refused',
      undecided: [{ issue: 'acme/conductor#1579', sharedPaths: ['src/review/rubric.ts'] }],
      advisory: [],
      skipNotes: [],
      omittedCount: 0,
    };

    expect(intakeOverlapCheckedEvent('acme/conductor', {
      shown: [{ issue: 'acme/conductor#1579', sharedPaths: ['src/review/rubric.ts'] }],
      preAccepted: [],
      advisory: [],
    }, decision)).toMatchObject({
      outcome: 'refused',
      undecided: ['acme/conductor#1579'],
    });
  });

  it('records skipped comparison reasons', () => {
    const decision: OverlapDecision = {
      kind: 'proceed',
      accepted: [],
      declined: [],
      advisory: [],
      skipNotes: [{ part: 'open-issues', reason: 'read timed out' }],
      omittedCount: 0,
    };

    expect(intakeOverlapCheckedEvent('acme/conductor', {
      shown: [], preAccepted: [], advisory: [],
    }, decision).skipped).toEqual([{ part: 'open-issues', reason: 'read timed out' }]);
  });
});
