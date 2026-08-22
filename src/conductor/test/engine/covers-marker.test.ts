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

  it.each(['S3', 'task:'])('rejects malformed token %s by name', (token) => {
    expect(() => parseCoversMarkers(`Covers: ${token}`)).toThrow(token);
  });
});
