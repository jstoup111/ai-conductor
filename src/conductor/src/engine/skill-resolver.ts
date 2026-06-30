import fs from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../types/config.js';
import type { EnforcementLevel } from '../types/steps.js';
import { getStepDefinition } from './steps.js';
import type { StepName } from '../types/steps.js';

// ─── Memory guidance skill resolution (FR-4) ──────────────────────────────────

const DEFAULT_MEMORY_SKILL = 'skills/memory/SKILL.md';

/** Minimal provider shape needed for guidance resolution. */
interface MemoryProviderRef {
  name: string;
  kind: 'memory_provider';
  guidance?: string;
}

/** Mutable context that accumulates non-fatal warnings during resolution. */
export interface GuidanceResolutionCtx {
  warnings: string[];
}

/** Result of resolving a memory guidance skill path. */
export interface GuidanceSkillResolution {
  path: string;
}

/**
 * Resolve which guidance skill the memory step should surface to the agent,
 * based on the active memory provider.
 *
 * Contract (FR-4, adr-2026-06-29-per-provider-retrieval-guidance-location):
 *   - `local` provider                     → default `skills/memory/SKILL.md`, no warning.
 *   - non-local + contained guidance path  → the declared guidance path, no warning.
 *   - non-local + escaping guidance path   → default path + exactly ONE warning.
 *   - non-local, no guidance               → default path + exactly ONE warning on ctx.warnings.
 *
 * @param opts.config - Reserved for future provider-specific configuration; unused today.
 *
 * This function is total: it never throws (except on invalid arguments — see guard below).
 *
 * TODO(phase-2-wiring): framework primitive — NOT yet invoked by the live memory step.
 * `resolveSkill` still unconditionally returns `skills/memory/SKILL.md`; this resolver is
 * exercised only by tests. Wire it in (connect `resolveSkill` / the memory-step runner to
 * this function) when a concrete non-default provider ships. In Phase 1 the registry is empty,
 * so the resolver always yields `local` and this path cannot differ from the default at runtime.
 */
export async function resolveMemoryGuidanceSkill(opts: {
  provider: MemoryProviderRef;
  /** Reserved for future provider-specific configuration. */
  config: Record<string, unknown>;
  projectRoot: string;
  ctx: GuidanceResolutionCtx;
}): Promise<GuidanceSkillResolution> {
  // Contract expects typed callers; a null/undefined provider or non-array warnings
  // would produce an obscure TypeError later — surface the failure explicitly.
  if (!opts?.provider || !Array.isArray(opts?.ctx?.warnings)) {
    throw new Error('resolveMemoryGuidanceSkill: invalid arguments');
  }

  const { provider, projectRoot, ctx } = opts;

  if (provider.name === 'local') {
    return { path: DEFAULT_MEMORY_SKILL };
  }

  if (provider.guidance) {
    // Containment check: resolve both root and candidate to absolute paths,
    // then verify the candidate stays inside root (use sep boundary to prevent
    // sibling-prefix attacks like <root>-evil matching a naive startsWith(root)).
    const root = path.resolve(projectRoot);
    const abs = path.resolve(root, provider.guidance);
    const contained = abs === root || abs.startsWith(root + path.sep);

    if (contained) {
      return { path: provider.guidance };
    }

    // Escaping path — degrade exactly like the missing-guidance branch.
    ctx.warnings.push(
      `Provider "${provider.name}" guidance path escapes projectRoot; degrading to local default (${DEFAULT_MEMORY_SKILL})`,
    );
    return { path: DEFAULT_MEMORY_SKILL };
  }

  // Non-local provider with absent or empty guidance — degrade safely.
  ctx.warnings.push(
    `Provider "${provider.name}" declares no guidance skill; degrading to local default (${DEFAULT_MEMORY_SKILL})`,
  );
  return { path: DEFAULT_MEMORY_SKILL };
}

export interface ResolvedSkill {
  path: string;
  enforcement: EnforcementLevel;
  isOverride: boolean;
}

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description', 'enforcement', 'phase'];

/** Steps whose enforcement level cannot be overridden by project-local skills. */
const ENFORCEMENT_LOCKED_STEPS: ReadonlySet<string> = new Set([
  'stories',
  'plan',
  'build',
  'finish',
]);

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      fields[key] = value;
    }
  }
  return fields;
}

function validateOverrideFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill override not found: ${filePath} does not exist`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter) {
    throw new Error(`Skill override ${filePath} has no YAML frontmatter`);
  }

  const missing = REQUIRED_FRONTMATTER_FIELDS.filter((f) => !frontmatter[f]);
  if (missing.length > 0) {
    throw new Error(
      `Skill override ${filePath} missing required frontmatter fields: ${missing.join(', ')}`,
    );
  }

  return frontmatter;
}

export function resolveSkill(
  stepName: string,
  config: HarnessConfig,
  projectRoot: string,
): ResolvedSkill {
  const stepDef = getStepDefinition(stepName as StepName);
  // New schema: per-step skill override lives at config.steps.<name>.skill
  const overridePath = config.steps?.[stepName]?.skill;

  if (overridePath) {
    const fullPath = path.join(projectRoot, overridePath);
    const frontmatter = validateOverrideFile(fullPath);

    const enforcement = ENFORCEMENT_LOCKED_STEPS.has(stepName)
      ? stepDef.enforcement
      : (frontmatter.enforcement as EnforcementLevel);

    return {
      path: fullPath,
      enforcement,
      isOverride: true,
    };
  }

  const skillName = stepDef.skillName ?? stepName;
  return {
    path: `skills/${skillName}/SKILL.md`,
    enforcement: stepDef.enforcement,
    isOverride: false,
  };
}
