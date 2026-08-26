// Test: track parsing + track-aware landSpec (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location, FR-2/13).
//
//   - parseTrack: valid / absent / garbled
//   - landSpec: product track REQUIRES a PRD/spec; technical track lands WITHOUT
//     a spec (acceptance criteria live in stories).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { parseTrack } from '../../../src/engine/artifacts.js';

const execFile = promisify(execFileCb);

const IDEA = 'idea t';
const STEM = 'idea-t';
const ACCEPTED_STORIES = ['# Stories: t', '', '**Status:** Accepted', '', '## S', '### Acceptance Criteria', '- G/W/T.', ''].join('\n');
const PLAN = ['# Plan: t', '', '**Stories:** .docs/stories/t.md', '', '## Task Dependency Graph', '```', '1', '```', ''].join('\n');

let repo: string;
async function git(args: string[], cwd = repo): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}
async function show(branch: string, rel: string): Promise<string | null> {
  try { return await git(['show', `${branch}:${rel}`]); } catch { return null; }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'track-marker-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 't@t.com']);
  await git(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'README.md'), '# r\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

// Create the per-idea worktree and seed .docs into IT (the engineer authors in the
// worktree, not the primary checkout); returns the worktree path for landSpec.
async function seedWorktree(opts: { spec?: boolean; track?: string }): Promise<string> {
  const wt = await createEngineerWorktree(repo, IDEA);
  await rm(join(wt.worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await writeFile(join(dir, '.docs/stories', `${STEM}.md`), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs/plans', `${STEM}.md`), PLAN.replace('stories/t.md', `stories/${STEM}.md`));
  if (opts.spec) {
    await mkdir(join(dir, '.docs/specs'), { recursive: true });
    await writeFile(join(dir, '.docs/specs', `${STEM}.md`), '# PRD: t\n\nApproved.\n');
  }
  if (opts.track) {
    await mkdir(join(dir, '.docs/track'), { recursive: true });
    await writeFile(join(dir, '.docs/track', `${STEM}.md`), `# Track\n\nTrack: ${opts.track}\n`);
  }
  return dir;
}

describe('parseTrack', () => {
  it('parses product/technical', () => {
    expect(parseTrack('Track: product')).toBe('product');
    expect(parseTrack('# x\n\nTrack: technical\n')).toBe('technical');
  });
  it('undefined for absent/garbled', () => {
    expect(parseTrack(null)).toBeUndefined();
    expect(parseTrack('no track')).toBeUndefined();
    expect(parseTrack('Track: sideways')).toBeUndefined();
  });
});

describe('landSpec — track-aware required artifacts', () => {
  it('product track (default, no marker) REQUIRES a spec', async () => {
    const worktree = await seedWorktree({ spec: false }); // no spec, no track marker → defaults product
    await expect(landSpec({ name: 'a', canonicalPath: repo }, IDEA, worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } })).rejects.toThrow(/spec \(product track\)/);
  });

  it('product track lands when the spec is present', async () => {
    const worktree = await seedWorktree({ spec: true, track: 'product' });
    const r = await landSpec({ name: 'a', canonicalPath: repo }, IDEA, worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } });
    expect(r.branch).toMatch(/^spec\//);
    expect(await show(r.branch, `.docs/specs/${STEM}.md`)).toContain('PRD');
  });

  it('technical track lands WITHOUT a spec (stories carry acceptance criteria)', async () => {
    const worktree = await seedWorktree({ spec: false, track: 'technical' });
    const r = await landSpec({ name: 'a', canonicalPath: repo }, IDEA, worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } });
    expect(r.branch).toMatch(/^spec\//);
    // stories + plan + track marker committed; no spec required.
    expect(await show(r.branch, `.docs/stories/${STEM}.md`)).toContain('Accepted');
    expect(await show(r.branch, `.docs/track/${STEM}.md`)).toContain('Track: technical');
    expect(await show(r.branch, `.docs/specs/${STEM}.md`)).toBeNull();
  });
});
