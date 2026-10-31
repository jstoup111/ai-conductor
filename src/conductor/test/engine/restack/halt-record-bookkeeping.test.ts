// Covers: task:1
import { describe, expect, it } from 'vitest';

import { renderHaltRecord, supersedeHaltRecordText } from '../../../src/engine/halt-record.js';
import {
  chooseHaltRecord,
  haltRecordPathFor,
  haltRecordTime,
} from '../../../src/engine/restack/halt-record-bookkeeping.js';

function haltedRecord(haltedAt: string): string {
  return renderHaltRecord({
    slug: 'demo',
    haltClass: 'needs-human',
    step: 'build',
    phase: 'BUILD',
    branch: 'feat/demo',
    headSha: 'a'.repeat(40),
    haltedAt,
    haltBody: 'halted for review\n',
  });
}

function resolvedRecord(haltedAt: string, resolvedAt: string): string {
  return supersedeHaltRecordText(haltedRecord(haltedAt), {
    cause: 'operator resume',
    resolvedAt,
  });
}

describe('halt record bookkeeping', () => {
  it('chooses the record with the later resolved or halted time', () => {
    expect(chooseHaltRecord(
      resolvedRecord('2026-10-26T10:00:00.000Z', '2026-10-26T12:30:00.000Z'),
      haltedRecord('2026-10-26T11:00:00.000Z'),
    )).toBe('parent');
    expect(chooseHaltRecord(
      resolvedRecord('2026-10-26T09:00:00.000Z', '2026-10-26T10:00:00.000Z'),
      haltedRecord('2026-10-26T12:05:00.000Z'),
    )).toBe('range');
  });

  it('keeps the parent for ties and malformed range times', () => {
    const sameTime = '2026-10-26T12:00:00.000Z';
    expect(chooseHaltRecord(haltedRecord(sameTime), haltedRecord(sameTime))).toBe('parent');
    expect(chooseHaltRecord(haltedRecord(sameTime), 'Halted at: not-a-time\n')).toBe('parent');
    expect(chooseHaltRecord(haltedRecord(sameTime), 'Halted at: October 26, 2026\n')).toBe('parent');
    expect(chooseHaltRecord(haltedRecord(sameTime), 'Halted at: 2026-02-30T12:00:00Z\n')).toBe('parent');
    expect(chooseHaltRecord('Halted at: not-a-time\n', 'Halted at: still-not-a-time\n')).toBe('parent');
  });

  it('chooses the range for its only parseable time or any record absent from the parent', () => {
    expect(chooseHaltRecord('Halted at: not-a-time\n', haltedRecord('2026-10-26T12:00:00.000Z'))).toBe('range');
    expect(chooseHaltRecord(undefined, haltedRecord('2026-10-26T12:00:00.000Z'))).toBe('range');
    expect(chooseHaltRecord(undefined, 'legacy halt record\n')).toBe('range');
  });

  it('keeps the parent when the range record is absent', () => {
    expect(chooseHaltRecord(haltedRecord('2026-10-26T12:00:00.000Z'), undefined)).toBe('parent');
    expect(chooseHaltRecord(undefined, undefined)).toBe('parent');
  });

  it('prefers Resolved at over Halted at and returns the halt-record path', () => {
    const record = resolvedRecord('2026-10-26T12:00:00.000Z', '2026-10-26T10:00:00.000Z');
    expect(haltRecordTime(record)?.toISOString()).toBe('2026-10-26T10:00:00.000Z');
    expect(haltRecordPathFor('demo')).toBe('.docs/halted/demo.md');
  });
});
