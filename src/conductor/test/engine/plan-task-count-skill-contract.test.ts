// Covers: task:4
import { readFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  PLAN_TASK_HARD_STOP_BOUNDARY,
  PLAN_TASK_WARNING_BOUNDARY,
} from '../../src/engine/plan-task-count.js';

const execFile = promisify(execFileCallback);

const FEATURE_MERGE_BASE = 'b32eeadef679a1b3a92c45e38012bcadcf2bb215';
const PLAN_SKILL_GIT_PATH = 'skills/plan/SKILL.md';
const HARD_STOP_LAND_PROSE =
  'Hard stop — refused when the spec is landed unless the plan carries an authorized scope exception.';
const SCOPE_EXCEPTION_GRAMMAR =
  '`**Scope-exception:** <non-empty rationale>` declaration on one physical line in the plan.';
const LEGACY_MEMORY_INSTRUCTION = 'record the decision in `.memory/decisions/`';
const DOCUMENTED_PLAN_TASK_BANDS = /^\|\s*\d+-\d+\s*\|[^\n]*\r?\n^\|\s*(\d+)-\d+\s*\|[^\n]*\r?\n^\|\s*(\d+)\+\s*\|/m;

function parseDocumentedPlanTaskBands(skillText: string): {
  warningBoundary: number;
  hardStopBoundary: number;
} | undefined {
  const match = skillText.match(DOCUMENTED_PLAN_TASK_BANDS);
  if (!match) return undefined;
  return {
    warningBoundary: Number(match[1]),
    hardStopBoundary: Number(match[2]),
  };
}

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

  it('documents the hard-stop landing rule and its single scope-exception declaration', async () => {
    const skill = await readFile(planSkillPath, 'utf8');

    expect(skill).toContain(HARD_STOP_LAND_PROSE);
    expect(skill).toContain(SCOPE_EXCEPTION_GRAMMAR);
    expect(skill).not.toContain(LEGACY_MEMORY_INSTRUCTION);
  });

  it('makes the delivered hard-stop prose assertions fail against the feature merge base', async () => {
    const { stdout: mergeBaseSkill } = await execFile(
      'git',
      ['show', `${FEATURE_MERGE_BASE}:${PLAN_SKILL_GIT_PATH}`],
      { cwd: fileURLToPath(new URL('../../../../', import.meta.url)) },
    );

    expect(mergeBaseSkill).not.toContain(HARD_STOP_LAND_PROSE);
    expect(mergeBaseSkill).not.toContain(SCOPE_EXCEPTION_GRAMMAR);
    expect(mergeBaseSkill).toContain(LEGACY_MEMORY_INSTRUCTION);
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
