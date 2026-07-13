// ─────────────────────────────────────────────────────────────────────────────
// Test: path corroboration ABSTAINS when a task declares no per-task file
// paths (#548).
//
// Two live incidents (overnight 2026-07-13) halted forward-progressing builds:
//   - #280 plan T11 (`### T11 — Tolerant reads`) names `task-status.json` only
//     inline in a prose sentence (the artifact it guards), while the real
//     single-file commit b4ce60a touched task-evidence.ts. The prose scan
//     harvested `task-status.json` as a phantom "declared path", so the commit
//     was rejected for "no path overlap".
//   - `2026-07-12-rtk-hook-preservation` T1/T3/T5 cite paths only inline in
//     prose (`bin/install:494–506`, `$HOME/.claude/settings.json`,
//     `test/…`) with no **Files:** line and no file-list bullet; three real
//     single-purpose commits were rejected at once, zeroing progress and
//     halting the build.
//
// Design lineage: abstain-or-loud (#519/#530) — when the corroborator has no
// authoritative declared-path basis, it must ABSTAIN (the engine-stamped
// Task: trailer stands on its own), not reject. The #424/#425 path-corroboration
// pair (Files:-line sourcing + segment-anchored suffix match) is preserved:
// where paths ARE declared (a **Files:** line or a dedicated file-list bullet)
// and are genuinely disjoint, corroboration STILL rejects.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import {
  deriveCompletion,
  listCommitsWithTrailers,
  resetDeriveWarnOnce,
} from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

describe('deriveCompletion path corroboration abstain on empty declared set (#548)', () => {
  let root: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: root });
  }

  async function commitFile(relPath: string, body: string, taskTrailer: string): Promise<void> {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    await git('add', '.');
    await git('commit', '-q', '-m', `feat: work\n\nTask: ${taskTrailer}\n`);
  }

  async function derive(planPath: string) {
    const commits = await listCommitsWithTrailers(root);
    const evidence = await createTaskEvidence(root);
    return deriveCompletion(root, planPath, '', commits, evidence);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'corr-abstain-'));
    resetDeriveWarnOnce();
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('T11 live shape: inline-prose artifact, disjoint single-file commit → ABSTAIN (completed)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task T11 — Tolerant reads (robustness)
Corrupt/missing \`task-status.json\` or sidecar → treated as zero delta / no change; no exception
escapes the loop or the daemon tick.
**Dependencies:** T4, T8.
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    // Real T11 work touches task-evidence.ts, NOT the inline-cited task-status.json.
    await commitFile('src/conductor/src/engine/task-evidence.ts', 'export const x = 1;', 'T11');

    const result = await derive(planPath);
    expect(result['T11']?.completed).toBe(true);
  });

  it('rtk T3 live shape: inline `bin/install:494–506`, commit touches bin/install → ABSTAIN (completed)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### T3 — Move RTK re-init onto the always-run path
Extract the \`rtk init -g --auto-patch\` invocation (currently \`bin/install:494–506\`) into the
always-run section of \`install()\`.
**Dependencies:** T2.
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('bin/install', '#!/usr/bin/env bash\necho hi\n', '3');

    const result = await derive(planPath);
    expect(result['3']?.completed).toBe(true);
  });

  it('regression: a dedicated file-list bullet + disjoint commit STILL rejects (#425 lock)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
- \`push-evidence.ts\`
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('unrelated.txt', 'x', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBe(false);
    expect(result['1']?.auditEntry).toContain('no path overlap');
  });

  it('regression: a dedicated file-list bullet + overlapping commit accepts (#425 lock)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
- \`push-evidence.ts\`
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('src/conductor/src/engine/push-evidence.ts', 'export const x = 1;', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBe(true);
  });

  it('regression: a **Files:** line + disjoint commit STILL rejects (#424 lock)', async () => {
    const planPath = join(root, '.docs/plans/p.md');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `# Plan

### Task 1: Implementation
**Files:** src/conductor/src/engine/push-evidence.ts
`,
    );
    await git('add', '.');
    await git('commit', '-q', '-m', 'docs: plan');

    await commitFile('src/conductor/src/engine/unrelated.ts', 'export const y = 2;', '1');

    const result = await derive(planPath);
    expect(result['1']?.completed).toBe(false);
    expect(result['1']?.auditEntry).toContain('no path overlap');
  });
});
