// Covers: task:11, task:12

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { detectEngineerCommand, dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';
import type { GitRunner } from '../../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);
let root: string;
let repo: string;
let registry: string;

const stories = `# Stories: dependency gate\n\n**Status:** Accepted\n\n## Story 1: gate\n### Acceptance Criteria\n#### Happy Path\n- Given X, when Y, then Z.\n\n#### Negative Paths\n- Given invalid input, when Y, then it is refused.\n`;
const plan = `# Implementation Plan: dependency gate\n\n**Stories:** .docs/stories/dependency-gate.md\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n\n**Files likely touched:**\n- src/example.ts\n`;

async function git(args: string[], cwd = repo): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function seed(idea = 'dependency gate'): Promise<string> {
  const stem = idea.replaceAll(' ', '-');
  const wt = await createEngineerWorktree(repo, idea);
  await rm(join(wt.worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  for (const folder of ['specs', 'stories', 'plans']) await mkdir(join(wt.worktreePath, '.docs', folder), { recursive: true });
  await writeFile(join(wt.worktreePath, `.docs/specs/${stem}.md`), `# PRD: ${idea}\n\nApproved.\n`);
  await writeFile(join(wt.worktreePath, `.docs/stories/${stem}.md`), stories);
  await writeFile(join(wt.worktreePath, `.docs/plans/${stem}.md`), plan.replaceAll('dependency-gate', stem));
  return wt.worktreePath;
}

function dispatch(args: string[], gh: GhRunner, gitRunner: GitRunner): { out: string[]; err: string[]; run: () => Promise<number> } {
  const out: string[] = [];
  const err: string[] = [];
  const command = detectEngineerCommand(['node', 'conduct', 'compose', 'land', ...args]);
  if (!command) throw new Error('expected land command');
  const options: DispatchEngineerOpts = {
    registryPath: registry, gh, git: gitRunner,
    print: (line) => out.push(line), printErr: (line) => err.push(line),
  };
  return { out, err, run: () => dispatchEngineer(command, options) };
}

function recordingGh({ unavailable, rateLimit }: { unavailable?: boolean; rateLimit?: boolean } = {}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const text = args.join(' ');
    if (text === 'api user --jq .login') return { stdout: 'operator\n' };
    if (unavailable) throw new Error(rateLimit ? 'GitHub API rate limit exceeded' : 'tracker unreachable');
    if (text.includes('issue view 536')) return { stdout: JSON.stringify({ body: 'Depends on #600.' }) };
    if (text.includes('dependencies/blocked_by')) return { stdout: '[]' };
    if (text.includes('issue list')) return { stdout: '[]' };
    if (text.includes('--json state')) return { stdout: 'OPEN' };
    throw new Error(`unexpected gh call: ${text}`);
  };
  return { gh, calls };
}

function dependencyGh({ body = 'Depends on #520 / #600.', writeFails = false }: { body?: string; writeFails?: boolean } = {}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const text = args.join(' ');
    if (text === 'api user --jq .login') return { stdout: 'operator\n' };
    if (text.includes('issue view 536') && text.includes('--json body')) return { stdout: JSON.stringify({ body }) };
    if (text.includes('dependencies/blocked_by')) {
      if (text.includes('--method POST')) {
        if (writeFails) throw new Error('dependency endpoint unavailable');
        return { stdout: '' };
      }
      return { stdout: '[]' };
    }
    if (text.includes('issue list')) return { stdout: '[]' };
    if (text.includes('--json state')) return { stdout: 'OPEN' };
    if (text.includes('issue view 536') && text.includes('--json assignees')) return { stdout: JSON.stringify({ assignees: [{ login: 'operator' }] }) };
    if (text.includes('api repos/owner/repo/issues/520')) return { stdout: JSON.stringify({ id: 5200 }) };
    throw new Error(`unexpected gh call: ${text}`);
  };
  return { gh, calls };
}

const quietGit: GitRunner = async () => ({ stdout: '' });

async function events(): Promise<Array<{ type: string; gate?: string; reason?: string }>> {
  return (await readFile(join(repo, '.pipeline/composer-events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cli-land-deps-'));
  repo = join(root, 'repo');
  registry = join(root, 'registry.json');
  await mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  await writeFile(registry, JSON.stringify([{ schemaVersion: 1, name: 'target', path: repo, status: 'registered', registeredAt: '2026-01-01T00:00:00.000Z' }]));
});
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 3 }); });

describe('compose land dependency refusal integration', () => {
  it('rejects an undecided proposal before commit and records its closed gate', async () => {
    const worktree = await seed(); const { gh } = recordingGh();
    const cli = dispatch(['--project', 'target', '--idea', 'dependency gate', '--worktree', worktree, '--source-ref', 'owner/repo#536'], gh, quietGit);
    const before = await git(['rev-parse', 'HEAD'], worktree);
    expect(await cli.run()).toBe(1);
    expect(await git(['rev-parse', 'HEAD'], worktree)).toBe(before);
    expect(cli.err.join('\n')).toContain('owner/repo#600');
    expect(cli.err.join('\n')).toContain('--decline-dependency');
    expect(await events()).toEqual([expect.objectContaining({ type: 'land_gate_rejected', gate: 'dependency-proposals-undecided', reason: expect.stringContaining('#600') })]);
  });

  it.each([[false, /tracker unreachable/], [true, /rate limit/i]] as const)('rejects unavailable tracker checks and records the cause', async (rateLimit, cause) => {
    const worktree = await seed(); const { gh } = recordingGh({ unavailable: true, rateLimit });
    const cli = dispatch(['--project', 'target', '--idea', 'dependency gate', '--worktree', worktree, '--source-ref', 'owner/repo#536'], gh, quietGit);
    expect(await cli.run()).toBe(1);
    expect(cli.err.join('\n')).toMatch(cause);
    expect(cli.err.join('\n')).toContain('--skip-dependency-check');
    expect(await events()).toEqual([expect.objectContaining({ type: 'land_gate_rejected', gate: 'dependency-check-unavailable' })]);
  });

  it('records invalid decisions and makes no dependency read without a source ref', async () => {
    const worktree = await seed(); const recording = recordingGh();
    const invalid = dispatch(['--project', 'target', '--idea', 'dependency gate', '--worktree', worktree, '--depends-on', 'owner/repo#520'], recording.gh, quietGit);
    expect(await invalid.run()).toBe(1);
    expect(invalid.err.join('\n')).toContain('source-ref');
    expect(await events()).toEqual([expect.objectContaining({ gate: 'dependency-decisions-invalid' })]);

    const markerless = await seed('markerless gate'); const noSource = recordingGh();
    const accepted = dispatch(['--project', 'target', '--idea', 'markerless gate', '--worktree', markerless], noSource.gh, quietGit);
    expect(await accepted.run()).toBe(0);
    expect(noSource.calls.map((call) => call.join(' ')).filter((call) => call !== 'api user --jq .login')).toEqual([]);
    expect((await events()).filter((event) => event.type === 'land_dependency_decided')).toEqual([]);
  });

  it.each([
    ['both accepted and declined', ['--source-ref', 'owner/repo#536', '--depends-on', 'owner/repo#600', '--decline-dependency', 'owner/repo#600'], /both accepted and declined/],
    ['a decline that was never proposed', ['--source-ref', 'owner/repo#536', '--decline-dependency', 'owner/repo#777'], /never proposed/],
    ['an empty skip reason', ['--skip-dependency-check', ''], /requires a reason/],
  ])('records %s as a dependency decision validation rejection', async (_name, flags, message) => {
    const idea = `invalid ${_name}`;
    const worktree = await seed(idea); const { gh } = recordingGh();
    const cli = dispatch(['--project', 'target', '--idea', idea, '--worktree', worktree, ...flags], gh, quietGit);
    const before = await git(['rev-parse', 'HEAD'], worktree);
    expect(await cli.run()).toBe(1);
    expect(await git(['rev-parse', 'HEAD'], worktree)).toBe(before);
    expect(cli.err.join('\n')).toMatch(message);
    expect((await events()).at(-1)).toEqual(expect.objectContaining({ type: 'land_gate_rejected', gate: 'dependency-decisions-invalid' }));
  });
});

describe('compose land dependency post-commit integration', () => {
  it('writes only accepted edges after commit and records the complete decision', async () => {
    const worktree = await seed(); const recording = dependencyGh();
    const cli = dispatch([
      '--project', 'target', '--idea', 'dependency gate', '--worktree', worktree,
      '--source-ref', 'owner/repo#536', '--depends-on', 'owner/repo#520',
      '--decline-dependency', 'owner/repo#600',
    ], recording.gh, quietGit);
    const before = await git(['rev-parse', 'HEAD'], worktree);
    expect(await cli.run()).toBe(0);
    expect(await git(['rev-parse', 'HEAD'], worktree)).not.toBe(before);
    expect(recording.calls.map((call) => call.join(' ')).filter((call) => call.includes('--method POST'))).toEqual([
      expect.stringContaining('repos/owner/repo/issues/536/dependencies/blocked_by'),
    ]);
    expect(await events()).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'land_dependency_decided', sourceRef: 'owner/repo#536',
      proposals: ['owner/repo#520', 'owner/repo#600'], accepted: ['owner/repo#520'],
      declined: ['owner/repo#600'], skipped: null,
      writes: [expect.objectContaining({ target: 'owner/repo#520', status: 'created' })],
    })]));
  });

  it('commits with zero writes when all proposals are declined or none exist', async () => {
    const declinedWorktree = await seed(); const declined = dependencyGh();
    const declinedCli = dispatch([
      '--project', 'target', '--idea', 'dependency gate', '--worktree', declinedWorktree,
      '--source-ref', 'owner/repo#536', '--decline-dependency', 'owner/repo#520',
      '--decline-dependency', 'owner/repo#600',
    ], declined.gh, quietGit);
    expect(await declinedCli.run()).toBe(0);
    expect(declined.calls.map((call) => call.join(' ')).filter((call) => call.includes('--method POST'))).toEqual([]);

    const noneWorktree = await seed('no proposals'); const none = dependencyGh({ body: 'Related to #520.' });
    const noneCli = dispatch(['--project', 'target', '--idea', 'no proposals', '--worktree', noneWorktree, '--source-ref', 'owner/repo#536'], none.gh, quietGit);
    expect(await noneCli.run()).toBe(0);
    expect(none.calls.map((call) => call.join(' ')).filter((call) => call.includes('--method POST'))).toEqual([]);
  });

  it('never writes an accepted edge when a later land gate rejects the commit', async () => {
    const worktree = await seed('render rejection'); const recording = dependencyGh();
    await writeFile(join(worktree, '.docs', 'specs', 'render-rejection.md'), '# PRD: render rejection\n\n```mermaid\nthis is not a diagram\n```\n');
    const cli = dispatch([
      '--project', 'target', '--idea', 'render rejection', '--worktree', worktree,
      '--source-ref', 'owner/repo#536', '--depends-on', 'owner/repo#520', '--decline-dependency', 'owner/repo#600',
    ], recording.gh, quietGit);
    expect(await cli.run()).toBe(1);
    expect(recording.calls.map((call) => call.join(' ')).filter((call) => call.includes('--method POST'))).toEqual([]);
  });

  it('records a skipped unavailable check and retains a committed spec when a post-commit write fails', async () => {
    const skippedWorktree = await seed(); const unavailable = recordingGh({ unavailable: true });
    const skippedCli = dispatch([
      '--project', 'target', '--idea', 'dependency gate', '--worktree', skippedWorktree,
      '--source-ref', 'owner/repo#536', '--skip-dependency-check', 'GitHub outage',
    ], unavailable.gh, quietGit);
    expect(await skippedCli.run()).toBe(0);
    expect(await events()).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'land_dependency_decided', skipped: { reason: 'GitHub outage' }, proposals: [], accepted: [], declined: [], writes: [],
    })]));

    const failedWorktree = await seed('failed dependency write'); const failed = dependencyGh({ writeFails: true });
    const failedCli = dispatch([
      '--project', 'target', '--idea', 'failed dependency write', '--worktree', failedWorktree,
      '--source-ref', 'owner/repo#536', '--depends-on', 'owner/repo#520', '--decline-dependency', 'owner/repo#600',
    ], failed.gh, quietGit);
    const before = await git(['rev-parse', 'HEAD'], failedWorktree);
    expect(await failedCli.run()).toBe(0);
    expect(await git(['rev-parse', 'HEAD'], failedWorktree)).not.toBe(before);
    expect(failedCli.err.join('\n')).toContain('dependency write failed');
    expect((await events()).at(-1)).toEqual(expect.objectContaining({
      type: 'land_dependency_decided', writes: [expect.objectContaining({ target: 'owner/repo#520', status: 'failed' })],
    }));
  });
});
