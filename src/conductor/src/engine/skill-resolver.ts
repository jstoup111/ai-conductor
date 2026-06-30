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
 *   - `local` provider        → default `skills/memory/SKILL.md`, no warning.
 *   - non-local + guidance    → the declared guidance path, no warning.
 *   - non-local, no guidance  → default path + exactly ONE warning on ctx.warnings.
 *
 * This function is total: it never throws.
 */
export async function resolveMemoryGuidanceSkill(opts: {
  provider: MemoryProviderRef;
  config: Record<string, unknown>;
  projectRoot: string;
  ctx: GuidanceResolutionCtx;
}): Promise<GuidanceSkillResolution> {
  const { provider, ctx } = opts;

  if (provider.name === 'local') {
    return { path: DEFAULT_MEMORY_SKILL };
  }

  if (provider.guidance) {
    return { path: provider.guidance };
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
