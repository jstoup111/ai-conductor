// Test: work-track marker + track-aware landSpec (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location, FR-2/13).
//
//   - parseTrack: valid / absent / garbled
//   - writeTrackMarker: writes product/technical, no-op on invalid
//   - landSpec: product track REQUIRES a PRD/spec; technical track lands WITHOUT
//     a spec (acceptance criteria live in stories); runAuthoring commits a track
//     marker (default product).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { landSpec } from '../../../src/engine/engineer/land-spec.js';
import { runAuthoring } from '../../../src/engine/engineer/authoring.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { writeTrackMarker } from '../../../src/engine/engineer/track-marker.js';
import { parseTrack } from '../../../src/engine/artifacts.js';

const execFile = promisify(execFileCb);

const ACCEPTED_STORIES = ['# Stories: t', '', '**Status:** Accepted', '', '## S', '### Acceptance Criteria', '- G/W/T.', ''].join('\n');
const PLAN = ['# Plan: t', '', '**Stories:** .docs/stories/t.md', '', '## Task Dependency Graph', '```', '1', '```', ''].join('\n');

let repo: string;
let defaultBranch: string;
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
  defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

// Create the per-idea worktree and seed .docs into IT (the engineer authors in the
// worktree, not the primary checkout); returns the worktree path for landSpec.
async function seedWorktree(opts: { spec?: boolean; track?: string }): Promise<string> {
  const wt = await createEngineerWorktree(repo, 'idea t');
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.docs/observation'), { recursive: true });
  await writeFile(join(dir, '.docs/stories/t.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs/plans/t.md'), PLAN);
  // Add observation marker
  await writeFile(
    join(dir, '.docs/observation/t.md'),
    'Signature: t-fixed\nSurface: daemon-log\nWindow-days: 7'
  );
  if (opts.spec) {
    await mkdir(join(dir, '.docs/specs'), { recursive: true });
    await writeFile(join(dir, '.docs/specs/t.md'), '# PRD: t\n\nApproved.\n');
  }
  if (opts.track) {
    await mkdir(join(dir, '.docs/track'), { recursive: true });
    await writeFile(join(dir, '.docs/track/t.md'), `# Track\n\nTrack: ${opts.track}\n`);
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

describe('writeTrackMarker', () => {
  it('writes the marker for a valid track', async () => {
    const p = await writeTrackMarker(repo, 'slug', 'technical');
    expect(p).toBeTruthy();
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(repo, '.docs/track/slug.md'), 'utf8')).toContain('Track: technical');
  });
  it('no-ops on an invalid track', async () => {
    expect(await writeTrackMarker(repo, 'slug', undefined)).toBeNull();
    expect(await writeTrackMarker(repo, 'slug', 'bogus' as never)).toBeNull();
  });
});

describe('landSpec — track-aware required artifacts', () => {
  it('product track (default, no marker) REQUIRES a spec', async () => {
    const worktree = await seedWorktree({ spec: false }); // no spec, no track marker → defaults product
    await expect(landSpec({ name: 'a', canonicalPath: repo }, 'idea t', worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } })).rejects.toThrow(/spec \(product track\)/);
  });

  it('product track lands when the spec is present', async () => {
    const worktree = await seedWorktree({ spec: true, track: 'product' });
    const r = await landSpec({ name: 'a', canonicalPath: repo }, 'idea t', worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } });
    expect(r.branch).toMatch(/^spec\//);
    expect(await show(r.branch, '.docs/specs/t.md')).toContain('PRD');
  });

  it('technical track lands WITHOUT a spec (stories carry acceptance criteria)', async () => {
    const worktree = await seedWorktree({ spec: false, track: 'technical' });
    const r = await landSpec({ name: 'a', canonicalPath: repo }, 'idea t', worktree, undefined, { ownerConfig: { spec_owner: 'test-owner' } });
    expect(r.branch).toMatch(/^spec\//);
    // stories + plan + track marker committed; no spec required.
    expect(await show(r.branch, '.docs/stories/t.md')).toContain('Accepted');
    expect(await show(r.branch, '.docs/track/t.md')).toContain('Track: technical');
    expect(await show(r.branch, '.docs/specs/t.md')).toBeNull();
  });
});

describe('runAuthoring — commits a track marker', () => {
  function approvedDecide() {
    return async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD: t\n\nApproved.\n' };
      if (step === 'stories') return { approved: true, artifact: ACCEPTED_STORIES };
      if (step === 'plan') return { approved: true, artifact: PLAN };
      return { approved: true, artifact: '' };
    };
  }
  it('writes .docs/track/<slug>.md defaulting to product', async () => {
    const r = await runAuthoring({ name: 'a', canonicalPath: repo }, 'idea t', { decide: approvedDecide() });
    await git(['checkout', defaultBranch]);
    await git(['merge', '--no-ff', '-m', 'm', r.branch]);
    expect(parseTrack(await show(defaultBranch, '.docs/track/idea-t.md'))).toBe('product');
  });
});
