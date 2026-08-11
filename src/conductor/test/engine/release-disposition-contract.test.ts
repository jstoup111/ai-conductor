import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/engine/config.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import type { StepName } from '../../src/types/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const skillName = 'release-disposition';
// The registry accepts YAML-defined names at runtime; its static API remains
// intentionally limited to built-in StepName values.
const MAINTAIN_DOCUMENTATION = 'maintain-documentation' as StepName;
const canonicalDir = join(repoRoot, '.agents/skills', skillName);

describe('repository-local release-disposition contract', () => {
  it('uses one canonical cross-provider skill and gates before finish', async () => {
    const canonicalSkill = await readFile(join(canonicalDir, 'SKILL.md'));
    const claudeLink = join(repoRoot, '.claude/skills', skillName);
    const claudeSkill = await readFile(join(claudeLink, 'SKILL.md'));
    const linkStat = await lstat(claudeLink);
    const config = await loadConfig(repoRoot);

    expect(config.ok).toBe(true);
    if (!config.ok) return;
    const names = buildStepRegistry(config.config).map((step) => step.name);
    expect({
      canonicalSkill: canonicalSkill.includes(Buffer.from('name: release-disposition')),
      claudeLink: linkStat.isSymbolicLink(),
      claudeTarget: await realpath(claudeLink),
      byteIdentical: canonicalSkill.equals(claudeSkill),
      config: config.config.steps?.[skillName],
      tail: names.slice(names.indexOf(MAINTAIN_DOCUMENTATION), names.indexOf('finish') + 1),
    }).toEqual({
      canonicalSkill: true,
      claudeLink: true,
      claudeTarget: canonicalDir,
      byteIdentical: true,
      config: {
        // Deliberate Codex judgement lane, rather than inherited run-level routing.
        llm_provider: 'codex',
        model: 'gpt-5.6-terra',
        after: 'maintain-documentation',
        skill: '.agents/skills/release-disposition/SKILL.md',
        enforcement: 'gating',
        completion_artifact: '.pipeline/release-disposition-pass',
      },
      tail: ['maintain-documentation', 'release-disposition', 'finish'],
    });
  });

  it('makes the PR body authoritative and records only PASS evidence', async () => {
    const skill = await readFile(join(canonicalDir, 'SKILL.md'), 'utf8');

    expect({
      diffJudges: /implementation diff[\s\S]*not the draft placeholder/i.test(skill),
      prAuthority: /PR body is authoritative/i.test(skill),
      writesMetadata: /directly into the retained draft PR body/i.test(skill),
      migration: /```bash migration/i.test(skill),
      passOnly: /Write .*release-disposition-pass.*only after/i.test(skill),
      blockedOmitsPass: /BLOCKED.*pass marker absent/is.test(skill),
    }).toEqual({
      diffJudges: true,
      prAuthority: true,
      writesMetadata: true,
      migration: true,
      passOnly: true,
      blockedOmitsPass: true,
    });
  });
});
