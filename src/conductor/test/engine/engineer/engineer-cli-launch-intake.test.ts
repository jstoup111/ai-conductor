// engineer-cli-launch-intake.test.ts — intake wired into the LIVE launch path.
//
// Regression coverage for the bug where bare `conduct-ts engineer` dropped straight
// into `claude /engineer` and never ran intake (poll-on-launch lived only in the
// test-only runEngineerMode). This pins the three idea sources — github intake,
// CLI idea arg, and direct chat — plus the `claim` dequeue seam and the
// `--source-ref` write-back on land/handoff. gh is injected; no network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';

// Only `spawn` is faked (to exercise the real, non-injected `launchInteractive`
// default without actually spawning `claude`) — `execFile` (used by the git-repo
// test scaffolding below) stays real.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }),
  };
});

import {
  detectEngineerCommand,
  dispatchEngineer,
  engineerLaunchArgs,
  prePollIntake,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import { parseEnvelope } from '../../../src/engine/engineer/intake/port.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';

const execFile = promisify(execFileCb);
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

// ── fake gh: issue list (poll), comment/label/edit (write-back), pr create ─────
function makeGh(
  issuesByRepo: Record<string, Array<{ number: number; title: string; body: string; labels?: string[] }>> = {},
  prUrl = 'https://example.invalid/repo/pull/42',
) {
  const calls: string[][] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      const ri = args.indexOf('-R');
      const repo = ri >= 0 ? args[ri + 1] : opts.cwd;
      const issues = issuesByRepo[repo] ?? [];
      return {
        stdout: JSON.stringify(
          issues.map((i) => ({ number: i.number, title: i.title, body: i.body, labels: (i.labels ?? []).map((l) => ({ name: l })) })),
        ),
      };
    }
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: prUrl };
    // Owner-identity resolution (fail-closed slice B): resolve a login.
    if (args[0] === 'api' && args[1] === 'user') return { stdout: 'test-owner\n' };
    // Dependency lookup (blocker-resolver): default to "no blockers" so
    // callers that don't care about dependency ordering aren't tripped up
    // by an empty-string response failing JSON.parse.
    if (args[0] === 'api' && args[1]?.includes('/dependencies/blocked_by')) return { stdout: '[]' };
    return { stdout: '' };
  };
  return { gh, calls };
}

// ── git repo + .docs artifacts (for land/handoff e2e) ──────────────────────────
async function makeGitRepo(name: string, baseDir: string): Promise<string> {
  const repoPath = join(baseDir, name);
  await mkdir(repoPath, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.test'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  return repoPath;
}

async function writeDocsArtifacts(repoPath: string, idea: string): Promise<void> {
  const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const specsDir = join(repoPath, '.docs', 'specs');
  const storiesDir = join(repoPath, '.docs', 'stories');
  const plansDir = join(repoPath, '.docs', 'plans');
  await mkdir(specsDir, { recursive: true });
  await mkdir(storiesDir, { recursive: true });
  await mkdir(plansDir, { recursive: true });
  await writeFile(join(specsDir, `${slug}.md`), `# PRD: ${idea}\n\nApproved spec content.\n`, 'utf-8');
  await writeFile(
    join(storiesDir, `${slug}.md`),
    `# Stories: ${idea}\n\n**Status:** Accepted\n\n## Story: main\n\n### AC\n- Given x, when y, then z.\n`,
    'utf-8',
  );
  await writeFile(
    join(plansDir, `${slug}.md`),
    `# Plan: ${idea}\n\n## Tasks\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n`,
    'utf-8',
  );
}

// ── scaffolding ────────────────────────────────────────────────────────────────
let workDir: string;
let registryPath: string;
let engineerDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-launch-intake-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeRegistry(repos: Array<{ name: string; path?: string; remote?: string }>): Promise<void> {
  const records = repos.map((r) => ({
    schemaVersion: 1,
    name: r.name,
    path: r.path ?? join(workDir, r.name.replace('/', '_')),
    ...(r.remote ? { remote: r.remote } : {}),
    status: 'registered',
    registeredAt: '2026-06-27T00:00:00.000Z',
  }));
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function baseOpts(extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts {
  return { registryPath, engineerDir, print: () => {}, printErr: () => {}, ...extra };
}

const envelope = (sourceRef: string, text: string) =>
  parseEnvelope({ id: sourceRef, source: 'github-issues', sourceRef, text, status: 'pending', receivedAt: '2026-06-27T00:00:00.000Z' });

// ═══════════════════════════════════════════════════════════════════════════════
// 1. detection grammar — idea sources + claim + --source-ref
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectEngineerCommand: idea sources, claim, --source-ref', () => {
  it('bare `engineer` → launch with no idea', () => {
    expect(detectEngineerCommand(argv())).toEqual({ kind: 'launch' });
  });
  it('`engineer --idea "<text>"` → launch with idea', () => {
    expect(detectEngineerCommand(argv('--idea', 'add a healthz endpoint'))).toEqual({
      kind: 'launch',
      idea: 'add a healthz endpoint',
    });
  });
  it('bare positional free text → launch with joined idea', () => {
    expect(detectEngineerCommand(argv('add', 'a', 'healthz', 'endpoint'))).toEqual({
      kind: 'launch',
      idea: 'add a healthz endpoint',
    });
  });
  it('`engineer claim` → claim', () => {
    expect(detectEngineerCommand(argv('claim'))).toEqual({ kind: 'claim' });
  });
  it('recognized subcommands are not shadowed by the positional idea fallthrough', () => {
    expect(detectEngineerCommand(argv('projects'))).toEqual({ kind: 'projects' });
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });
  it('land/handoff carry optional --source-ref (and required --worktree)', () => {
    expect(detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i', '--worktree', '/w', '--source-ref', 'o/a#1'))).toEqual({
      kind: 'land', project: 'p', idea: 'i', worktree: '/w', sourceRef: 'o/a#1',
    });
    expect(detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'spec/x', '--worktree', '/w', '--source-ref', 'o/a#1'))).toEqual({
      kind: 'handoff', project: 'p', branch: 'spec/x', worktree: '/w', sourceRef: 'o/a#1',
    });
  });
  it('land without --source-ref leaves it undefined', () => {
    expect(detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i', '--worktree', '/w'))).toEqual({
      kind: 'land', project: 'p', idea: 'i', worktree: '/w', sourceRef: undefined,
    });
  });
  it('land/handoff without --worktree fall back to guide (strict isolation)', () => {
    expect(detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i'))).toEqual({ kind: 'guide' });
    expect(detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'spec/x'))).toEqual({ kind: 'guide' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. engineerLaunchArgs — idea is appended to the slash command prompt
// ═══════════════════════════════════════════════════════════════════════════════

describe('engineerLaunchArgs: idea passthrough', () => {
  it('no idea → exactly /engineer (backward compatible)', () => {
    expect(engineerLaunchArgs({})).toEqual(['--permission-mode', 'default', '/engineer']);
  });
  it('idea → appended to the /engineer prompt', () => {
    expect(engineerLaunchArgs({}, 'add a /metrics endpoint')).toEqual([
      '--permission-mode', 'default', '/engineer add a /metrics endpoint',
    ]);
  });
  it('blank idea is treated as no idea', () => {
    expect(engineerLaunchArgs({}, '   ')).toEqual(['--permission-mode', 'default', '/engineer']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. prePollIntake — primes the durable inbox from github issues
// ═══════════════════════════════════════════════════════════════════════════════

describe('prePollIntake', () => {
  it('polls and enqueues new envelopes, returning the count', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const n = await prePollIntake({ engineerDir, registryPath, gh, printErr: () => {} });
    expect(n).toBe(1);
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1);
  });

  it('is idempotent — a re-poll enqueues nothing new (ledger dedups)', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    expect(await prePollIntake({ engineerDir, registryPath, gh, printErr: () => {} })).toBe(1);
    expect(await prePollIntake({ engineerDir, registryPath, gh, printErr: () => {} })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. dispatchEngineer launch — pre-poll wiring + idea precedence
// ═══════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"launch"}): intake pre-poll', () => {
  it('runs pre-poll before launching and announces the queued count', async () => {
    const order: string[] = [];
    const prePoll = vi.fn().mockImplementation(async () => { order.push('poll'); return 2; });
    const launchInteractive = vi.fn().mockImplementation(async () => { order.push('launch'); return 0; });
    const out: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'launch' },
      baseOpts({ prePoll, launchInteractive, confirmAnother: () => false, print: (s) => out.push(s) }),
    );
    expect(code).toBe(0);
    expect(order).toEqual(['poll', 'launch']); // poll happens BEFORE the session
    expect(out.join('\n')).toMatch(/Intake: 2 issue\(s\) queued/);
  });

  it('a CLI-supplied idea skips the poll and is passed to the launcher (one-shot)', async () => {
    const prePoll = vi.fn().mockResolvedValue(5);
    const launchIdeas: Array<string | undefined> = [];
    const launchInteractive = vi.fn().mockImplementation((idea?: string) => { launchIdeas.push(idea); return 0; });
    const answers = [true, false]; // two sessions: idea-driven, then intake-driven
    const confirmAnother = vi.fn().mockImplementation(() => answers.shift());

    const code = await dispatchEngineer(
      { kind: 'launch', idea: 'add a /metrics endpoint' },
      baseOpts({ prePoll, launchInteractive, confirmAnother }),
    );
    expect(code).toBe(0);
    // First session: idea passed, poll skipped. Second session: idea cleared, poll runs.
    expect(launchIdeas).toEqual(['add a /metrics endpoint', undefined]);
    expect(prePoll).toHaveBeenCalledTimes(1);
  });

  it('a pre-poll failure never blocks the launch', async () => {
    const prePoll = vi.fn().mockRejectedValue(new Error('gh exploded'));
    const launchInteractive = vi.fn().mockResolvedValue(0);
    const err: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'launch' },
      baseOpts({ prePoll, launchInteractive, confirmAnother: () => false, printErr: (s) => err.push(s) }),
    );
    expect(code).toBe(0);
    expect(launchInteractive).toHaveBeenCalledOnce();
    expect(err.join('\n')).toMatch(/pre-poll failed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4a. dispatchEngineer launch — defers pre-poll to a live brain loop (single-writer gate)
// ═══════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"launch"}): defers to a live brain loop', () => {
  // These two tests deliberately do NOT inject `launchInteractive` — that would
  // short-circuit the production default `prePoll` regardless of `brainLoopAlive`
  // (see the "opts.launchInteractive" test-network guard in dispatchEngineer).
  // Instead `node:child_process`'s `spawn` is faked module-wide (above) so the
  // real, non-injected launcher path runs without actually spawning `claude`,
  // letting these tests exercise the real default-`prePoll`-construction logic
  // gated purely by the injected `brainLoopAlive`.

  it('skips the default pre-poll when brainLoopAlive() returns true', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const out: string[] = [];

    const code = await dispatchEngineer(
      { kind: 'launch' },
      baseOpts({
        gh,
        confirmAnother: () => false,
        print: (s) => out.push(s),
        brainLoopAlive: () => true,
        insideClaudeSession: false,
      }),
    );
    expect(code).toBe(0);
    // No queued-count announcement means prePoll never ran (inbox dir isn't
    // even created, since prePollIntake is what creates it).
    expect(out.join('\n')).not.toMatch(/Intake:/);
    await expect(readdir(join(engineerDir, 'inbox'))).rejects.toThrow(/ENOENT/);
  });

  it('runs the default pre-poll when brainLoopAlive() returns false', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const out: string[] = [];

    const code = await dispatchEngineer(
      { kind: 'launch' },
      baseOpts({
        gh,
        confirmAnother: () => false,
        print: (s) => out.push(s),
        brainLoopAlive: () => false,
        insideClaudeSession: false,
      }),
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/Intake: 1 issue\(s\) queued/);
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. dispatchEngineer claim — dequeue the oldest idea for the skill
// ═══════════════════════════════════════════════════════════════════════════════

describe('dispatchEngineer({kind:"claim"})', () => {
  it('returns the oldest envelope as JSON, removes it from the inbox, marks ledger claimed', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await queue.enqueue(envelope('o/a#1', 'first idea'));

    const out: string[] = [];
    const code = await dispatchEngineer({ kind: 'claim' }, baseOpts({ gh: makeGh().gh, print: (s) => out.push(s) }));
    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ kind: 'claim', text: 'first idea', source: 'github-issues', sourceRef: 'o/a#1' });

    // Inbox is now empty (claim+ack removed it).
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json') || f.endsWith('.claimed')).length).toBe(0);
    // Ledger advanced to claimed.
    expect((await ledger.get('github-issues', 'o/a#1'))?.status).toBe('claimed');
  });

  it('empty inbox → {empty:true}', async () => {
    const out: string[] = [];
    const code = await dispatchEngineer({ kind: 'claim' }, baseOpts({ gh: makeGh().gh, print: (s) => out.push(s) }));
    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({ kind: 'claim', empty: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. land/handoff --source-ref — write-back to the originating github issue
// ═══════════════════════════════════════════════════════════════════════════════

describe('write-back via --source-ref', () => {
  it('land --source-ref comments "Routed to <repo>" and advances the ledger to routed', async () => {
    const idea = 'add csv export';
    const repoPath = await makeGitRepo('target-repo', workDir);
    await writeRegistry([{ name: 'target-repo', path: repoPath }]);
    const wt = await createEngineerWorktree(repoPath, idea);
    await rm(join(wt.worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
    await writeDocsArtifacts(wt.worktreePath, idea);
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'target-repo#7' });

    const { gh, calls } = makeGh();
    const code = await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree: wt.worktreePath, sourceRef: 'target-repo#7' },
      baseOpts({ gh }),
    );
    expect(code).toBe(0);
    expect(calls).toContainEqual(['issue', 'comment', '7', '-R', 'target-repo', '--body', 'Routed to target-repo']);
    expect((await ledger.get('github-issues', 'target-repo#7'))?.status).toBe('routed');
  });

  it('handoff --source-ref comments the PR URL, applies the handled label, advances ledger to done', async () => {
    const idea = 'add csv export';
    const repoPath = await makeGitRepo('target-repo', workDir);
    await writeRegistry([{ name: 'target-repo', path: repoPath, remote: 'https://example.invalid/repo.git' }]);
    const wt = await createEngineerWorktree(repoPath, idea);
    await rm(join(wt.worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
    await writeDocsArtifacts(wt.worktreePath, idea);
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'target-repo#7' });

    // Land first to create the spec branch (from the worktree).
    const { gh, calls } = makeGh();
    const landOut: string[] = [];
    await dispatchEngineer(
      { kind: 'land', project: 'target-repo', idea, worktree: wt.worktreePath },
      baseOpts({ gh, print: (s) => landOut.push(s) }),
    );
    const branch = JSON.parse(landOut.join('')).branch;

    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'target-repo', branch, worktree: wt.worktreePath, sourceRef: 'target-repo#7' },
      baseOpts({ gh, ensureRunningLaunch: () => {} }),
    );
    expect(code).toBe(0);
    // Done comment with the PR URL + label applied.
    expect(calls.some((a) => a[0] === 'issue' && a[1] === 'comment' && a.includes('target-repo') && a.some((s) => /pull\/42/.test(s)))).toBe(true);
    expect(calls.some((a) => a[0] === 'api' && a.includes('POST') && a.some((s) => /\/issues\/7\/labels$/.test(s)) && a.includes('labels[]=engineer:handled'))).toBe(true);
    const entry = await ledger.get('github-issues', 'target-repo#7');
    expect(entry?.status).toBe('done');
    expect(entry?.prUrl).toMatch(/pull\/42/);
  });
});
