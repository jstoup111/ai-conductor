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
        // Routed to codex: the step's output is a fixed-grammar Release-*
        // block validated by a required CI check that fails closed.
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

  it('requires one closed surface verdict before authoring release artifacts', async () => {
    const skill = await readFile(join(canonicalDir, 'SKILL.md'), 'utf8');

    expect({
      reviewRecord: /\.pipeline\/release-disposition-review\.md[\s\S]*exactly one[\s\S]*Surface-Verdict:/i.test(skill),
      closedSet: skill.includes('`none|migration|waiver|unclassifiable`'),
      noneAuthorsNothing: /Surface-Verdict: none[\s\S]*no waiver and no migration block/i.test(skill),
    }).toEqual({
      reviewRecord: true,
      closedSet: true,
      noneAuthorsNothing: true,
    });
  });

  it('requires a waiver verdict to leave one fresh, committed waiver before PASS', async () => {
    const skill = await readFile(join(canonicalDir, 'SKILL.md'), 'utf8');

    expect({
      planStemWaiver: /waiver[\s\S]*plan stem[\s\S]*\.docs\/release-waivers\//i.test(skill),
      canonicalSurfaces: /Waives:[\s\S]*listing every[\s\S]*classified canonical surface/i.test(skill),
      rationale: /non-empty[\s\S]*Rationale:/i.test(skill),
      commitBeforePass: /commit[\s\S]*before[\s\S]*release-disposition-pass/i.test(skill),
      failedCommitBlocked: /commit[\s\S]*fails[\s\S]*BLOCKED[\s\S]*pass marker absent/i.test(skill),
      reuseComplete: /already[\s\S]*feature diff[\s\S]*every classified surface[\s\S]*no[\s\S]*second[\s\S]*nothing to commit[\s\S]*success/i.test(skill),
      amendIncomplete: /omits a classified[\s\S]*surface[\s\S]*amend[\s\S]*same waiver[\s\S]*exactly one waiver/i.test(skill),
      baseIsNotFresh: /base branch[\s\S]*commit[\s\S]*feature diff/i.test(skill),
    }).toEqual({
      planStemWaiver: true,
      canonicalSurfaces: true,
      rationale: true,
      commitBeforePass: true,
      failedCommitBlocked: true,
      reuseComplete: true,
      amendIncomplete: true,
      baseIsNotFresh: true,
    });
  });

  it('keeps consumer migrations on the migration path and off the waiver path', async () => {
    const skill = await readFile(join(canonicalDir, 'SKILL.md'), 'utf8');

    expect({
      migrationWritesRunnableDraft: /migration[\s\S]*note.*runnable migration[\s\S]*retained draft PR body/i.test(skill),
      migrationWritesNoteMetadata: /migration[\s\S]*Release-Disposition: note[\s\S]*retained draft PR body/i.test(skill),
      migrationNoWaiver: /migration[\s\S]*add or modify no file under `.docs\/release-waivers\/`/i.test(skill),
      neverWaiver: /bin\/conduct.*subcommand, flag, or behavior[\s\S]*hook contract[\s\S]*settings\.json.*schema[\s\S]*never `waiver`/i.test(skill),
      uncertainFallsBack: /record `migration`, or `unclassifiable` when[\s\S]*cannot be determined/i.test(skill),
    }).toEqual({
      migrationWritesRunnableDraft: true,
      migrationWritesNoteMetadata: true,
      migrationNoWaiver: true,
      neverWaiver: true,
      uncertainFallsBack: true,
    });
  });

  it('leaves unclassifiable and invalid verdicts without authored release artifacts', async () => {
    const skill = await readFile(join(canonicalDir, 'SKILL.md'), 'utf8');

    expect({
      unclassifiableAuthorsNothing: /unclassifiable.*neither a waiver nor a migration block/i.test(skill),
      gateRetainsHalt: /unclassifiable[\s\S]*release gate to halt[\s\S]*exactly as it does today/i.test(skill),
      invalidVerdictBlocked: /outside `none`, `migration`, `waiver`,[\s\S]*`unclassifiable`[\s\S]*BLOCKED[\s\S]*pass marker absent/i.test(skill),
      uncertainSelectsUnclassifiable: /classified\s+breaking\s+surface\s+and\s+no\s+waiver\s+committed\s+in\s+the\s+feature\s+diff[\s\S]{0,120}cannot\s+confidently\s+judge[\s\S]{0,80}internal-only\s+or\s+consumer-facing[\s\S]{0,20}record\s+`Surface-Verdict: unclassifiable`/i.test(skill),
    }).toEqual({
      unclassifiableAuthorsNothing: true,
      uncertainSelectsUnclassifiable: true,
      gateRetainsHalt: true,
      invalidVerdictBlocked: true,
    });
  });
});
