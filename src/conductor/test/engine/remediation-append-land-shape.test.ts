// Covers: task:4
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendRemediationTasks } from '../../src/engine/conductor.js';
import { validatePlanDoneWhen } from '../../src/engine/plan-done-when.js';

describe('remediation append land shape', () => {
  it('keeps both engine-appended branches valid while retaining hand-authored violations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remediation-append-land-shape-'));
    const planPath = join(directory, 'plan.md');

    try {
      await writeFile(planPath, [
        '# Implementation Plan',
        '',
        '### Task hand-valid: Valid hand-authored task',
        '**Done when:**',
        '- The hand-authored behavior exists.',
        '- The hand-authored behavior remains covered.',
        '',
        '### Task hand-missing: Missing completion block',
        '',
        '### Task hand-too-few: One completion check',
        '**Done when:**',
        '- The one check exists.',
        '',
        '### Task hand-blank: Blank completion check',
        '**Done when:**',
        '-   ',
        '- A nonblank companion check.',
        '',
        '### Task hand-too-many: Six completion checks',
        '**Done when:**',
        '- One.',
        '- Two.',
        '- Three.',
        '- Four.',
        '- Five.',
        '- Six.',
        '',
      ].join('\n'), 'utf-8');

      const criterionBound = await appendRemediationTasks(
        directory,
        planPath,
        [{ id: 'rem-criterion', title: 'Repair the criterion-bound finding' }],
        {
          gateSource: 'prd-audit',
          criterionBoundGaps: [{
            id: 'criterion-gap',
            disposition: 'build',
            category: null,
            rationale: 'The criterion-bound behavior is missing.',
            criterion: 'Story 1 criterion',
            parentTask: 1,
            tasks: [{ id: 'criterion', title: 'Repair the criterion-bound finding' }],
          }],
        },
      );
      expect(criterionBound).toEqual({
        success: true,
        appendedIds: ['rem-prd-audit-criterion'],
      });

      const bare = await appendRemediationTasks(
        directory,
        planPath,
        [{ id: 'rem-bare', title: 'Repair the bare finding' }],
      );
      expect(bare).toEqual({ success: true, appendedIds: ['rem-bare'] });

      const plan = await readFile(planPath, 'utf-8');
      const violations = validatePlanDoneWhen(plan);

      expect(violations).toEqual([
        { taskId: 'hand-missing', reason: 'missing' },
        { taskId: 'hand-too-few', reason: 'too-few' },
        { taskId: 'hand-blank', reason: 'blank' },
        { taskId: 'hand-too-many', reason: 'too-many' },
      ]);
      expect(violations.map(({ taskId }) => taskId)).not.toContain('rem-prd-audit-criterion');
      expect(violations.map(({ taskId }) => taskId)).not.toContain('rem-bare');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
