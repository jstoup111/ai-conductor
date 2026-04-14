import fs from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../types/config.js';
import type { EnforcementLevel } from '../types/steps.js';
import { getStepDefinition } from './steps.js';
import type { StepName } from '../types/steps.js';

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
  const overridePath = config.skills?.overrides?.[stepName];

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
