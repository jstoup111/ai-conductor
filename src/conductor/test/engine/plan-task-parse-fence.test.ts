import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scanPlanProtectedTargets } from '../../src/engine/plan-protected-targets.js';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';

describe('plan task Files convention fence', () => {
  it('does not retain the retired WIRED_INTO_LINE parser machinery', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../src/engine/plan-task-parse.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/\bWIRED_INTO_LINE\b/);
  });

  it('preserves Files declaration provenance while ignoring retired Wired-into metadata', () => {
    const plan = `# Fixed regression fence

### Task 1: Declare ordinary implementation paths
**Files:** src/conductor/src/engine/parser.ts; \`src/conductor/test/engine/parser.test.ts\`

### Task 2: Cite a foreign specification without a Files declaration
- \`src/conductor/src/engine/legacy.ts\`
- **Wired-into:** \`src/conductor/src/engine/retired-wiring.ts#run\`
Read \`.docs/specs/another-feature.md:42\` before changing it.

### Task 3: Declare a foreign sealed story
**Files:** .docs/stories/another-feature.md

### Task 4: Inherit the declared paths
**Files:** same as Task 1
Read \`.docs/specs/another-feature.md\` as context.

### Task 5: Declare no paths for this feature's specification
**Files:** none
Read \`.docs/specs/files-convention-fence.md\` as context.

### Task 6: Retired metadata remains case-insensitive
- **WIRED-INTO**: \`src/conductor/src/engine/uppercase-retired.ts#run\`

### Task 7: Retired metadata permits qualifiers and colon placement
- **Wired-into call site** : \`src/conductor/src/engine/qualified-retired.ts#run\`
`;

    const parsed = parsePlanTaskPaths(plan, 'files-convention-fence');

    expect(Array.from(parsed.entries())).toEqual([
      ['1', new Set([
        'src/conductor/src/engine/parser.ts',
        'src/conductor/test/engine/parser.test.ts',
      ])],
      // The retired declaration is not a Files fallback source.
      ['2', new Set(['src/conductor/src/engine/legacy.ts'])],
      ['3', new Set(['.docs/stories/another-feature.md'])],
      ['4', new Set([
        'src/conductor/src/engine/parser.ts',
        'src/conductor/test/engine/parser.test.ts',
      ])],
      ['5', new Set()],
      // Retired metadata variants must remain excluded from legacy fallback
      // paths without becoming a Files declaration.
      ['6', new Set()],
      ['7', new Set()],
    ]);
    expect(parsed.hasFilesLineByTaskId).toEqual(new Map([
      ['1', true],
      ['2', false],
      ['3', true],
      ['4', true],
      ['5', true],
      ['6', false],
      ['7', false],
    ]));
    expect(parsed.foreignProtectedReferencesByTaskId).toEqual(new Map([
      ['2', new Set(['.docs/specs/another-feature.md'])],
      // Files-declared tasks retain a foreign protected prose reference, but
      // do not create an empty metadata entry when they have none.
      ['4', new Set(['.docs/specs/another-feature.md'])],
      ['6', new Set()],
      ['7', new Set()],
    ]));
    expect(scanPlanProtectedTargets(plan, 'files-convention-fence')).toEqual([
      { taskId: '2', path: '.docs/specs/another-feature.md' },
      { taskId: '3', path: '.docs/stories/another-feature.md' },
      { taskId: '4', path: '.docs/specs/another-feature.md' },
    ]);
  });
});
