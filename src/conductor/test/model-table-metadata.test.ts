import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import type { StepName } from '../src/types/steps.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../src/engine/provider-model-policy.js';
import {
  STEP_RATIONALE,
  MODEL_FREE_ENGINE_STEPS,
  SKILL_STEP_MAP,
  PIN_EXEMPT_SKILLS,
  AUXILIARY_MODEL_TABLE_ROWS,
  EXTRA_MODEL_TABLE_ROWS,
} from '../src/engine/model-table-metadata.js';
import { classifyPinnedSkill } from '../src/tools/generate-model-table.js';

const CLAUDE_NATIVE_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
const CODEX_NATIVE_MODEL_IDS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

function proseSentences(text: string): string[] {
  return text.split(/[.!?](?:\s|$)/).filter((sentence) => sentence.trim().length > 0);
}

function proseClauses(text: string): string[] {
  return text
    .split(
      /(?<=[.!?;])\s+|\n+|\s+(?:while|whereas)\s+|,\s+(?=(?:and\s+)?(?:Claude|Codex)\b)/i,
    )
    .filter((clause) => clause.trim().length > 0);
}

function containsToken(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replaceAll('.', '\\.')}\\b`, 'i').test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for STEP_RATIONALE metadata (.docs/stories/generated-model-table.md,
// TS-1 happy path 1; negative path 1 — compile-time enforcement).
// ─────────────────────────────────────────────────────────────────────────────

describe('STEP_RATIONALE completeness (TS-1)', () => {
  it('classifies only the deterministic BUILD gates as model-free engine machinery', () => {
    expect(MODEL_FREE_ENGINE_STEPS).toEqual(['wiring_check', 'test_suite']);
  });

  it('describes current explore and prd defaults with provider-neutral high-effort policy language', () => {
    const violations = (['explore', 'prd'] as const).flatMap((step) => {
      const rationale = STEP_RATIONALE[step];
      const usesProviderNeutralPolicyLanguage =
        /\bprovider\b/i.test(rationale) && /\bpolic(?:y|ies)\b/i.test(rationale);
      const usesApprovedHighEffort =
        /\b(?:high(?:-|\s+)effort|effort\b[^.!?;\n]*\bhigh)\b/i.test(rationale);
      const usesStaleLanguage =
        /\bClaude\b|DEFAULT_STEP_(?:MODELS|EFFORT|TIER_OVERRIDES)|\bmedium(?:-effort|\s+effort)?\b/i.test(
          rationale,
        );

      return usesProviderNeutralPolicyLanguage && usesApprovedHighEffort && !usesStaleLanguage
        ? []
        : [step];
    });

    expect(violations).toEqual([]);
  });

  it('has one non-empty rationale for every step represented by both provider policies', () => {
    const missing: string[] = [];
    const empty: string[] = [];
    const policySteps = new Set([
      ...Object.keys(CLAUDE_MODEL_POLICY.stepModels),
      ...Object.keys(CODEX_MODEL_POLICY.stepModels),
    ]);

    for (const step of policySteps as Set<StepName>) {
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
    expect(policySteps.size).toBe(26);
  });

  it('describes deterministic BUILD gates as engine machinery rather than generative review', () => {
    expect({
      wiring_check: STEP_RATIONALE.wiring_check,
      test_suite: STEP_RATIONALE.test_suite,
    }).toEqual({
      wiring_check: expect.stringMatching(/deprecated/i),
      test_suite: expect.stringMatching(
        /mechanical.*(?:aggregate|full).*test.*(?:verifier|proof)/i,
      ),
    });
  });

  it('type-checks as a complete Record<StepName, string>', () => {
    // Compile-time assertion: if STEP_RATIONALE were missing a key or had a
    // non-string value, this would fail to typecheck.
    const typed = STEP_RATIONALE satisfies Record<StepName, string>;
    expect(typed).toBe(STEP_RATIONALE);
  });

  it('keeps shared autonomous rationales provider-neutral unless a native model name is provider-labelled', () => {
    const nestedAgentRationaleSteps = new Set<StepName>(['assess']);
    const violations = Object.entries(STEP_RATIONALE).flatMap(([step, rationale]) => {
      if (nestedAgentRationaleSteps.has(step as StepName)) return [];
      const hasUnlabelledSentence = proseSentences(rationale).some((sentence) => {
        const namesClaudeModel = CLAUDE_NATIVE_ALIASES.some((alias) =>
          containsToken(sentence, alias),
        );
        const namesCodexModel = CODEX_NATIVE_MODEL_IDS.some((model) =>
          containsToken(sentence, model),
        );
        return (
          (namesClaudeModel && !/\bClaude\b/i.test(sentence)) ||
          (namesCodexModel && !/\bCodex\b/i.test(sentence))
        );
      });

      return hasUnlabelledSentence ? [step] : [];
    });

    expect(violations).toEqual([]);
  });

  it('labels every assess Claude alias while documenting nested specialist-agent selection', () => {
    const rationale = STEP_RATIONALE.assess;
    const sentences = proseSentences(rationale);
    const namedClaudeAliases = [
      ...new Set(
        CLAUDE_NATIVE_ALIASES.filter((alias) => containsToken(rationale, alias)),
      ),
    ].sort();
    const labelsEveryNamedAlias = namedClaudeAliases.every((alias) =>
      sentences.some(
        (sentence) => containsToken(sentence, alias) && /\bClaude\b/i.test(sentence),
      ),
    );

    expect({
      documentsNestedAgents:
        /\bdispatches\b[\s\S]*\bspecialists?\b[\s\S]*\b(?:orchestrator|agent)\b/i.test(rationale),
      namedClaudeAliases,
      labelsEveryNamedAlias,
    }).toEqual({
      documentsNestedAgents: true,
      namedClaudeAliases: ['opus', 'sonnet'],
      labelsEveryNamedAlias: true,
    });
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
  'daemon-triage',
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

  it('documents provider-neutral interactive model inheritance for every extra row', () => {
    const violations = EXTRA_MODEL_TABLE_ROWS.flatMap((row) => {
      const hasInteractiveHostContract =
        row.executionPath === 'supported-host interactive' &&
        row.claudeModel.trim().length > 0 &&
        /\binherit(?:s|ed|ance|ing)?\b/i.test(row.codexModel) &&
        /\binherit(?:s|ed|ance|ing)?\b/i.test(row.codexEffort);

      return hasInteractiveHostContract ? [] : [row.name];
    });

    expect(violations).toEqual([]);
  });
});

describe('AUXILIARY_MODEL_TABLE_ROWS build-review rubric registration', () => {
  it('defines all four retained rubric skills without inventing lifecycle steps', () => {
    const names = AUXILIARY_MODEL_TABLE_ROWS.map((row) => row.name);

    expect(names).toEqual([
      'build-review-tautology',
      'build-review-scope',
      'build-review-root-cause',
      'build-review-completeness',
    ]);
    expect(Object.keys(STEP_RATIONALE)).not.toEqual(expect.arrayContaining(names));
    expect(AUXILIARY_MODEL_TABLE_ROWS.every((row) =>
      row.executionPath === 'engine-managed auxiliary rubric' &&
      row.claudeModel === 'inherits resolved rubric policy' &&
      row.claudeEffort === 'inherits resolved rubric policy' &&
      row.codexModel === 'inherits resolved rubric policy' &&
      row.codexEffort === 'inherits resolved rubric policy',
    )).toBe(true);
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
