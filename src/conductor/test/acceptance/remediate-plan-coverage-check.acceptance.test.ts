/**
 * RED acceptance contract for build_review remediation planning.
 *
 * Task 1 proves both machine-consumed planner surfaces recognize a
 * build_review failure as its own dispatch trigger, consume the verdict it
 * produced, and preserve a trigger-specific gap identifier.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTRACT_SURFACES = [
  ['remediate skill', 'skills/remediate/SKILL.md'],
  ['remediation planner', 'agents/remediation-planner.md'],
] as const;
const DECIDE_ENTRY_POLICY = 'src/conductor/src/engine/decide-entry-policy.ts';

describe.each(CONTRACT_SURFACES)('%s build_review trigger contract', (_label, relativePath) => {
  async function contract(): Promise<string> {
    return readFile(join(REPO_ROOT, relativePath), 'utf8');
  }

  it('requires plan-task coverage before routing a gap to plan', async () => {
    const text = await contract();

    const coverageCheck = text.match(
      /before selecting `plan`, examine[\s\S]{0,80}(?:approved plan(?:'s)?\s+existing tasks|approved tasks)/i,
    );
    const existingTaskRemedy = text.match(
      /(?:gap whose remedy is admitted by an existing task is `build`|use `plan` only when none admits the repair)/i,
    );

    expect(coverageCheck).not.toBeNull();
    expect(existingTaskRemedy).not.toBeNull();
  });

  it('routes a baseline-passing test that needs strengthening to build', async () => {
    const text = await contract();

    const baselinePassingTest = text.match(
      /baseline-passing test[\s\S]{0,120}needs\s+strengthening within an existing task's RED\/GREEN (?:steps|work)[\s\S]{0,120}(?:is `build`, not a\s+planning miss|is BUILD work)/i,
    );

    expect(baselinePassingTest).not.toBeNull();
  });

  it('makes plan terminal and retains autonomous DECIDE refusal', async () => {
    const text = await contract();
    const policy = await readFile(join(REPO_ROOT, DECIDE_ENTRY_POLICY), 'utf8');

    const terminalPlan = text.match(
      /(?:in a daemon run, a `plan` disposition is a terminal needs-human HALT|a `plan` route is terminal in a\s+daemon run)[\s\S]{0,80}never re-plans/i,
    );

    expect(terminalPlan).not.toBeNull();
    expect(policy).toMatch(/const UNGRANTABLE_STEP:\s*StepName\s*=\s*'plan';/);
  });

  it('routes an in-scope planning omission to plan without re-plan wording', async () => {
    const text = await contract();

    expect(text).toMatch(/(?:`plan` route[\s\S]{0,120}in-scope planning omission|in-scope plan omission[\s\S]{0,220}use `plan` only)/i);
    expect(text).not.toMatch(/\(?re-plan\)?, then build/i);
    expect(text).not.toMatch(/so re-plan it/i);
  });
});

describe('remediation planner retained judgment guidance', () => {
  it('keeps the sibling-trigger routes judgment-based', async () => {
    const text = await readFile(join(REPO_ROOT, 'agents/remediation-planner.md'), 'utf8');

    expect(text).toMatch(
      /a clear `prd-audit` impl-gap, an as-built architecture finding that preserves approved architecture, and a finish test failure each route `build`[\s\S]{0,160}a `build_stall` question answerable from committed artifacts routes `build`[\s\S]{0,160}(?:architecture|product|unanswerable) judgment routes `halt`/i,
    );
  });
});
