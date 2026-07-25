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
});
