import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import type { StepName } from '../src/types/steps.js';
import { DEFAULT_STEP_MODELS } from '../src/engine/resolved-config.js';
import {
  STEP_RATIONALE,
  SKILL_STEP_MAP,
  PIN_EXEMPT_SKILLS,
  EXTRA_MODEL_TABLE_ROWS,
} from '../src/engine/model-table-metadata.js';
import { classifyPinnedSkill } from '../src/tools/generate-model-table.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for STEP_RATIONALE metadata (.docs/stories/generated-model-table.md,
// TS-1 happy path 1; negative path 1 — compile-time enforcement).
// ─────────────────────────────────────────────────────────────────────────────

describe('STEP_RATIONALE completeness (TS-1)', () => {
  it('has a non-empty rationale entry for every key in DEFAULT_STEP_MODELS', () => {
    const missing: string[] = [];
    const empty: string[] = [];

    for (const step of Object.keys(DEFAULT_STEP_MODELS) as StepName[]) {
      if (!(step in STEP_RATIONALE)) {
        missing.push(step);
        continue;
      }
      if (STEP_RATIONALE[step].trim().length === 0) {
        empty.push(step);
      }
    }

    expect(missing).toEqual([]);
    expect(empty).toEqual([]);
  });

  it('type-checks as a complete Record<StepName, string>', () => {
    // Compile-time assertion: if STEP_RATIONALE were missing a key or had a
    // non-string value, this would fail to typecheck.
    const typed = STEP_RATIONALE satisfies Record<StepName, string>;
    expect(typed).toBe(STEP_RATIONALE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRA_MODEL_TABLE_ROWS completeness (.docs/stories/generated-model-table.md,
// TS-1 happy path 2). Every current non-engine HARNESS.md row name must
// appear exactly once — hardcoded expected set reconciled against today's
// HARNESS.md model-selection table.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_EXTRA_ROW_NAMES = [
  'verify-claims',
  'domain-reviewer',
  'evaluator',
  'code-review',
  'debugging',
  'simplify',
  'engineer',
  'intake',
  'conduct',
  'pr',
  'tdd-red',
  'tdd-green',
  'cto-security',
  'cto-data-integrity',
  'cto-dependencies',
  'cto-architecture',
  'cto-duplication',
  'cto-testing',
  'cto-infrastructure',
  'cto-observability',
  'cto-devex',
  'cto-orchestrator',
];

describe('EXTRA_MODEL_TABLE_ROWS completeness (TS-1 happy path 2)', () => {
  it('contains every expected non-engine HARNESS.md row name exactly once', () => {
    const names = EXTRA_MODEL_TABLE_ROWS.map((row) => row.name);

    for (const expected of EXPECTED_EXTRA_ROW_NAMES) {
      const occurrences = names.filter((name) => name === expected);
      expect(occurrences.length, `expected exactly one "${expected}" row, found ${occurrences.length}`).toBe(1);
    }

    expect(names.length).toBe(EXPECTED_EXTRA_ROW_NAMES.length);
  });

  it('has non-empty model and rationale text for every row', () => {
    for (const row of EXTRA_MODEL_TABLE_ROWS) {
      expect(row.model.trim().length, `row "${row.name}" has empty model text`).toBeGreaterThan(0);
      expect(row.rationale.trim().length, `row "${row.name}" has empty rationale text`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyPinnedSkill (.docs/stories/generated-model-table.md, TS-1 happy path 3;
// negative path 2 / TS-4).
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyPinnedSkill', () => {
  it('returns "no-pin" when the skill has no model pin', () => {
    expect(classifyPinnedSkill('some-skill', false, SKILL_STEP_MAP, PIN_EXEMPT_SKILLS)).toEqual({
      status: 'no-pin',
      skill: 'some-skill',
    });
  });

  it('returns "mapped" with the engine step for a pinned + mapped skill', () => {
    expect(classifyPinnedSkill('rebase', true, SKILL_STEP_MAP, PIN_EXEMPT_SKILLS)).toEqual({
      status: 'mapped',
      skill: 'rebase',
      step: 'rebase',
    });
  });

  it('returns "exempt" for a pinned skill with no engine step', () => {
    expect(classifyPinnedSkill('code-review', true, SKILL_STEP_MAP, PIN_EXEMPT_SKILLS)).toEqual({
      status: 'exempt',
      skill: 'code-review',
    });
  });

  it('returns a failure record naming the skill when a pinned skill is neither mapped nor exempt', () => {
    const result = classifyPinnedSkill('mystery-skill', true, SKILL_STEP_MAP, PIN_EXEMPT_SKILLS);
    expect(result).toEqual({ status: 'unmapped', skill: 'mystery-skill' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real skills/ directory scan: every `model:` pin in skills/*/SKILL.md must be
// covered by SKILL_STEP_MAP or PIN_EXEMPT_SKILLS (TS-1 happy path 3).
// ─────────────────────────────────────────────────────────────────────────────

const testFileDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(testFileDir, '..', '..', '..', 'skills');

function readSkillModelPin(skillDir: string): string | undefined {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return undefined;
  const content = readFileSync(skillMdPath, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return undefined;
  const frontmatter = loadYaml(frontmatterMatch[1]) as Record<string, unknown> | undefined;
  const model = frontmatter?.model;
  return typeof model === 'string' ? model : undefined;
}

describe('real skills/*/SKILL.md pins are covered (TS-1)', () => {
  it('every model: pin is mapped in SKILL_STEP_MAP or listed in PIN_EXEMPT_SKILLS', () => {
    const skillNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(skillNames.length).toBeGreaterThan(0);

    const unmapped: string[] = [];

    for (const skillName of skillNames) {
      const pin = readSkillModelPin(join(skillsDir, skillName));
      const classification = classifyPinnedSkill(skillName, pin !== undefined, SKILL_STEP_MAP, PIN_EXEMPT_SKILLS);
      if (classification.status === 'unmapped') {
        unmapped.push(skillName);
      }
    }

    expect(unmapped).toEqual([]);
  });
});

// Type-level negative fixture: a rationale record missing a required key must
// fail to typecheck against Record<StepName, string>. Not executed — this
// file is only meaningful to `tsc`/`vitest --typecheck`.
function _typeFixture() {
  const incomplete = {
    bootstrap: 'x',
    memory: 'x',
    assess: 'x',
    explore: 'x',
    prd: 'x',
    complexity: 'x',
    stories: 'x',
    conflict_check: 'x',
    plan: 'x',
    architecture_diagram: 'x',
    architecture_review: 'x',
    worktree: 'x',
    acceptance_specs: 'x',
    build: 'x',
    manual_test: 'x',
    prd_audit: 'x',
    architecture_review_as_built: 'x',
    retro: 'x',
    rebase: 'x',
    finish: 'x',
    // 'remediate' intentionally omitted
  };
  // @ts-expect-error missing required key "remediate" must fail typecheck
  const shouldFail = incomplete satisfies Record<StepName, string>;
  return shouldFail;
}
