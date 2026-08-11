import { describe, expect, it } from 'vitest';
import { extractPrdFrIds } from '../src/engine/prd-fr-ids.js';

describe('extractPrdFrIds', () => {
  it('extracts normalized FR ids only from the Functional Requirements section', () => {
    const prd = `# PRD

## Functional Requirements

- fr-1: Base requirement
- FR-12a: Suffix requirement

## Non-functional Requirements

- FR-99: Not a functional requirement
`;

    expect(extractPrdFrIds(prd)).toEqual(new Set(['FR-1', 'FR-12A']));
  });

  it('returns no ids when the Functional Requirements heading is absent', () => {
    expect(extractPrdFrIds('# PRD\n\n- FR-1: Unscoped')).toEqual(new Set());
  });
});
