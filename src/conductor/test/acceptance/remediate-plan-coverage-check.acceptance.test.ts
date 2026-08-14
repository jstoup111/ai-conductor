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

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');

const CONTRACT_SURFACES = [
  ['remediate skill', 'skills/remediate/SKILL.md'],
  ['remediation planner', 'agents/remediation-planner.md'],
] as const;

describe.each(CONTRACT_SURFACES)('%s build_review trigger contract', (_label, relativePath) => {
  async function contract(): Promise<string> {
    return readFile(join(REPO_ROOT, relativePath), 'utf8');
  }

  it('dispatches build_review from its verdict artifact with a trigger-specific gap id', async () => {
    const text = await contract();

    const buildReviewTrigger = text.match(
      /(?:(?:`?build_review`? trigger|The `build_review` trigger)[\s\S]{0,300}\.pipeline\/build-review\.json|\.pipeline\/build-review\.json[\s\S]{0,300}`?build_review`? trigger)/i,
    );
    const buildReviewId = text.match(
      /(?:for a `?build_review`? trigger gap|use the distinct gap id format)[\s\S]{0,120}`build_review:<stem>`/i,
    );
    const finishFailureId = text.match(
      /(?:for a finish test failure|finish-test-failure form)[\s\S]{0,120}`test:<(?:failing file )?stem>`/i,
    );

    expect(buildReviewTrigger).not.toBeNull();
    expect(buildReviewId).not.toBeNull();
    expect(finishFailureId).not.toBeNull();
    expect(buildReviewId?.[0]).not.toContain('test:<');
    expect(finishFailureId?.[0]).not.toContain('build_review:<');
  });

  it('requires plan-task coverage before routing a gap to plan', async () => {
    const text = await contract();

    const coverageCheck = text.match(
      /before selecting `plan`, examine the approved plan(?:'s)?\s+existing tasks/i,
    );
    const existingTaskRemedy = text.match(
      /gap whose remedy is admitted by an existing task is `build`/i,
    );

    expect(coverageCheck).not.toBeNull();
    expect(existingTaskRemedy).not.toBeNull();
  });

  it('routes a baseline-passing test that needs strengthening to build', async () => {
    const text = await contract();

    const baselinePassingTest = text.match(
      /changed test that passes against\s+the baseline[\s\S]{0,120}needs strengthening within an existing task's RED\/GREEN steps[\s\S]{0,120}is `build`, not a\s+planning miss/i,
    );

    expect(baselinePassingTest).not.toBeNull();
  });

  it('requires plan rationale evidence and makes plan terminal', async () => {
    const text = await contract();

    const rationaleEvidence = text.match(
      /`plan` rationale must name the examined plan task IDs and why none admits the fix/i,
    );
    const terminalPlan = text.match(
      /in a daemon run, a `plan` disposition is a terminal needs-human HALT and never re-plans/i,
    );

    expect(rationaleEvidence).not.toBeNull();
    expect(terminalPlan).not.toBeNull();
  });
});
