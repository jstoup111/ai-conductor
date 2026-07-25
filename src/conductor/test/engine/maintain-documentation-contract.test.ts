import { describe, expect, it } from 'vitest';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { loadConfig } from '../../src/engine/config.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import type { HarnessConfig, StepName } from '../../src/types/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const skillName = 'maintain-documentation';
const customStep = skillName as StepName;
const canonicalDir = join(repoRoot, '.agents/skills', skillName);
const canonicalSkill = join(canonicalDir, 'SKILL.md');
const claudeSkillLink = join(repoRoot, '.claude/skills', skillName);

describe('repository-local maintain-documentation contract', () => {
  it('uses one canonical skill and remains opt-in between rebase and finish', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'maintain-documentation-contract-'));
    try {
      const canonicalBytes = await readFile(canonicalSkill).catch(() => null);
      const claudeBytes = await readFile(join(claudeSkillLink, 'SKILL.md')).catch(() => null);
      const claudeLinkStat = await lstat(claudeSkillLink).catch(() => null);
      const claudeTarget = await realpath(claudeSkillLink).catch(() => null);

      const repoConfig = await loadConfig(repoRoot);
      const configuredOrder = repoConfig.ok
        ? buildStepRegistry(repoConfig.config).map((step) => step.name)
        : [];
      const configuredRebase = configuredOrder.indexOf('rebase');
      const configuredStep = repoConfig.ok
        ? repoConfig.config.steps?.[skillName]
        : undefined;

      const missingRoot = join(scratch, 'missing-skill');
      await mkdir(join(missingRoot, '.ai-conductor'), { recursive: true });
      await writeFile(
        join(missingRoot, '.ai-conductor/config.yml'),
        `steps:\n  maintain-documentation:\n    after: rebase\n    skill: .agents/skills/maintain-documentation/SKILL.md\n    enforcement: gating\n    completion_artifact: .pipeline/maintain-documentation-pass\n`,
      );
      const missingSkillConfig = await loadConfig(missingRoot);

      const unconfigured: HarnessConfig = {
        steps: { manual_test: { disable: true } },
      };
      const unconfiguredOrder = buildStepRegistry(unconfigured).map((step) => step.name);
      const unconfiguredRebase = unconfiguredOrder.indexOf('rebase');
      const unconfiguredCompletion = await checkStepCompletion(scratch, customStep, {
        config: unconfigured,
      });

      expect({
        canonicalSkill: canonicalBytes?.includes(Buffer.from('name: maintain-documentation')),
        claudeLink: claudeLinkStat?.isSymbolicLink(),
        claudeTarget,
        byteIdentical:
          canonicalBytes !== null &&
          claudeBytes !== null &&
          canonicalBytes.equals(claudeBytes),
        repoConfigValid: repoConfig.ok,
        configuredStep,
        configuredOrder: configuredOrder.slice(configuredRebase, configuredRebase + 3),
        manualTestDisabled: repoConfig.ok
          ? repoConfig.config.steps?.manual_test?.disable
          : undefined,
        missingSkillError: missingSkillConfig.ok
          ? undefined
          : missingSkillConfig.error.message.replace(missingRoot, '<root>'),
        unconfiguredOrder: unconfiguredOrder.slice(unconfiguredRebase, unconfiguredRebase + 2),
        unconfiguredCompletion,
      }).toEqual({
        canonicalSkill: true,
        claudeLink: true,
        claudeTarget: canonicalDir,
        byteIdentical: true,
        repoConfigValid: true,
        configuredStep: {
          after: 'rebase',
          skill: '.agents/skills/maintain-documentation/SKILL.md',
          enforcement: 'gating',
          completion_artifact: '.pipeline/maintain-documentation-pass',
        },
        configuredOrder: ['rebase', 'maintain-documentation', 'finish'],
        manualTestDisabled: true,
        missingSkillError:
          'Custom step "maintain-documentation" skill file not found: <root>/.agents/skills/maintain-documentation/SKILL.md',
        unconfiguredOrder: ['rebase', 'finish'],
        unconfiguredCompletion: { done: true },
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('defines mode behavior and a PASS-only evidence lifecycle', async () => {
    const skill = await readFile(canonicalSkill, 'utf-8');
    const modeSection = (mode: string): string =>
      skill.match(new RegExp(`### ${mode}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`))?.[1] ?? '';
    const preFinish = modeSection('pre-finish');
    const documentationOnly = modeSection('documentation-only');
    const manualAudit = modeSection('manual-audit');

    expect({
      preFinish: {
        select: /Select:/i.test(preFinish),
        input: /Input:/i.test(preFinish) && /implementation/i.test(preFinish),
        output: /Output:/i.test(preFinish) && /impact verdict/i.test(preFinish),
        commit: /Commit:/i.test(preFinish) && /before PASS/i.test(preFinish),
        changelog: /Changelog:/i.test(preFinish) && /evaluate/i.test(preFinish),
        verdicts: /PASS:/i.test(preFinish) && /BLOCKED:/i.test(preFinish),
      },
      documentationOnly: {
        select: /Select:/i.test(documentationOnly),
        input: /Input:/i.test(documentationOnly) && /requested scope/i.test(documentationOnly),
        output:
          /Output:/i.test(documentationOnly) &&
          /no implementation verdict/i.test(documentationOnly),
        commit: /Commit:/i.test(documentationOnly) && /changes/i.test(documentationOnly),
        changelog:
          /Changelog:/i.test(documentationOnly) &&
          /do not (?:create|change|edit|write)/i.test(documentationOnly),
        verdicts: /PASS:/i.test(documentationOnly) && /BLOCKED:/i.test(documentationOnly),
      },
      manualAudit: {
        select: /Select:/i.test(manualAudit),
        input: /Input:/i.test(manualAudit) && /audit scope/i.test(manualAudit),
        output: /Output:/i.test(manualAudit) && /findings/i.test(manualAudit),
        commit: /Commit:/i.test(manualAudit) && /remediation/i.test(manualAudit),
        changelog:
          /Changelog:/i.test(manualAudit) && /only when/i.test(manualAudit),
        verdicts: /PASS:/i.test(manualAudit) && /BLOCKED:/i.test(manualAudit),
      },
      evidence: {
        reviewPath: skill.includes('.pipeline/maintain-documentation-review.md'),
        passPath: skill.includes('.pipeline/maintain-documentation-pass'),
        removeOldPass: /remove .*maintain-documentation-pass.*before/i.test(skill),
        overwriteReview: /overwrite .*maintain-documentation-review\.md/i.test(skill),
        neverAppendReview: /never append/i.test(skill),
        passOnly: /write .*maintain-documentation-pass.*only (?:after|for|when).*PASS/i.test(
          skill,
        ),
        blockedOmitsPass: /BLOCKED.*(?:leave|keep).*pass marker absent/is.test(skill),
        commitBeforePass: /complete .*commit.*before writing .*maintain-documentation-pass/is.test(
          skill,
        ),
        finalReviewAfterCommit:
          /complete every required commit[\s\S]*overwrite the review with the final/i.test(skill),
        recordsEvidence: /overwrite the review with .*evidence/i.test(skill),
      },
    }).toEqual({
      preFinish: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      documentationOnly: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      manualAudit: {
        select: true,
        input: true,
        output: true,
        commit: true,
        changelog: true,
        verdicts: true,
      },
      evidence: {
        reviewPath: true,
        passPath: true,
        removeOldPass: true,
        overwriteReview: true,
        neverAppendReview: true,
        passOnly: true,
        blockedOmitsPass: true,
        commitBeforePass: true,
        finalReviewAfterCommit: true,
        recordsEvidence: true,
      },
    });
  });
});
