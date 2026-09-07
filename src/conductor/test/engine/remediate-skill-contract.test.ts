import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const remediateSkillPath = new URL('../../../../skills/remediate/SKILL.md', import.meta.url);

function section(skill: string, heading: string): string {
  return skill.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
}

describe('remediate build_review case-mode contract', () => {
  it('selects case-v1 only from engine context and keeps the legacy gap-plan contract', async () => {
    const skill = await readFile(remediateSkillPath, 'utf8');
    const caseMode = section(skill, 'Engine-selected build_review case-v1 mode');

    expect(caseMode).toMatch(/engine-stamped `build_review`.*`case-v1`/i);
    expect(caseMode).toMatch(/only when.*engine context/i);
    expect(caseMode).toMatch(/do not create.*skill.*dispatch/i);
    expect(skill).toMatch(/### 2\. Dispatch `remediation-planner`/);
    expect(skill).toMatch(/Write the plan to \*\*`\.pipeline\/remediation\.json`\*\*/);
    expect(skill).toMatch(/"dispositions"/);
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
    expect(caseMode).toMatch(/`acted` \| `deferred` \| `rejected` \| `merged`/);
    expect(caseMode).toMatch(/`caseRef`, optional `existingCaseId`,[\s\S]*?`disposition`, `priority`,[\s\S]*?`rationale`, `confidence`, `effect`/);
    expect(caseMode).toMatch(/`act` \| `defer` \| `reject`/);
    expect(caseMode).toMatch(/`critical` \| `high` \| `medium` \| `low`/);
    expect(caseMode).toMatch(/`high` \| `medium` \| `low`/);
    expect(caseMode).toMatch(/"kind": "action", "route": "build", "tasks": \[\{ "title"/);
    expect(caseMode).toMatch(/"kind": "deferral"[\s\S]*?"title"[\s\S]*?"body"[\s\S]*?"exclusionRationale"/);
    expect(caseMode).toMatch(/"kind": "none"/);
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
    expect(caseMode).toMatch(/do not.*apply.*effect/i);
    expect(caseMode).toMatch(/do not append[\s\S]*approved plan/i);
    expect(caseMode).toMatch(/write.*only.*`\.pipeline\/remediation\.json`/is);
  });
});
