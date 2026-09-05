import { describe, expect, it } from 'vitest';
import { parseCoversMarkers } from '../../src/engine/covers-marker.js';

describe('parseCoversMarkers', () => {
  const expectedReferences = [
    { kind: 'fr', id: 'FR-2' },
    { kind: 'criterion', id: 'S3.1' },
    { kind: 'task', id: '7' },
  ];

  it('parses FR, story-criterion, and task references from a leading comment line', () => {
    expect(parseCoversMarkers('// Covers: FR-2, S3.1, task:7\nexport {}'))
      .toEqual(expectedReferences);
  });

  it('parses the same references from a suite name', () => {
    expect(parseCoversMarkers('new-behavior — Covers: FR-2, S3.1, task:7'))
      .toEqual(expectedReferences);
  });

  // Story heading ids use the `[A-Za-z0-9.-]` alphabet, so a test covering
  // `## Story 5a:` cites `S5a.1` and must resolve as a criterion rather than
  // as an unresolved token.
  it.each(['S5a.1', 'S2.1.3'])('resolves criterion %s over the story-id alphabet', (id) => {
    expect(parseCoversMarkers(`Covers: ${id}`)).toEqual([{ kind: 'criterion', id }]);
  });

  it.each(['FR-', 'S3', 'task:', 'S1.a', 'S.1'])('contains malformed token %s as unresolved', (token) => {
    expect(parseCoversMarkers(`Covers: ${token}`)).toEqual([
      { kind: 'unresolved', id: token },
    ]);
  });
});
