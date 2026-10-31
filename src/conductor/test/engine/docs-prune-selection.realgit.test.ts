// Covers: task:2, task:4, task:22
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { applyOpenPullRequestDeferral, docsPruneEvent, resolveDocsPruneSelection } from '../../src/engine/docs-prune.js';
import { prunableFilesForStem } from '../../src/engine/docs-retention.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(repo: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFile('git', args, { cwd: repo });
  return { stdout };
}

async function writeDocs(repo: string, files: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(files).map(async ([path, contents]) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), contents);
  }));
}

async function manifestRepo(files: Record<string, string>): Promise<{ repo: string; git: (args: string[]) => Promise<{ stdout: string }> }> {
  const repo = await mkdtemp(join(tmpdir(), 'docs-prune-selection-'));
  roots.push(repo);
  await initTestRepo(repo);
  await writeDocs(repo, files);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'docs']);
  const origin = join(repo, 'origin.git');
  await git(repo, ['init', '--bare', '--initial-branch=main', origin]);
  await git(repo, ['remote', 'add', 'origin', origin]);
  await git(repo, ['push', '-q', '-u', 'origin', 'main']);
  return { repo, git: (args) => git(repo, args) };
}

function manifest(slug: string, artifacts: Array<{ kind: string; path: string }>): string {
  return `${JSON.stringify({ schemaVersion: 1, slug, artifacts })}\n`;
}

const paths = [
  '.docs/shipped/alpha.md', '.docs/plans/alpha.md', '.docs/coherence/alpha.md',
  '.docs/plans/beta.md', '.docs/coherence/beta.md',
];
describe('docs prune selection', () => {
  it('selects only shipped stems from origin/main and defers a complete stem', async () => {
    const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? `${paths.join('\n')}\n` : '' });
    const selected = await resolveDocsPruneSelection('/repo', git as never);
    expect(selected.removable).toEqual(['.docs/plans/alpha.md', '.docs/coherence/alpha.md']);
    expect(selected.skipped).toContainEqual({ stem: 'beta', reason: 'no-shipped-record' });
    const deferred = applyOpenPullRequestDeferral(selected, [{ number: 1, url: 'https://example.test/pr/1', body: '', headSha: 'a', headRef: 'feature', author: 'other', changedPaths: ['.docs/coherence/alpha.md'] }], 'me');
    expect(deferred.removable).toEqual([]);
    expect(deferred.deferred[0]?.paths).toEqual(selected.removable);
  });
});

it('defers only touched stems, including a 150th changed path, and ignores the operator prune PR', async () => {
  const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? [
    '.docs/shipped/alpha.md', '.docs/plans/alpha.md', '.docs/coherence/alpha.md',
    '.docs/shipped/gamma.md', '.docs/plans/gamma.md', '.docs/coherence/gamma.md',
  ].join('\n') : '' });
  const selected = await resolveDocsPruneSelection('/repo', git as never);
  const changedPaths = Array.from({ length: 149 }, (_, index) => `.docs/other/${index}.md`).concat('.docs/plans/alpha.md');
  const deferred = applyOpenPullRequestDeferral(selected, [{ number: 2, url: 'https://example.test/pr/2', body: '', headSha: 'b', headRef: 'feature/alpha', author: 'other', changedPaths }], 'me');
  expect(deferred.deferred).toContainEqual({ stem: 'alpha', paths: selected.stems.get('alpha'), reason: 'open-pr-modifies', pullRequests: ['https://example.test/pr/2'] });
  expect(deferred.removable).toEqual(selected.stems.get('gamma'));

  const ownPr = applyOpenPullRequestDeferral(selected, [{ number: 3, url: 'https://example.test/pr/3', body: '', headSha: 'c', headRef: 'docs-prune/2026-10-22', author: 'me', changedPaths: ['.docs/coherence/alpha.md'] }], 'me');
  expect(ownPr.deferred).toEqual([]);
  expect(ownPr.removable).toEqual(selected.removable);
});

it('keeps an exact dated artifact while excluding an ambiguous undated match', async () => {
  const collisionPaths = [
    '.docs/shipped/2026-10-01-alpha.md', '.docs/plans/2026-10-01-alpha.md',
    '.docs/plans/2026-10-20-alpha.md', '.docs/coherence/2026-10-01-alpha.md',
    '.docs/conflicts/alpha.md',
  ];
  const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? `${collisionPaths.join('\n')}\n` : '' });
  const selected = await resolveDocsPruneSelection('/repo', git as never);
  expect(selected.removable).toContain('.docs/coherence/2026-10-01-alpha.md');
  expect(selected.removable).not.toContain('.docs/conflicts/alpha.md');
  expect(selected.excluded).toContain('.docs/conflicts/alpha.md');
});

it('selects only manifest-listed prunable kinds plus stem-ruled records, and leaves unlisted coherence', async () => {
  const { repo, git: runner } = await manifestRepo({
    '.docs/shipped/alpha.md': 'shipped\n',
    '.docs/alpha/manifest.json': manifest('alpha', [
      { kind: 'plan', path: '.docs/plans/alpha.md' },
      { kind: 'coherence', path: '.docs/coherence/alpha.md' },
      { kind: 'track', path: '.docs/track/alpha.md' },
      { kind: 'complexity', path: '.docs/complexity/alpha.md' },
      { kind: 'stories', path: '.docs/stories/alpha.md' },
      { kind: 'decision', path: '.docs/decisions/adr-alpha.md' },
    ]),
    '.docs/plans/alpha.md': 'plan\n',
    '.docs/coherence/alpha.md': 'coherence\n',
    '.docs/track/alpha.md': 'track\n',
    '.docs/complexity/alpha.md': 'complexity\n',
    '.docs/stories/alpha.md': 'stories\n',
    '.docs/decisions/adr-alpha.md': 'decision\n',
    '.docs/halted/alpha.md': 'halted\n',
    '.docs/plan-review/alpha.md': 'review\n',
    '.docs/retros/alpha.md': 'retro\n',
    '.docs/shipped/bravo.md': 'shipped\n',
    '.docs/bravo/manifest.json': manifest('bravo', [{ kind: 'plan', path: '.docs/plans/bravo.md' }]),
    '.docs/plans/bravo.md': 'plan\n',
    '.docs/coherence/bravo.md': 'unlisted coherence\n',
  });

  const selected = await resolveDocsPruneSelection(repo, runner as never);
  expect(selected.stems.get('alpha')).toEqual([
    '.docs/plans/alpha.md',
    '.docs/coherence/alpha.md',
    '.docs/track/alpha.md',
    '.docs/complexity/alpha.md',
    '.docs/alpha/manifest.json',
    '.docs/halted/alpha.md',
    '.docs/plan-review/alpha.md',
    '.docs/retros/alpha.md',
  ]);
  expect(selected.removable).not.toContain('.docs/stories/alpha.md');
  expect(selected.removable).not.toContain('.docs/decisions/adr-alpha.md');
  expect(selected.removable).not.toContain('.docs/coherence/bravo.md');
});

it('skips only malformed manifests, records the skipped reason in the event, and preserves legacy selection', async () => {
  const { repo, git: runner } = await manifestRepo({
    '.docs/shipped/valid.md': 'shipped\n',
    '.docs/valid/manifest.json': manifest('valid', [{ kind: 'plan', path: '.docs/plans/valid.md' }]),
    '.docs/plans/valid.md': 'plan\n',
    '.docs/shipped/broken.md': 'shipped\n',
    '.docs/broken/manifest.json': '{ invalid json\n',
    '.docs/plans/broken.md': 'plan\n',
    '.docs/shipped/legacy.md': 'shipped\n',
    '.docs/plans/legacy.md': 'plan\n',
    '.docs/coherence/legacy.md': 'coherence\n',
  });

  const selected = await resolveDocsPruneSelection(repo, runner as never);
  expect(selected.stems.get('valid')).toEqual(['.docs/plans/valid.md', '.docs/valid/manifest.json']);
  expect(selected.stems.has('broken')).toBe(false);
  expect(selected.skipped).toContainEqual({ stem: 'broken', reason: 'malformed-manifest' });
  expect(docsPruneEvent(selected).skipped).toContainEqual({ stem: 'broken', reason: 'malformed-manifest' });
  expect(selected.stems.get('legacy')).toEqual(prunableFilesForStem([
    '.docs/shipped/legacy.md', '.docs/plans/legacy.md', '.docs/coherence/legacy.md',
  ].sort(), 'legacy'));
});
