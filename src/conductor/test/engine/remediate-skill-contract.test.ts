// Covers: task:9, task:14, task:22, task:24
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';

const remediateSkillPath = new URL('../../../../skills/remediate/SKILL.md', import.meta.url);
const remediateSkillDirectory = fileURLToPath(new URL('../../../../skills/remediate/', import.meta.url));
const candidateRoots: string[] = [];

afterEach(async () => {
  await Promise.all(candidateRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function section(skill: string, heading: string): string {
  return skill.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
}

describe('remediate build_review case-mode contract', () => {
  it('retains gap-plan judgment guidance while the engine owns planning mechanics', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const guidance = section(skill, 'Gap-plan judgment guidance');
    const refusalRework = section(skill, 'Engine-selected refusal-rework mode');

    expect(guidance).toMatch(/environmental stalls.*halt.*unanswerable/is);
    expect(guidance).toMatch(/sealed-artifact amendments return to DECIDE/i);
    expect(guidance).toMatch(/prefer autonomous remediation/i);
    expect(guidance).toMatch(/recorded RED exception/i);
    expect(guidance).toMatch(/low confidence halts/i);
    expect(refusalRework).toMatch(/removal-only/i);
    expect(skill).toMatch(/interactive.*human-readable remediation plan.*not a managed persisted result/is);
  });

  it('selects case-v1 only from engine context', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(/engine-stamped `build_review`.*`case-v1`/i);
    expect(caseMode).toMatch(/only when.*engine context/i);
    expect(caseMode).toMatch(/do not create.*skill.*dispatch/i);
  });

  it('names the complete bounded input and exact case-v1 output vocabulary', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    for (const field of [
      'domain',
      'currentFindings',
      'priorCases',
      'planContract',
      'taskStatus',
      'effectPointers',
      'rubric id',
      'stable finding id',
      'anchor',
      'summary',
      'evidence locations',
      'outcome',
      'source links',
      'effect status',
      'resolution evidence',
    ]) {
      expect(caseMode).toContain(field);
    }

    expect(caseMode).toMatch(/exactly these top-level keys.*`mode`, `domain`, `sourceOutcomes`, `cases`/is);
    expect(caseMode).toMatch(/`sourceId`, `outcome`, `caseRef`/);
    expect(caseMode).toMatch(/`acted` \| `deferred` \| `rejected` \| `merged` \| `refuted`/);
    expect(caseMode).toMatch(/`caseRef`, optional `existingCaseId`,[\s\S]*?`disposition`, `priority`,[\s\S]*?`rationale`, `confidence`, `effect`/);
    expect(caseMode).toMatch(/`act` \| `defer` \| `reject` \| `refute`/);
    expect(caseMode).toMatch(/`critical` \| `high` \| `medium` \| `low`/);
    expect(caseMode).toMatch(/`high` \| `medium` \| `low`/);
    expect(caseMode).toMatch(/"kind": "action", "route": "build", "tasks": \[\{ "title"/);
    expect(caseMode).toMatch(/"kind": "deferral"[\s\S]*?"title"[\s\S]*?"body"[\s\S]*?"exclusionRationale"/);
    expect(caseMode).toMatch(/"kind": "none"/);
    expect(caseMode).toMatch(/`refutation`.*"claim".*"assertions"/s);
    expect(caseMode).toMatch(/MUST bind an `existingCaseId`/);
    expect(caseMode).toMatch(/confidence\s+`high`/);
    expect(caseMode).toMatch(/`refuted` or\s+`upheld`/);
    expect(caseMode).toMatch(/`path` and `excerpt`/);
    expect(caseMode).toMatch(/no line numbers/i);
    expect(caseMode).toMatch(/refuted once only/i);
  });

  it('makes the judge source-complete and keeps identity, effects, and operator authority engine-owned', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(/every supplied current finding.*exactly one.*source outcome/i);
    expect(caseMode).toMatch(/all feature-local prior cases.*or stop/i);
    expect(caseMode).toMatch(/never omit.*source/i);
    expect(caseMode).toMatch(/do not match.*summar(?:y|ies).*identity/i);
    expect(caseMode).toMatch(/do not re-audit.*source tree/i);
    expect(caseMode).toMatch(/do not read.*sibling.*prompt/i);
    expect(caseMode).toMatch(/must not mint.*durable.*case.*effect.*id/i);
    expect(caseMode).toMatch(/engine.*stamps.*durable.*ids/i);
    expect(caseMode).toMatch(/never assert or create operator\s+acceptance/i);
    expect(caseMode).toMatch(/same-substance finding may be bound\s+by `existingCaseId` to a prior case marked `operatorAccepted`/i);
    expect(caseMode).toMatch(/do not.*apply.*effect/i);
    expect(caseMode).toMatch(/do not append[\s\S]*approved plan/i);
    expect(caseMode).toMatch(/write.*only.*`\.pipeline\/remediation\.json`/is);
  });

  it('states case-v2 index-only admission and its one-round expansion boundary', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(/`planContract\.index` lists every (?:active-)?plan task without (?:its )?body/i);
    expect(caseMode).toMatch(/`admittedTaskIds` must name supplied task bodies/i);
    expect(caseMode).toMatch(/index-only task.*at most one.*engine.*expansion round.*unsupplied admission.*halts/is);
  });

  it('allows distinctFrom to name provenance candidates through the shared skill only', async () => {
    const [skill, files] = await Promise.all([
      readFile(remediateSkillPath, 'utf8'),
      readdir(remediateSkillDirectory, { recursive: true }),
    ]);
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(
      /An entry may name either a provenance\s+candidate of the row or a resolved act owner of a row source;\s+an entry not naming a resolved action owner of a row source is ignored unless it names a provenance candidate\./,
    );
    expect(files.filter((file) => file.endsWith('SKILL.md'))).toEqual(['SKILL.md']);
  });

  it('states the bound reRaise recurrence rule', async () => {
    const caseMode = section(await readFile(remediateSkillPath, 'utf8'), 'Engine-selected build_review case-v1 mode');
    expect(caseMode).toMatch(/bound `act` row.*resolved `act` case.*applied action effect.*`reRaise`/is);
    expect(caseMode).toMatch(/`residual-gap` routes the repair to BUILD.*three applied attempts/is);
    expect(caseMode).toMatch(/`repeat` halts the lap/i);
    expect(caseMode).toMatch(/absent `reRaise` is treated as a residual gap/i);
  });

  it('treats bounded prior-source finding digests as binding context rather than report text', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');
    const normalizedCaseMode = caseMode.replace(/\s+/g, ' ');

    expect(caseMode).toMatch(/prior source.*`finding`.*bounded digest/is);
    expect(normalizedCaseMode).toContain(
      '`rubric`, `concernKind`, a bounded `summary`, bounded `evidenceLocations`, and `lapId`',
    );
    expect(caseMode).toMatch(/`finding` digest as binding context.*equivalent re-raise/is);
    expect(caseMode).toMatch(/never report text/i);
  });

  // Covers: S1.2, task:8
  it('states the binding disposition rule and its one-round correction path', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(/`priorCases\[\]\.bindableDispositions`/);
    expect(caseMode).toMatch(
      /non-escalation row.*binding an `existingCaseId`.*must use a disposition.*prior case.*`bindableDispositions`/is,
    );
    expect(caseMode).toMatch(/refused binding.*`bindingCorrections`.*one corrected judgement/is);
    expect(caseMode).toMatch(
      /re-raised finding.*no longer present.*attempted applied action.*evidence-backed `refute`.*not.*bound `reject`/is,
    );
  });

  it('renders the same shared remediate skill in Claude and Codex candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediate-skill-candidates-'));
    candidateRoots.push(root);
    const worktreeRoot = join(root, 'worktree');
    await cp(remediateSkillDirectory, join(worktreeRoot, 'skills', 'remediate'), { recursive: true, dereference: true });

    const [claude, codex] = await Promise.all(
      ['claude', 'codex'].map((provider) => provisionProviderHome({
        provider: { id: provider as 'claude' | 'codex' }, worktreeRoot, baseDir: root,
      })),
    );
    try {
      const skill = await readFile(remediateSkillPath, 'utf8');
      await expect(Promise.all([
        readFile(join(claude.homeDir, 'skills', 'remediate', 'SKILL.md'), 'utf8'),
        readFile(join(codex.homeDir, 'skills', 'remediate', 'SKILL.md'), 'utf8'),
      ])).resolves.toEqual([skill, skill]);
    } finally {
      await Promise.all([claude.teardown(), codex.teardown()]);
    }
  });
});
