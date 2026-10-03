// Covers: task:15
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(join(__dirname, '..', '..', '..', '..', 'skills', 'tdd', 'SKILL.md'), 'utf8');

/** The numbered Phase 5 item, from its bold label up to the next numbered item. */
function preDiffSensitivityItem(): string {
  const start = SKILL.indexOf('**Pre-diff sensitivity check**');
  expect(start).toBeGreaterThan(-1);
  const rest = SKILL.slice(start);
  const end = rest.search(/\n\d+\. /);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('tdd skill pre-diff sensitivity check', () => {
  it('runs the counterfactual in a temporary detached worktree at the base commit, then removes it', () => {
    const item = preDiffSensitivityItem();
    expect(item).toContain('temporary detached worktree at the base commit');
    expect(item).toContain('git worktree add --detach «tmp» «base»');
    expect(item).toMatch(/copy only the new or changed test files into it/);
    expect(item).toContain('run them there');
    expect(item).toContain('git worktree remove --force «tmp»');
  });

  it('directs the agent not to set work aside or discard paths in any worktree, and names no discard command', () => {
    const item = preDiffSensitivityItem();
    expect(item).toMatch(/the temporary one included/);
    expect(item).toMatch(/Change no worktree's files beyond adding those copies/);
    expect(item).toMatch(/never set\s+uncommitted work aside/);
    expect(item).toMatch(/never discard, roll back or overwrite paths/);
    for (const forbidden of ['stash', 'checkout --', 'git restore', 'reset']) expect(item).not.toContain(forbidden);
  });
});
