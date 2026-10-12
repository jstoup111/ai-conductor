// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  isLegalChildStatusTransition,
  isLegalJournalTransition,
  parseCommitSha,
  parseRefName,
  type ChildStatus,
  type JournalState,
} from '../../../src/engine/restack/restack-types.js';

const journalStates: readonly JournalState[] = [
  'planned',
  'ready',
  'moved',
  'synced',
  'applied',
  'aborted',
  'rolling-back',
];

const legalJournalTransitions = new Set([
  'planned:ready',
  'ready:moved',
  'moved:synced',
  'synced:applied',
  'planned:aborted',
  'ready:aborted',
  'moved:rolling-back',
  'rolling-back:aborted',
]);

const childStatuses: readonly ChildStatus[] = ['pending', 'replayed', 'resolved'];
const legalChildStatusTransitions = new Set([
  'pending:replayed',
  'pending:resolved',
  'replayed:resolved',
]);

describe('restack typed values', () => {
  it('parses only full lowercase hexadecimal object names as commit SHAs', () => {
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);

    expect(parseCommitSha(sha1)).toBe(sha1);
    expect(parseCommitSha(sha256)).toBe(sha256);
    expect(parseCommitSha('a'.repeat(39))).toBeUndefined();
    expect(parseCommitSha('A'.repeat(40))).toBeUndefined();
    expect(parseCommitSha('refs/heads/main')).toBeUndefined();
    expect(parseCommitSha('')).toBeUndefined();
  });

  it('parses only refs namespace names as ref names', () => {
    expect(parseRefName('refs/conductor/demo/restack/journal')).toBe('refs/conductor/demo/restack/journal');
    expect(parseRefName('main')).toBeUndefined();
    expect(parseRefName('')).toBeUndefined();
  });

  it.each(journalStates.flatMap((from) => journalStates.map((to) => [from, to] as const)))
  ('allows only the journal transitions defined by the restack journal', (from, to) => {
    expect(isLegalJournalTransition(from, to)).toBe(legalJournalTransitions.has(`${from}:${to}`));
  });

  it.each(childStatuses.flatMap((from) => childStatuses.map((to) => [from, to] as const)))
  ('allows only the child status transitions defined by the restack journal', (from, to) => {
    expect(isLegalChildStatusTransition(from, to)).toBe(legalChildStatusTransitions.has(`${from}:${to}`));
  });
});
