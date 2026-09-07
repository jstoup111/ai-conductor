// Covers: task:4
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  PLAN_TASK_HARD_STOP_BOUNDARY,
  PLAN_TASK_WARNING_BOUNDARY,
  parseDocumentedPlanTaskBands,
} from '../../src/engine/plan-task-count.js';

const planSkillPath = fileURLToPath(
  new URL('../../../../skills/plan/SKILL.md', import.meta.url),
);

const documentedBands = {
  warningBoundary: PLAN_TASK_WARNING_BOUNDARY,
  hardStopBoundary: PLAN_TASK_HARD_STOP_BOUNDARY,
};

const WELL_FORMED_BAND_TABLE = [
  '| Task Count | Action |',
  '|---|---|',
  '| 1-20 | Normal — proceed |',
  '| 21-40 | Warning — surface to user |',
  '| 41+ | Hard stop — refused at land |',
].join('\n');

describe('plan skill task-count band contract', () => {
  it('documents the same boundaries enforced by the engine', async () => {
    const skill = await readFile(planSkillPath, 'utf8');

    expect(parseDocumentedPlanTaskBands(skill)).toEqual(documentedBands);
  });

  it('parses a well-formed documented band table', () => {
    expect(parseDocumentedPlanTaskBands(WELL_FORMED_BAND_TABLE)).toEqual({
      warningBoundary: 21,
      hardStopBoundary: 41,
    });
  });

  it('exposes drifted documented boundaries for comparison with the enforced constants', () => {
    const drifted = WELL_FORMED_BAND_TABLE
      .replace('21-40', '22-41')
      .replace('41+', '42+');

    expect(parseDocumentedPlanTaskBands(drifted)).toEqual({
      warningBoundary: 22,
      hardStopBoundary: 42,
    });
    expect(parseDocumentedPlanTaskBands(drifted)).not.toEqual(documentedBands);
  });

  it('returns no bands when the skill text has no recognizable band table', () => {
    expect(parseDocumentedPlanTaskBands('# Plan skill\n\nNo task count table exists.')).toBeUndefined();
  });
});
