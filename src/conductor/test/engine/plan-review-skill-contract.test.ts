// Covers: task:18
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const skillPath = new URL('../../../../skills/plan-review/SKILL.md', import.meta.url);

describe('plan-review skill contract', () => {
  it('defines the source-grounded reviewer brief and its contradiction ownership', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toMatch(/^---\n[\s\S]*^name: plan-review$/m);
    expect(skill).toMatch(/^description: .+/m);
    expect(skill).toMatch(/^enforcement: gating$/m);
    expect(skill).toMatch(/^phase: decide$/m);
    expect(skill).toMatch(/^disable-model-invocation: true$/m);

    expect(skill).toMatch(/test-impact[\s\S]*?reachability[\s\S]*?dependency-order[\s\S]*?feasibility/i);
    expect(skill).toMatch(/static contradiction[\s\S]*?oscillation[\s\S]*?task-versus-task[\s\S]*?preserved.behavior[\s\S]*?criterion-conflict/i);
    expect(skill).toMatch(/ADR-versus-story[\s\S]*?cross-layer/i);
    expect(skill).toMatch(/if I fully satisfy A, does B still hold[\s\S]*?other direction/i);
    expect(skill).toMatch(/nothing shared[\s\S]*?no finding/i);
    expect(skill).toMatch(/merely uncovered criterion[\s\S]*?not a contradiction/i);
    expect(skill).toMatch(/ungrounded suspicion[\s\S]*?advisory at most/i);
    expect(skill).toMatch(/verification[\s\S]*?task-versus-task sweep/i);
    expect(skill).toMatch(/feasibility finding[\s\S]*?source `file:line`[\s\S]*?planned input[\s\S]*?production passes/i);
    expect(skill).toMatch(/Story↔story[\s\S]*?\/conflict-check[\s\S]*?cross-layer[\s\S]*?task versus task[\s\S]*?plan review[\s\S]*?Medium and Large[\s\S]*?§7b[\s\S]*?Small/i);
    expect(skill).toMatch(/read-only[\s\S]*?MUST NOT.*(?:write|edit|stage|commit)/i);
  });
});
