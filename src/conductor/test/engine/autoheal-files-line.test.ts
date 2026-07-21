// ─────────────────────────────────────────────────────────────────────────────
// Test: parsePlanTaskPaths sources a task's expected paths from its **Files:**
// line (#424).
//
// The 2026-07-08 incident: plans write `**Files:** same` / plain-text Files
// lines (no backticks), so the old whole-section backtick scan never saw the
// real declared paths — instead it harvested stray backtick tokens from Steps
// prose (`./push-evidence.js` module-import strings, `conduct-state.json`
// runtime artifacts) and made them the task's ONLY expected paths. Correct
// commits with matching trailers then failed path corroboration forever.
//
// Contract under test:
// - A task with a **Files:** line uses ONLY that line's paths (plain-text or
//   backticked; `;` / `,` separated) — Steps-prose backtick tokens are ignored.
// - `same` inherits the previous task's resolved set; `same as Task N`
//   inherits task N's resolved set. Chains resolve (1 ← 2 ← 3).
// - `none` declares no paths (trailer alone corroborates).
// - A task WITHOUT a **Files:** line keeps the legacy backtick scan, but ONLY
//   over dedicated file-list bullet items (`- \`path\``) — NOT over backtick
//   tokens embedded in prose sentences. An inline backtick in a prose sentence
//   is almost always an incidental reference (a runtime artifact the task
//   reads/guards, a `file:NNN-MMM` line citation, a module-import string), not
//   a declaration of the file the task edits. Harvesting those as required
//   corroboration paths caused #548's false rejections (T11's inline
//   `task-status.json`, rtk T3's inline `bin/install:494–506`).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { parsePlanTaskPaths } from '../../src/engine/autoheal.js';

const paths = (m: Map<string, Set<string>>, id: string): string[] =>
  Array.from(m.get(id) ?? []).sort();

describe('parsePlanTaskPaths **Files:** line sourcing (#424)', () => {
  it('parses plain-text semicolon-separated paths from a Files line', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: detection
**Steps:**
1. Do work.
**Files:** src/conductor/src/engine/finish-record-cli.ts; src/conductor/test/engine/finish-record-cli.test.ts
`);
    expect(paths(m, '1')).toEqual([
      'src/conductor/src/engine/finish-record-cli.ts',
      'src/conductor/test/engine/finish-record-cli.test.ts',
    ]);
  });

  it('parses comma-separated and backticked paths from a Files line', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: work
**Files:** \`src/a.ts\`, src/b.ts
`);
    expect(paths(m, '1')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('a Files line excludes stray backtick tokens in Steps prose (incident shape)', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 5: push evidence reuse
**Steps:**
1. Test greps the module imports \`./push-evidence.js\` (no local reimplementation).
**Files:** src/conductor/src/engine/finish-record-cli.ts
`);
    expect(paths(m, '5')).toEqual(['src/conductor/src/engine/finish-record-cli.ts']);
  });

  it('resolves "same as Task N" to that task\'s resolved set', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: base
**Files:** src/a.ts; test/a.test.ts

### Task 2: negative paths
**Steps:**
1. Mentions \`stray.ts\` in prose.
**Files:** same as Task 1
`);
    expect(paths(m, '2')).toEqual(['src/a.ts', 'test/a.test.ts']);
  });

  it('resolves bare "same" through a chain back to the last explicit set', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: base
**Files:** src/a.ts

### Task 2: next
**Files:** same

### Task 3: next again
**Steps:**
1. Prose mentions \`conduct-state.json\` which must NOT become an expected path.
**Files:** same
`);
    expect(paths(m, '2')).toEqual(['src/a.ts']);
    expect(paths(m, '3')).toEqual(['src/a.ts']);
  });

  it('"none" declares an empty set (trailer alone corroborates)', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: docs only
**Steps:**
1. Prose mentions \`stray.ts\`.
**Files:** none
`);
    expect(paths(m, '1')).toEqual([]);
  });

  it('template form: bullets under **Files likely touched:** are the declared set', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: template-conforming task
**Steps:**
1. Write failing test: prose mentions \`stray-module.js\` which must not corroborate.

**Files likely touched:**
- \`src/real.ts\` — implementation
- test/real.test.ts — coverage

**Dependencies:** none
`);
    expect(paths(m, '1')).toEqual(['src/real.ts', 'test/real.test.ts']);
  });

  it('a blank line or next field ends the Files bullet block', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: block ends
**Files:**
- src/real.ts

**Steps:**
1. Prose bullet after the block: \`stray.ts\` stays excluded.
- \`also-stray.ts\` in a non-Files bullet
`);
    expect(paths(m, '1')).toEqual(['src/real.ts']);
  });

  it('a task without a Files line keeps the legacy whole-section backtick scan', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task rem-adr-001: Remediation
**Gate:** prd-audit
- \`src/fix.ts\`
`);
    expect(paths(m, 'rem-adr-001')).toEqual(['src/fix.ts']);
  });

  it('a Files line applies to every id of a multi-id header', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1-2: pair
**Files:** src/pair.ts
`);
    expect(paths(m, '1')).toEqual(['src/pair.ts']);
    expect(paths(m, '2')).toEqual(['src/pair.ts']);
  });

  it('reproduces the 2026-07-08 incident plan: tasks 5/6/9 derive their real files', () => {
    const m = parsePlanTaskPaths(`# Plan

### Task 1: detection — happy shapes
**Steps:**
1. Write failing tests in \`src/conductor/test/engine/finish-record-cli.test.ts\`.
2. RED. 3. Create \`finish-record-cli.ts\` with \`detectFinishRecordCommand\`. 4. GREEN.
**Files:** src/conductor/src/engine/finish-record-cli.ts; src/conductor/test/engine/finish-record-cli.test.ts
**Dependencies:** none

### Task 4: choice=pr verification — PR URL check
**Files:** same
**Dependencies:** Task 3

### Task 5: choice=pr verification — push evidence reuse
**Steps:**
1. Failing tests: \`headPushedToUpstream\` → false ⇒ refuse; test also greps the module imports \`./push-evidence.js\` (no local merge-base reimplementation).
**Files:** same
**Dependencies:** Task 4

### Task 6: writes — order and preservation
**Steps:**
1. Failing tests: pre-existing \`conduct-state.json\` → after run has both fields.
**Files:** same
**Dependencies:** Task 5

### Task 9: index.ts wiring
**Steps:**
1. A source assertion that index.ts imports and dispatches it.
2. Add import + detect/dispatch block in \`src/index.ts\`.
**Files:** src/conductor/src/index.ts
**Dependencies:** Task 2
`);
    const base = [
      'src/conductor/src/engine/finish-record-cli.ts',
      'src/conductor/test/engine/finish-record-cli.test.ts',
    ];
    expect(paths(m, '5')).toEqual(base);
    expect(paths(m, '6')).toEqual(base);
    expect(paths(m, '9')).toEqual(['src/conductor/src/index.ts']);
  });
});

describe('parsePlanTaskPaths inline-prose backtick paths are not harvested (#548)', () => {
  it('an inline prose backtick artifact does NOT become a declared path (T11 shape)', () => {
    // #280 plan T11: names `task-status.json` in a prose sentence describing
    // the robustness behavior — it is the artifact the task guards, not the
    // file the task edits (task-evidence.ts). It must NOT be a declared path.
    const m = parsePlanTaskPaths(`# Plan

### Task T11 — Tolerant reads (robustness)
Corrupt/missing \`task-status.json\` or sidecar → treated as zero delta / no change; no exception
escapes the loop or the daemon tick.
**Dependencies:** T4, T8.
`);
    expect(paths(m, 'T11')).toEqual([]);
  });

  it('an inline line-annotated path citation does NOT become a declared path (rtk T3 shape)', () => {
    // rtk plan T3: cites `bin/install:494–506` inline in prose. The task edits
    // bin/install, but the `:line-range` citation is not a clean declaration.
    const m = parsePlanTaskPaths(`# Plan

### T3 — Move RTK re-init onto the always-run path
Extract the \`rtk init -g --auto-patch\` invocation (currently \`bin/install:494–506\`) into the
always-run section of \`install()\`.
**Dependencies:** T2.
`);
    expect(paths(m, '3')).toEqual([]);
  });

  it('a dedicated file-list bullet IS still harvested (no **Files:** line)', () => {
    // The genuine "declare files as a bullet list" convention still corroborates
    // — this is the #425 / remediation-append form that must keep rejecting
    // disjoint commits.
    const m = parsePlanTaskPaths(`# Plan

### Task 1: Implementation
- \`push-evidence.ts\`
`);
    expect(paths(m, '1')).toEqual(['push-evidence.ts']);
  });
});
