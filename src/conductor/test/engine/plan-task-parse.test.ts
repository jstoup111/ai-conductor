// RED (Task 1): parsePlanTaskPaths and TASK_ID_PATTERN must be relocatable
// to a standalone module (plan-task-parse.ts) that does not depend on
// autoheal.ts's evidence-derivation logic. wiring-probe.ts and wired-into.ts
// must be able to import these from the new module directly, so a later
// phase can gut autoheal.ts's evidence-derivation logic without breaking the
// wiring-reachability gate.
import { describe, expect, it } from 'vitest';
import {
  parsePlanTaskBodies,
  parsePlanTaskPaths,
  parsePlanTaskDoneWhen,
  TASK_HEADER_PATTERN,
  TASK_ID_PATTERN,
} from '../../src/engine/plan-task-parse.js';
import { parsePlanTaskVerifyOnly } from '../../src/engine/autoheal.js';

describe('plan-task-parse.ts (relocated shared utilities, #relocate-for-wiring)', () => {
  describe('parsePlanTaskBodies', () => {
    it('returns each task body through the next task header and preserves the final body', () => {
      const result = parsePlanTaskBodies(`# Plan

### Task 1: First task
First task body.

### Task 2: Second task
Second task body.

### Task 3: Final task
Final task body.`);

      expect(result).toEqual(new Map([
        ['1', 'First task body.\n'],
        ['2', 'Second task body.\n'],
        ['3', 'Final task body.'],
      ]));
    });

    it('parses dotted ids and retains CRLF-fenced code verbatim', () => {
      const body = [
        'Use this snippet:',
        '```ts',
        "const prose = '### Task 99: not a heading';",
        '```',
        'Complete the task.',
      ].join('\r\n');
      const result = parsePlanTaskBodies([
        '### Task 1: First',
        'First body.',
        '',
        '### Task 1.2: Dotted',
        body,
      ].join('\r\n'));

      expect(result.get('1.2')).toBe(body);
    });

    it('returns undefined for an unknown task id', () => {
      const result = parsePlanTaskBodies('### Task 1: Only task\nBody.');

      expect(result.get('missing')).toBeUndefined();
    });

    it('does not treat similar prose as a task heading', () => {
      const result = parsePlanTaskBodies(`### Task 1: Real task
This prose quotes ### Task 2: but is not a heading.
`);

      expect(result).toEqual(new Map([
        ['1', 'This prose quotes ### Task 2: but is not a heading.\n'],
      ]));
      expect(result.get('2')).toBeUndefined();
    });
  });

  describe('parsePlanTaskDoneWhen', () => {
    it('returns ordered Done when checks only for tasks that declare the block', () => {
      const result = parsePlanTaskDoneWhen(`# Plan

### Task 1: Has verifiable completion criteria
**Done when:**
- First check
- Second check
- Third check

**Files:** src/one.ts

### Task 2: Keeps the legacy close rule
**Files:** src/two.ts
`);

      expect(result).toEqual(new Map([['1', [
        'First check',
        'Second check',
        'Third check',
      ]]]));
      expect(result.malformedTaskIds).toEqual(new Set());
    });

    it('marks an empty Done when block malformed instead of treating it as absent', () => {
      const result = parsePlanTaskDoneWhen(`### Task 1: Incomplete metadata
**Done when:**

**Files:** src/one.ts
`);

      expect(result.has('1')).toBe(false);
      expect(result.malformedTaskIds).toEqual(new Set(['1']));
    });
  });

  it('exports TASK_ID_PATTERN matching the H9 id grammar', () => {
    expect(TASK_ID_PATTERN).toBe('[A-Za-z0-9._-]+');
  });

  it('keeps every task parser on the shared supported header grammar', () => {
    const plan = `### Task rem-adr-001: Colon-delimited
**Verify-only:** yes
**Files:** src/colon.ts

#### Task task_1 — Dash-delimited
**Verify-only:** yes
**Files:** src/dash.ts

##### Task 1.2
**Verify-only:** yes
**Files:** src/bare.ts

###### T0 — Shorthand
**Verify-only:** yes
**Files:** src/shorthand.ts
`;
    const ids = ['rem-adr-001', 'task_1', '1.2', 'T0'];

    expect(TASK_HEADER_PATTERN).toBeInstanceOf(RegExp);
    expect(Array.from(parsePlanTaskPaths(plan).keys())).toEqual(ids);
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
