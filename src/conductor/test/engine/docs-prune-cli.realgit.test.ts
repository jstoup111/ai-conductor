// Covers: task:9, task:10
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { dispatchDocsPrune } from '../../src/engine/docs-prune-cli.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function ghFor(openPullRequests: unknown[]) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
    if (args.includes('graphql')) return { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: openPullRequests, pageInfo: { hasNextPage: false, endCursor: null } } } } }) };
    if (args[0] === 'api') return { stdout: 'me\n' };
    throw new Error(`unexpected gh command: ${args.join(' ')}`);
  });
}

it('fails closed when its guarded commit cannot establish the exact deletion set', async () => {
  const errors: string[] = [];
  const git = vi.fn(async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? '.docs/shipped/alpha.md\n.docs/plans/alpha.md\n' : '' }));
  const gh = vi.fn(async (args: string[]) => args[0] === 'repo' ? ({ stdout: JSON.stringify({ nameWithOwner: 'o/r' }) }) : ({ stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }) }));
  await expect(dispatchDocsPrune({ kind: 'run' }, process.cwd(), { git: git as never, gh: gh as never, reportError: (m) => errors.push(m) })).resolves.toBe(1);
  expect(errors.join('\n')).toContain('unexpected staged path');
});

it('persists one empty prune event and performs no publication when origin/main has no prunable files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'docs-prune-cli-'));
  roots.push(cwd);
  const reports: string[] = [];
  const git = vi.fn(async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? '.docs/shipped/alpha.md\n' : '' }));
  await expect(dispatchDocsPrune({ kind: 'run' }, cwd, { git: git as never, gh: ghFor([]) as never, report: (message) => reports.push(message) })).resolves.toBe(0);
  expect(reports.join('\n')).toContain('None');
  expect(git.mock.calls.some(([args]) => args[0] === 'worktree')).toBe(false);
  const events = await readFile(join(cwd, '.pipeline', 'events.jsonl'), 'utf8');
  expect(events.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ type: 'decide_artifacts_pruned', removed: [] }),
  ]);
});

it('fails before committing or publishing when another operator owns an open docs-prune PR', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'docs-prune-cli-'));
  roots.push(cwd);
  const errors: string[] = [];
  const git = vi.fn(async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? '.docs/shipped/alpha.md\n.docs/plans/alpha.md\n' : '' }));
  const foreign = [{ number: 8, url: 'https://example.test/pr/8', body: '', headRefOid: 'a'.repeat(40), headRefName: 'docs-prune/2026-10-22', author: { login: 'other' }, files: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }];
  await expect(dispatchDocsPrune({ kind: 'run' }, cwd, { git: git as never, gh: ghFor(foreign) as never, reportError: (message) => errors.push(message) })).resolves.toBe(1);
  expect(errors.join('\n')).toContain('https://example.test/pr/8');
  expect(git.mock.calls.some(([args]) => args[0] === 'worktree')).toBe(false);
  await expect(readFile(join(cwd, '.pipeline', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
