// Covers: task:1
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSkillName, skillNameRootFor } from '../../src/engine/skill-names.js';

describe('engine/skill-names', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skill-names-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSkill(directory: string, contents: string): string {
    const skillDirectory = join(root, 'skills', directory);
    const skillPath = join(skillDirectory, 'SKILL.md');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(skillPath, contents);
    return skillPath;
  }

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('reads a frontmatter name from a %s SKILL.md file', async (_format, newline) => {
    writeSkill('explore', [
      '---',
      'name: ac-explore',
      'description: Explore the design space.',
      '---',
      '',
      '# Explore',
    ].join(newline));

    await expect(resolveSkillName(root, 'explore')).resolves.toBe('ac-explore');
  });

  it('uses the directory name when frontmatter has no name key', async () => {
    writeSkill('explore', '---\ndescription: Explore the design space.\n---\n');

    await expect(resolveSkillName(root, 'explore')).resolves.toBe('explore');
  });

  it('uses the directory name when no skills root is available', async () => {
    await expect(resolveSkillName(null, 'explore')).resolves.toBe('explore');
  });

  it('names the missing SKILL.md path when the skill file is absent', async () => {
    const skillPath = join(root, 'skills', 'explore', 'SKILL.md');

    await expect(resolveSkillName(root, 'explore')).rejects.toThrow(skillPath);
  });

  it('names the SKILL.md path when frontmatter is never closed', async () => {
    const skillPath = writeSkill('explore', '---\nname: ac-explore\n');

    await expect(resolveSkillName(root, 'explore')).rejects.toThrow(skillPath);
  });

  it('selects the feature worktree skill root for self-host dispatches', () => {
    expect(skillNameRootFor({
      isSelfHost: true,
      worktreePath: '/tmp/feature-worktree',
      harnessRoot: '/tmp/harness-root',
    })).toBe('/tmp/feature-worktree');
  });

  it('selects the engine harness root for non-self-host dispatches', () => {
    expect(skillNameRootFor({
      isSelfHost: false,
      worktreePath: '/tmp/feature-worktree',
      harnessRoot: '/tmp/harness-root',
    })).toBe('/tmp/harness-root');
  });

  it('preserves a null engine harness root for non-self-host dispatches', () => {
    expect(skillNameRootFor({
      isSelfHost: false,
      worktreePath: '/tmp/feature-worktree',
      harnessRoot: null,
    })).toBeNull();
  });
});
