// ─────────────────────────────────────────────────────────────────────────────
// Test: derive diagnostics warn once per (task, commit) per run (#405).
//
// H7 re-derives completion on EVERY build-gate evaluation, so the
// path-corroboration near-miss notice used to repeat for every unevidenced
// task on every pass, flooding the daemon pane during healthy builds. The
// notice must fire on the FIRST derivation and stay silent on identical
// re-derivations; the audit entry and verdict are unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import {
  deriveCompletion,
  listCommitsWithTrailers,
  resetDeriveWarnOnce,
} from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

let root: string;

async function git(...args: string[]): Promise<void> {
  await execa('git', args, { cwd: root });
}

/** Plan task 1 scoped to src/expected.ts + a commit with the Task: 1 trailer
 *  touching an UNRELATED file → path corroboration fails (the near-miss). */
async function seedCorroborationMiss(): Promise<string> {
  const planPath = join(root, '.docs/plans/test-plan.md');
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(
    planPath,
    `# Test Plan

### Task 1: Implementation

- \`src/expected.ts\`
`,
  );
  await git('add', '.docs/plans/test-plan.md');
  await git('commit', '-q', '-m', 'docs: add plan');

  await writeFile(join(root, 'unrelated.txt'), 'x');
  await git('add', 'unrelated.txt');
  await git('commit', '-q', '-m', 'feat: work\n\nTask: 1\n');
  return planPath;
}

async function derive(planPath: string) {
  const commits = await listCommitsWithTrailers(root);
  const evidence = await createTaskEvidence(root);
  return deriveCompletion(root, planPath, '', commits, evidence);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'warn-once-'));
  resetDeriveWarnOnce();
  await git('init', '-q');
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('deriveCompletion warn-once (#405)', () => {
  it('path-corroboration miss warns on the first derivation only; audit entry persists on both', async () => {
    const planPath = await seedCorroborationMiss();

    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warns.push(args.join(' '));
    });

    const first = await derive(planPath);
    const second = await derive(planPath);

    // Warned exactly once across both derivations…
    expect(
      warns.filter((w) => w.includes('Path corroboration failed for task 1')),
    ).toHaveLength(1);
    // …while the derived verdict + audit entry stay identical on the re-pass.
    expect(first['1']?.completed).toBe(false);
    expect(second['1']?.completed).toBe(false);
    expect(second['1']?.auditEntry).toContain('no path overlap');
  });

  it('resetDeriveWarnOnce clears the memory (fresh run warns again)', async () => {
    const planPath = await seedCorroborationMiss();

    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warns.push(args.join(' '));
    });

    await derive(planPath);
    resetDeriveWarnOnce();
    await derive(planPath);

    expect(
      warns.filter((w) => w.includes('Path corroboration failed for task 1')),
    ).toHaveLength(2);
  });
});
