// Covers: task:22
import { describe, expect, it } from 'vitest';
import { parseCoherenceArtifact } from '../../../src/engine/engineer/coherence-validator.js';

describe('coherence covered-only regression', () => {
  it('accepts an M-tier artifact containing only covered rows and no contradiction verdict', () => {
    const parsed = parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |\n| --- | --- | --- | --- | --- | --- |\n| criterion | Story 1 happy: Given a widget, when shipped, then it arrives | task-1 | covered | "Task 1 ships it." | diff-local |\n`);
    expect(parsed).not.toHaveProperty('kind');
  });
});
