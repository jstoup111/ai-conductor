// RED (Task 1): parsePlanTaskPaths and TASK_ID_PATTERN must be relocatable
// to a standalone module (plan-task-parse.ts) that does not depend on
// autoheal.ts's evidence-derivation logic. wiring-probe.ts and wired-into.ts
// must be able to import these from the new module directly, so a later
// phase can gut autoheal.ts's evidence-derivation logic without breaking the
// wiring-reachability gate.
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  parsePlanTaskDoneWhen,
  parsePlanTaskPaths,
  parsePlanTaskPreserves,
  TASK_HEADER_PATTERN,
  TASK_ID_PATTERN,
} from '../../src/engine/plan-task-parse.js';
import { parsePlanTaskVerifyOnly } from '../../src/engine/autoheal.js';

const execFile = promisify(execFileCallback);

describe('plan-task-parse.ts (relocated shared utilities, #relocate-for-wiring)', () => {
  it('parses one preserved behavior from its task block', () => {
    const result = parsePlanTaskPreserves(`# Plan

### Task 9: Preserve wrapper behavior
**Preserves:** the ungated TokenMeter wrapper transparency
`);

    expect(result).toEqual(new Map([['9', ['the ungated TokenMeter wrapper transparency']]]));
  });

  it('accumulates separate preserved behaviors from one task block', () => {
    const result = parsePlanTaskPreserves(`# Plan

### Task 9: Preserve wrapper behavior
**Preserves:** the ungated TokenMeter wrapper transparency
**Preserves:** the provider-facing TokenMeter metric name
`);

    expect(result).toEqual(new Map([['9', [
      'the ungated TokenMeter wrapper transparency',
      'the provider-facing TokenMeter metric name',
    ]]]));
  });

  it('parses the two, three, and five Done when criteria from their task blocks', () => {
    const result = parsePlanTaskDoneWhen(`### Task 1: Two criteria
**Done when:**
- first criterion
- second criterion

### Task 2: Three criteria
**Done when:**
- first criterion
- second criterion
- third criterion

### Task 3: Five criteria
**Done when:**
- first criterion
- second criterion
- third criterion
- fourth criterion
- fifth criterion
`);

    expect(result).toEqual(new Map([
      ['1', ['first criterion', 'second criterion']],
      ['2', ['first criterion', 'second criterion', 'third criterion']],
      ['3', ['first criterion', 'second criterion', 'third criterion', 'fourth criterion', 'fifth criterion']],
    ]));
  });

  it('normalizes Markdown emphasis and trailing whitespace in Done when criteria', () => {
    expect(parsePlanTaskDoneWhen(`### Task 1: Normalization
**Done when:**
- **the observable result**${'   '}
- _the failure result_\t
`)).toEqual(new Map([['1', ['the observable result', 'the failure result']]]));
  });

  it('ignores a Done when block inside a fenced code example', () => {
    expect(parsePlanTaskDoneWhen(`### Task 1: Fenced example
\`\`\`markdown
**Done when:**
- example criterion
- another example criterion
\`\`\`
`)).toEqual(new Map());
  });

  it('omits a task that has no Done when block', () => {
    expect(parsePlanTaskDoneWhen(`### Task 1: Has criteria
**Done when:**
- observable result
- observable failure

### Task 2: No criteria
**Files:** src/example.ts
`)).toEqual(new Map([['1', ['observable result', 'observable failure']]]));
  });

  it('parses each non-empty Done when map across landed plans on main', async () => {
    const { stdout } = await execFile('git', ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/plans'], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
    });
    const planPaths = stdout.trim().split('\n').filter(Boolean);
    const maps = await Promise.all(planPaths.map(async (planPath) => {
      const { stdout: plan } = await execFile('git', ['show', `main:${planPath}`], {
        cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
      });
      return { planPath, doneWhen: parsePlanTaskDoneWhen(plan) };
    }));

    const nonEmpty = maps.filter(({ doneWhen }) => doneWhen.size > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    expect(nonEmpty.every(({ doneWhen }) => [...doneWhen.values()].every((criteria) => criteria.every(Boolean)))).toBe(true);
  });

  it('exports TASK_ID_PATTERN matching the H9 id grammar', () => {
    expect(TASK_ID_PATTERN).toBe('[A-Za-z0-9._-]+');
  });

  it('keeps every task parser on the shared supported header grammar', () => {
    const plan = `### Task rem-adr-001: Colon-delimited
**Preserves:** colon behavior
**Verify-only:** yes
**Files:** src/colon.ts

#### Task task_1 — Dash-delimited
**Preserves:** dash behavior
**Verify-only:** yes
**Files:** src/dash.ts

##### Task 1.2
**Preserves:** bare numeric behavior
**Verify-only:** yes
**Files:** src/bare.ts

###### T0 — Shorthand
**Preserves:** shorthand behavior
**Verify-only:** yes
**Files:** src/shorthand.ts
`;
    const ids = ['rem-adr-001', 'task_1', '1.2', 'T0'];

    expect(TASK_HEADER_PATTERN).toBeInstanceOf(RegExp);
    expect(Array.from(parsePlanTaskPaths(plan).keys())).toEqual(ids);
    expect(Array.from(parsePlanTaskPreserves(plan).keys())).toEqual(ids);
    expect(Array.from(parsePlanTaskVerifyOnly(plan).keys())).toEqual(ids);
  });

  it('exports a working parsePlanTaskPaths', () => {
    const plan = `# Plan

### Task 1: Do the thing
**Files:** \`src/foo.ts\`
`;
    const result = parsePlanTaskPaths(plan);
    expect(Array.from(result.keys())).toEqual(['1']);
    expect(Array.from(result.get('1') ?? [])).toEqual(['src/foo.ts']);
  });

  it('marks explicit Files declarations while preserving their resolved paths', () => {
    const result = parsePlanTaskPaths(`### Task 1: First
**Files:** src/one.ts; src/two.ts

### Task 2: Inherits
**Files:** same as Task 1

### Task 3: Legacy
- \`src/incidental.ts\`
`);

    expect(Array.from(result.get('1') ?? [])).toEqual(['src/one.ts', 'src/two.ts']);
    expect(Array.from(result.get('2') ?? [])).toEqual(['src/one.ts', 'src/two.ts']);
    expect(result.declaredTaskIds).toEqual(new Set(['1', '2']));
  });

  it('reports whether each task carried a Files line', () => {
    const result = parsePlanTaskPaths(`### Task 1: Declared
**Files:** src/one.ts

### Task 2: Undeclared
- \`src/two.ts\`
`);

    expect(result.hasFilesLineByTaskId).toEqual(
      new Map([
        ['1', true],
        ['2', false],
      ]),
    );
  });

  it('reports foreign protected artifact citations from an undeclared task body', () => {
    const result = parsePlanTaskPaths(`### Task 1: Explain the change
See \`.docs/specs/other-feature.md:42\` before editing.

### Task 2: Explain this feature
See \`.docs/specs/feature.md\` before editing.
`, 'feature');

    expect(result.foreignProtectedReferencesByTaskId).toEqual(
      new Map([['1', new Set(['.docs/specs/other-feature.md'])], ['2', new Set()]]),
    );
  });
});
