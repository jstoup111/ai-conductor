// Covers: task:1, task:2, task:3, task:4
// `conduct-ts engineer poll` + `engineer forget` CLI primitives (Phase 9.3b, T22/T23).
// FR-32 (poll-on-launch primitive) + FR-40 (manual forget). gh is injected — no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import { parseEnvelope } from '../../../src/engine/engineer/intake/port.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';
import type { InteractiveGithubOperationConfirmation } from '../../../src/engine/github-operation-approval.js';
import type { GithubIssueTarget } from '../../../src/engine/github-operations.js';

const execFile = promisify(execFileCb);

// ── fake gh: issue list + edit (label strip) ──────────────────────────────────

function makeGh(
  issuesByRepo: Record<string, Array<{ number: number; title: string; body: string; labels?: string[] }>>,
  rejectOperation?: 'comment' | 'close',
  assignees: Array<{ login: string }> = [{ login: 'test-owner' }],
) {
  const calls: string[][] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === rejectOperation) {
      throw new Error(`${rejectOperation} rejected`);
    }
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
    if (args[0] === 'issue' && args[1] === 'view' && args.includes('assignees')) {
      return { stdout: JSON.stringify({ assignees }) };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

// ── scaffolding ───────────────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-intake-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeRegistry(repos: Array<{ name: string }>): Promise<void> {
  const records = repos.map((r) => ({
    schemaVersion: 1,
    name: r.name,
    path: join(workDir, r.name.replace('/', '_')),
    status: 'registered',
    registeredAt: '2026-06-27T00:00:00.000Z',
  }));
  await Promise.all(records.map((record) => mkdir(record.path, { recursive: true })));
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts => ({
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    intakeResolveActor: async () => ({ resolved: true, id: 'test-owner' }),
    ...extra,
  });
  return { out, err, opts };
}

// ═══════════════════════════════════════════════════════════════════════════════

// detectEngineerCommand reads process.argv offsets: [node, entry, 'engineer', sub, ...].
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];
const composeArgv = (...rest: string[]) => ['node', 'conduct-ts', 'compose', ...rest];

describe('detectEngineerCommand: poll + forget grammar', () => {
  it('parses `engineer poll`', () => {
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });
  it('parses `engineer forget <ref>`', () => {
    expect(detectEngineerCommand(argv('forget', 'o/a#1'))).toEqual({ kind: 'forget', sourceRef: 'o/a#1' });
  });
  it('parses `compose forget <source-ref> --resolved-by <reference>`', () => {
    expect(detectEngineerCommand(composeArgv('forget', 'o/a#1', '--resolved-by', 'o/a#2'))).toEqual({
      kind: 'forget',
      sourceRef: 'o/a#1',
      resolvedBy: 'o/a#2',
    });
  });
  it('preserves the forget descriptor shape without `--resolved-by`', () => {
    expect(detectEngineerCommand(composeArgv('forget', 'o/a#1'))).toEqual({ kind: 'forget', sourceRef: 'o/a#1' });
  });
  it.each([
    ['missing', composeArgv('forget', 'o/a#1', '--resolved-by')],
    ['blank', composeArgv('forget', 'o/a#1', '--resolved-by', '')],
    ['flag-shaped', composeArgv('forget', 'o/a#1', '--resolved-by', '--other')],
  ])('guides when `--resolved-by` has a %s value', (_case, command) => {
    expect(detectEngineerCommand(command)).toEqual({ kind: 'guide' });
  });
  it('rejects unknown forget flags by name', () => {
    expect(detectEngineerCommand(composeArgv('forget', 'o/a#1', '--unknown'))).toEqual({
      kind: 'reject', sub: 'forget', flag: '--unknown',
    });
  });
  it('forget without a ref → guide', () => {
    expect(detectEngineerCommand(argv('forget'))).toEqual({ kind: 'guide' });
  });
});

describe('engineer poll (T22, FR-32)', () => {
  it('polls issues and enqueues envelopes into the inbox', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, err, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    expect(code, err.join('\n')).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 1, sourceRefs: ['o/a#1'] });

    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1);
  });

  it('double poll enqueues no duplicates (ledger dedups)', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, opts } = captureOut();

    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    out.length = 0;
    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));

    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 0 });
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1); // still just the one
  });
});

describe('engineer land tracker write-back (Task 11)', () => {
  // Covers: task:11
  it('reports a Jira source ref as a successful no-op through the CLI event spine', async () => {
    const repoPath = join(workDir, 'tracker-project');
    await mkdir(repoPath, { recursive: true });
    const git = async (args: string[], cwd = repoPath) => (await execFile('git', args, { cwd })).stdout.trim();
    await git(['init', '-b', 'main', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(repoPath, 'README.md'), '# tracker project\n');
    await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
    await writeFile(join(repoPath, '.ai-conductor', 'config.yml'), 'tracker:\n  backend: jira\n');
    await git(['add', 'README.md', '.ai-conductor/config.yml']);
    await git(['commit', '-m', 'initial']);
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1,
      name: 'tracker-project',
      path: repoPath,
      status: 'registered',
      registeredAt: '2026-09-28T00:00:00.000Z',
    }]));

    const worktree = (await createEngineerWorktree(repoPath, 'jira writeback')).worktreePath;
    await Promise.all(['specs', 'stories', 'plans', 'coherence'].map((directory) => mkdir(join(worktree, '.docs', directory), { recursive: true })));
    await writeFile(join(worktree, '.docs', 'specs', 'jira-writeback.md'), '# PRD: Jira writeback\n\nApproved.\n');
    await writeFile(join(worktree, '.docs', 'stories', 'jira-writeback.md'), [
      '# Stories: Jira writeback', '', '**Status:** Accepted', '', '## Story 1: Jira writeback',
      '### Acceptance Criteria', '#### Happy Path', '- Given X, when Y, then Z.', '',
      '#### Negative Paths', '- Given invalid input, when Y, then it is refused.', '',
    ].join('\n'));
    await writeFile(join(worktree, '.docs', 'plans', 'jira-writeback.md'), [
      '# Implementation Plan: Jira writeback', '', '**Stories:** .docs/stories/jira-writeback.md', '',
      '### Task 1: Route Jira write-backs', '', '**Story:** 1', '', '**Done when:**', '- Jira write-backs are no-ops.', '- The ledger advances after the no-op.', '',
      '## Task Dependency Graph', '```', '1', '```', '',
    ].join('\n'));
    await writeFile(join(worktree, '.docs', 'coherence', 'jira-writeback.md'), [
      '# Coherence: Jira writeback', '', 'Track: technical', 'Tier: M', 'Verdict: covered', '',
      '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |',
      '| --- | --- | --- | --- | --- |',
      '| story | story-1 | task-1 | covered | Jira writeback |',
      '| task | task-1 | story-1 | covered | Jira write-backs are no-ops. |', '',
      '## Criterion mapping', '',
      '| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |',
      '| --- | --- | --- | --- | --- | --- |',
      '| criterion | Story 1 happy: Given X, when Y, then Z. | task-1 | covered | Jira write-backs are no-ops. | diff-local |',
      '| criterion | Story 1 negative: Given invalid input, when Y, then it is refused. | task-1 | covered | The ledger advances after the no-op. | diff-local |', '',
    ].join('\n'));

    const sourceRef = 'ENG-42';
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef });
    const calls: string[][] = [];
    const events: unknown[] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'test-owner' };
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    const { out, err, opts } = captureOut();
    const fakeHome = join(workDir, 'home');
    await mkdir(join(fakeHome, '.ai-conductor'), { recursive: true });
    await writeFile(join(fakeHome, '.ai-conductor', 'config.yml'), 'spec_owner: test-owner\n');
    const savedHome = process.env.HOME;
    const savedUserConfigDir = process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    process.env.HOME = fakeHome;
    delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    let code: number;
    try {
      code = await dispatchEngineer(
        { kind: 'land', project: 'tracker-project', idea: 'jira writeback', worktree, sourceRef },
        opts({
          gh: gh as DispatchEngineerOpts['gh'],
          events: { emit: async (event) => { events.push(event); } },
        }),
      );
    } finally {
      process.env.HOME = savedHome;
      if (savedUserConfigDir === undefined) delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
      else process.env.AI_CONDUCTOR_USER_CONFIG_DIR = savedUserConfigDir;
    }

    expect(code, err.join('\n')).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ branch: 'spec/jira-writeback' });
    expect(calls).toEqual([]); // no GitHub write-back argv
    expect(events).toEqual([{
      type: 'tracker_backend_unavailable', project: sourceRef, backend: 'jira', reason: 'no-adapter',
    }]);
    expect(await ledger.get('github-issues', sourceRef)).toMatchObject({ status: 'routed' });
    expect((await ledger.get('github-issues', sourceRef))?.writebackPending).toBeUndefined();
  });

  // Covers: task:11
  it('reports a Jira handoff as a successful no-op through the CLI event spine', async () => {
    const repoPath = join(workDir, 'tracker-handoff-project');
    await mkdir(repoPath, { recursive: true });
    const git = async (args: string[], cwd = repoPath) => (await execFile('git', args, { cwd })).stdout.trim();
    await git(['init', '-b', 'main', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(repoPath, 'README.md'), '# tracker project\n');
    await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
    await writeFile(join(repoPath, '.ai-conductor', 'config.yml'), 'tracker:\n  backend: jira\n');
    await git(['add', 'README.md', '.ai-conductor/config.yml']);
    await git(['commit', '-m', 'initial']);
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1,
      name: 'tracker-handoff-project',
      path: repoPath,
      remote: 'https://github.com/acme/tracker-handoff-project.git',
      status: 'registered',
      registeredAt: '2026-09-28T00:00:00.000Z',
    }]));

    const worktree = (await createEngineerWorktree(repoPath, 'jira handoff')).worktreePath;
    await Promise.all(['specs', 'stories', 'plans'].map((directory) => mkdir(join(worktree, '.docs', directory), { recursive: true })));
    await writeFile(join(worktree, '.docs', 'specs', 'jira-handoff.md'), '# PRD: Jira handoff\n\nApproved.\n');
    await writeFile(join(worktree, '.docs', 'stories', 'jira-handoff.md'), [
      '# Stories: Jira handoff', '', '**Status:** Accepted', '', '## Story 1: Jira handoff',
      '### Acceptance Criteria', '#### Happy Path', '- Given X, when Y, then Z.', '',
      '#### Negative Paths', '- Given invalid input, when Y, then it is refused.', '',
    ].join('\n'));
    await writeFile(join(worktree, '.docs', 'plans', 'jira-handoff.md'), [
      '# Implementation Plan: Jira handoff', '', '**Stories:** .docs/stories/jira-handoff.md', '',
      '## Task Dependency Graph', '```', '1', '```', '',
    ].join('\n'));
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
    // A GitHub-shaped ref still resolves through the owning project's Jira
    // selection, rather than falling back to the GitHub write-back adapter.
    const sourceRef = 'acme/tracker-handoff-project#43';
    const prUrl = 'https://github.com/acme/tracker-handoff-project/pull/43';
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});
    const calls: string[][] = [];
    const events: unknown[] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      throw new Error(`unexpected gh write-back call: ${args.join(' ')}`);
    };
    const featureMarker = `.docs/intake/${branch.slice('spec/'.length)}.md`;
    const handoffPublication: NonNullable<HandoffDeps['publication']> = {
      repository: 'acme/tracker-handoff-project',
      remote: {
        cwd: repoPath,
        config: async () => ({ stdout: 'https://github.com/acme/tracker-handoff-project.git' }),
        runRemoteGit: async () => ({ stdout: '', stderr: '' }),
        mutation: {
          provenance: { repository: 'acme/tracker-handoff-project', defaultBranch: 'main', specBranch: branch, featureMarker, publication: 'initial' },
          dependencies: {
            resolveMachineOwner: async () => ({ resolved: true as const, id: 'test-owner' }),
            provenanceDiscovery: { readCommittedRecords: async () => [{ path: featureMarker, content: 'Owner: test-owner\n' }] },
          },
        },
      },
      operations: { async run() { return { created: { repository: 'acme/tracker-handoff-project', kind: 'pull-request' as const, number: 43 } }; } },
    };
    const { out, err, opts } = captureOut();
    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'tracker-handoff-project', branch, worktree, sourceRef },
      opts({
        gh: gh as DispatchEngineerOpts['gh'],
        git: async () => ({ stdout: '', stderr: '' }),
        handoffPublication,
        ensureRunningLaunch: async () => {},
        events: { emit: async (event) => { events.push(event); } },
      }),
    );

    expect(code, err.join('\n')).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ kind: 'pr-opened', url: prUrl });
    const writebackCalls = calls.filter((args) =>
      (args[0] === 'issue' && args[1] === 'comment')
      || (args[0] === 'api' && args.some((arg) => arg.includes('labels[]=engineer:handled'))),
    );
    expect(writebackCalls).toEqual([]); // PR metadata reads are not write-backs
    expect(events).toEqual([{
      type: 'tracker_backend_unavailable', project: 'tracker-handoff-project', backend: 'jira', reason: 'no-adapter',
    }]);
    expect(await ledger.get('github-issues', sourceRef)).toMatchObject({
      status: 'done', prUrl, branch,
    });
    expect((await ledger.get('github-issues', sourceRef))?.writebackPending).toBeUndefined();
  });
});

// Covers: task:2
describe('engineer forget (T23, FR-40)', () => {
  // These cases cover the strict assignment-or-approval path, which applies
  // inside an engine-dispatched daemon session. Operator sessions outside the
  // daemon are covered in github-ownership/13.
  let previousDaemonSession: string | undefined;
  beforeEach(() => {
    previousDaemonSession = process.env.CONDUCT_DAEMON_SESSION;
    process.env.CONDUCT_DAEMON_SESSION = '1';
  });
  afterEach(() => {
    if (previousDaemonSession === undefined) delete process.env.CONDUCT_DAEMON_SESSION;
    else process.env.CONDUCT_DAEMON_SESSION = previousDaemonSession;
  });

  it('comments the resolving ref, closes the issue, then drops its ledger entry and strips the label', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({});
    const confirmations: string[] = [];
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async (prompt) => {
        confirmations.push(prompt.operation);
        return true;
      },
    };
    const { out, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh, githubOperationConfirmation }),
    );
    expect(code).toBe(0);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '1', '-R', 'o/a', '--body', expect.stringContaining('o/a#2')],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'close', '1', '-R', 'o/a'],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled'],
    ]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toMatchObject({
      kind: 'forget', sourceRef: 'o/a#1', found: true, closed: true, resolvedBy: 'o/a#2',
    });
    expect(confirmations).toEqual([]);
  });

  it('authorizes every guarded write before resolving an unassigned issue', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({}, undefined, []);
    const confirmations: Array<{
      operation: string;
      target: GithubIssueTarget;
      writeCount: number;
    }> = [];
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async (prompt) => {
        if (prompt.target.kind !== 'issue') throw new Error(`expected issue target, got ${prompt.target.kind}`);
        confirmations.push({ operation: prompt.operation, target: prompt.target, writeCount: calls.length });
        return true;
      },
    };
    const { out, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh, githubOperationConfirmation, isAttachedTerminal: () => true }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '1', '-R', 'o/a', '--body', expect.stringContaining('o/a#2')],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'close', '1', '-R', 'o/a'],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled'],
    ]);
    expect(confirmations).toEqual([
      { operation: 'intake.issue.comment.create', target: { repository: 'o/a', kind: 'issue', number: 1 }, writeCount: 1 },
      { operation: 'intake.issue.close', target: { repository: 'o/a', kind: 'issue', number: 1 }, writeCount: 3 },
      { operation: 'intake.issue.label.remove', target: { repository: 'o/a', kind: 'issue', number: 1 }, writeCount: 5 },
    ]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(JSON.parse(out[0])).toMatchObject({ closed: true, resolvedBy: 'o/a#2' });
  });

  it('only strips the label and reports closed:false without a resolving ref', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/a#1' }, opts({ gh }));
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toMatchObject({
      kind: 'forget', sourceRef: 'o/a#1', found: true, closed: false,
    });

    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled'],
    ]);
  });

  it('authorizes the label removal before forgetting an unassigned issue', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({}, undefined, []);
    const confirmationWriteCounts: number[] = [];
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async (prompt) => {
        expect(prompt.operation).toBe('intake.issue.label.remove');
        confirmationWriteCounts.push(calls.length);
        return true;
      },
    };
    const { out, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1' },
      opts({ gh, githubOperationConfirmation, isAttachedTerminal: () => true }),
    );

    expect(code).toBe(0);
    expect(confirmationWriteCounts).toEqual([1]);
    expect(calls).toContainEqual(['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled']);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(JSON.parse(out[0])).toMatchObject({ closed: false });
  });

  // Covers: task:3
  it('explains an attached-terminal decline before commenting and retains the ledger entry', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const { gh, calls } = makeGh({}, undefined, []);
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async () => false,
    };
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh, githubOperationConfirmation, isAttachedTerminal: () => true }),
    );

    expect(code).not.toBe(0);
    expect(calls).toEqual([['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees']]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(err.join('\n')).toContain('o/a#1');
    expect(err.join('\n')).toContain('declined');
  });

  // Covers: task:3
  it('explains an attached-terminal decline before closing and retains the ledger entry', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const { gh, calls } = makeGh({}, undefined, []);
    let prompts = 0;
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async () => ++prompts === 1,
    };
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh, githubOperationConfirmation, isAttachedTerminal: () => true }),
    );

    expect(code).not.toBe(0);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '1', '-R', 'o/a', '--body', expect.any(String)],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
    ]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(err.join('\n')).toContain('declined');
    expect(err.join('\n')).toContain('by hand');
    expect(err.join('\n')).toContain('without --resolved-by');
  });

  // Covers: task:3
  it('explains a nonterminal resolution refusal and retains the ledger entry', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const { gh, calls } = makeGh({}, undefined, []);
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh, isAttachedTerminal: () => false }),
    );

    expect(code).not.toBe(0);
    expect(calls).toEqual([['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees']]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(err.join('\n')).toContain('sole assignee');
    expect(err.join('\n')).toContain('interactive terminal');
    expect(err.join('\n')).toContain('rerun the same command');
  });

  // Covers: task:3
  it('warns about a nonterminal label-strip refusal after plain forget', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const { gh, calls } = makeGh({}, undefined, []);
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1' },
      opts({ gh, isAttachedTerminal: () => false }),
    );

    expect(code).toBe(0);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(calls).toEqual([['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees']]);
    expect(err.join('\n')).toContain('label strip failed');
    expect(err.join('\n')).toContain('sole assignee');
    expect(err.join('\n')).toContain('interactive terminal');
  });

  it('refuses the drop when the audit comment is rejected, preserving the ledger entry', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({}, 'comment');
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh }),
    );

    expect(code).not.toBe(0);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '1', '-R', 'o/a', '--body', expect.any(String)],
    ]);
    expect(err.join('\n')).toContain('o/a#1');
    expect(err.join('\n')).toContain('comment rejected');
  });

  it('refuses the drop when close is rejected and gives the manual recovery', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({}, 'close');
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#1', resolvedBy: 'o/a#2' },
      opts({ gh }),
    );

    expect(code).not.toBe(0);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(calls).toEqual([
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '1', '-R', 'o/a', '--body', expect.any(String)],
      ['issue', 'view', '1', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'close', '1', '-R', 'o/a'],
    ]);
    expect(err.join('\n')).toMatch(/close (?:the )?issue by hand/i);
    expect(err.join('\n')).toMatch(/rerun.*without.*--resolved-by/i);
  });

  it('refuses a non-GitHub source ref with the flag before calling the tracker or changing its ledger entry', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'local-intake:42' });
    const ledgerPath = join(engineerDir, 'ledger.json');
    const before = await readFile(ledgerPath, 'utf-8');

    const { gh, calls } = makeGh({});
    const { opts } = captureOut();
    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'local-intake:42', resolvedBy: 'o/a#2' },
      opts({ gh }),
    );

    expect(code).not.toBe(0);
    expect(calls).toHaveLength(0);
    expect(await ledger.known('github-issues', 'local-intake:42')).toBe(true);
    expect(await readFile(ledgerPath, 'utf-8')).toBe(before);
  });

  // Covers: task:4
  it('refuses an absent non-GitHub source ref with the flag before calling the tracker or changing the ledger', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const { gh, calls } = makeGh({});
    const { opts } = captureOut();

    expect(await ledger.known('github-issues', 'local-intake:42')).toBe(false);
    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'local-intake:42', resolvedBy: 'o/a#2' },
      opts({ gh }),
    );

    expect(code).not.toBe(0);
    expect(calls).toHaveLength(0);
    expect(await ledger.known('github-issues', 'local-intake:42')).toBe(false);
  });

  // Covers: task:4
  it('comments and closes a sole-assigned absent ledger entry without changing its ledger or stripping its label', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const ledgerPath = join(engineerDir, 'ledger.json');
    const before = await readFile(ledgerPath, 'utf-8');

    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();
    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#9', resolvedBy: 'o/a#2' },
      opts({ gh }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      ['issue', 'view', '9', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '9', '-R', 'o/a', '--body', expect.stringContaining('o/a#2')],
      ['issue', 'view', '9', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'close', '9', '-R', 'o/a'],
    ]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(await readFile(ledgerPath, 'utf-8')).toBe(before);
    expect(JSON.parse(out[0])).toMatchObject({
      kind: 'forget', sourceRef: 'o/a#9', found: false, removed: false, closed: true, resolvedBy: 'o/a#2',
    });
  });

  // Covers: task:4
  it('authorizes then comments and closes an unassigned absent ledger entry without changing its ledger or stripping its label', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const ledgerPath = join(engineerDir, 'ledger.json');
    const before = await readFile(ledgerPath, 'utf-8');
    const { gh, calls } = makeGh({}, undefined, []);
    const confirmations: string[] = [];
    const githubOperationConfirmation: InteractiveGithubOperationConfirmation = {
      mode: 'interactive',
      confirm: async (prompt) => {
        confirmations.push(prompt.operation);
        return true;
      },
    };
    const { out, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#9', resolvedBy: 'o/a#2' },
      opts({ gh, githubOperationConfirmation, isAttachedTerminal: () => true }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      ['issue', 'view', '9', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'comment', '9', '-R', 'o/a', '--body', expect.stringContaining('o/a#2')],
      ['issue', 'view', '9', '-R', 'o/a', '--json', 'assignees'],
      ['issue', 'close', '9', '-R', 'o/a'],
    ]);
    expect(confirmations).toEqual(['intake.issue.comment.create', 'intake.issue.close']);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(await readFile(ledgerPath, 'utf-8')).toBe(before);
    expect(JSON.parse(out[0])).toMatchObject({
      kind: 'forget', sourceRef: 'o/a#9', found: false, removed: false, closed: true, resolvedBy: 'o/a#2',
    });
  });

  // Covers: task:4
  it('refuses an unassigned absent ledger entry outside an interactive terminal without changing its ledger', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const ledgerPath = join(engineerDir, 'ledger.json');
    const before = await readFile(ledgerPath, 'utf-8');
    const { gh, calls } = makeGh({}, undefined, []);
    const { err, opts } = captureOut();

    const code = await dispatchEngineer(
      { kind: 'forget', sourceRef: 'o/a#9', resolvedBy: 'o/a#2' },
      opts({ gh, isAttachedTerminal: () => false }),
    );

    expect(code).not.toBe(0);
    expect(calls).toEqual([['issue', 'view', '9', '-R', 'o/a', '--json', 'assignees']]);
    expect(await ledger.known('github-issues', 'o/a#1')).toBe(true);
    expect(await readFile(ledgerPath, 'utf-8')).toBe(before);
    expect(err.join('\n')).toContain('sole assignee');
    expect(err.join('\n')).toContain('interactive terminal');
  });

  it('reports found:false for an absent ref without crashing or calling gh', async () => {
    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/z#9' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'forget', sourceRef: 'o/z#9', found: false });
    expect(calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// `conduct-ts engineer claim` — priority-banded ordering (#461, plan Task 9).
//
// Stories: .docs/stories/2026-07-10-priority-banded-intake-claim.md (TR-1..TR-4)
// Design:  .docs/plans/2026-07-10-priority-banded-intake-claim.md
//
// NONE of this feature's production code exists yet — `dispatchEngineer`'s
// `claim` case wires no priority resolver at all today, so `claimUnblocked`
// always drains in pure receivedAt-FIFO order. Every test below drives the
// REAL production entry point (`dispatchEngineer({ kind: 'claim' })` — the
// same seam Flow C2 in dependency-ordered-intake-and-dispatch.test.ts uses)
// against a real file-backed IntakeQueue + Ledger and an injected fake `gh`
// that serves both the blocker (`.../dependencies/blocked_by`) and label
// (`.../issues/<n>`) endpoints the real resolvers call — never a hand-rolled
// queue/resolver fake, per §3b (drive the wired path, not the new unit in
// isolation).
// ─────────────────────────────────────────────────────────────────────────────

describe('engineer claim: priority-banded ordering (#461)', () => {
  /** Fake `gh` runner keyed by `owner/repo#N`, serving both the blocker
   *  endpoint (`createBlockerResolver`) and the label endpoint
   *  (`ghIssueLabelReader`) from the SAME injected function — mirroring how
   *  the real CLI wires one `gh` for both concerns. */
  function createFakeGh(
    fixtures: {
      labels?: Record<string, string[]>;
      blockedBy?: Record<string, unknown[]>;
      notFound?: string[];
      throws?: string[];
    } = {},
  ) {
    const calls: string[][] = [];
    const run = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      const path = args.find((a) => a.startsWith('repos/'));
      if (!path) return { stdout: '[]' };

      const blockedMatch = path.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by$/);
      if (blockedMatch) {
        const key = `${blockedMatch[1]}#${blockedMatch[2]}`;
        return { stdout: JSON.stringify(fixtures.blockedBy?.[key] ?? []) };
      }

      const issueMatch = path.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
      const key = issueMatch ? `${issueMatch[1]}#${issueMatch[2]}` : '';

      if (fixtures.throws?.includes(key)) {
        throw new Error(`transport failure fetching labels for ${key}`);
      }
      if (fixtures.notFound?.includes(key)) {
        const err: any = new Error('HTTP 404: Not Found');
        err.status = 404;
        throw err;
      }
      const names = fixtures.labels?.[key] ?? [];
      return { stdout: JSON.stringify({ labels: names.map((name) => ({ name })) }) };
    };
    return { run, calls };
  }

  const openBlocker = (repo: string, number: number) => ({
    number,
    repository_url: `https://api.github.com/repos/${repo}`,
    state: 'open',
  });

  /** Seed the real file-backed inbox + ledger directly (mirrors Flow C2's
   *  seedInbox), so `dispatchEngineer`'s own `buildIntake` composition root
   *  drives real production wiring end to end. */
  async function seedInbox(
    entries: Array<{ sourceRef: string; receivedAt: string; text: string }>,
  ): Promise<{ queue: ReturnType<typeof createFileQueue>; ledger: ReturnType<typeof createLedger> }> {
    await mkdir(join(engineerDir, 'inbox'), { recursive: true });
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    for (const entry of entries) {
      await ledger.record({ source: 'github-issues', sourceRef: entry.sourceRef });
      await queue.enqueue(
        parseEnvelope({
          id: entry.sourceRef,
          source: 'github-issues',
          sourceRef: entry.sourceRef,
          text: entry.text,
          status: 'pending',
          receivedAt: entry.receivedAt,
        }),
      );
    }
    return { queue, ledger };
  }

  it('TR-1 happy 1: critical (newest) is claimed over low (oldest) — band beats received order', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'low, oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-05T00:00:00.000Z', text: 'critical, newest' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#1': ['priority: low'], 'acme/app#2': ['priority: critical'] },
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    // The low entry is deferred, not dropped — it's still pending afterward.
    const freshQueue = createFileQueue(join(engineerDir, 'inbox'));
    const stillPending = await freshQueue.claim();
    expect(stillPending?.sourceRef).toBe('acme/app#1');
  });

  it('TR-1 happy 2: band drain order across claims — unlabeled/high/medium serves high, then medium', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'unlabeled' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'high' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-03T00:00:00.000Z', text: 'medium' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#2': ['priority: high'], 'acme/app#3': ['priority: medium'] },
    });
    const { out, opts } = captureOut();

    const code1 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code1).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    out.length = 0;
    const code2 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code2).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#3' });
  });

  it('TR-1 neg 1: a 404 (deleted) issue bands as unlabeled — not an error, ordering still proceeds', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'deleted issue' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'medium' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#2': ['priority: medium'] },
      notFound: ['acme/app#1'],
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    // medium outranks unlabeled — the 404'd entry never wins by being skipped
    // past the banding step entirely.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });
  });

  it('TR-1 happy 3: a relabel after capture is honored on the NEXT claim — no cache from a prior claim', async () => {
    // Round 1: A(medium) and C(medium) tie the band, A wins on FIFO (oldest).
    // B(low) loses to both and stays pending.
    // B is chronologically the NEWEST of the three — plain FIFO (ignoring
    // bands entirely) would serve C, not B, in round 2. Only honoring B's
    // fresh critical label makes B win, so this discriminates a stale/cached
    // band from a claim-time read.
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'A: medium, oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-03T00:00:00.000Z', text: 'B: low, then relabeled critical' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-02T00:00:00.000Z', text: 'C: medium, middle' },
    ]);
    const labels: Record<string, string[]> = {
      'acme/app#1': ['priority: medium'],
      'acme/app#2': ['priority: low'],
      'acme/app#3': ['priority: medium'],
    };
    const { run } = createFakeGh({ labels });
    const { out, opts } = captureOut();

    const code1 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code1).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });

    // Operator relabels B to critical from their phone, between claims.
    labels['acme/app#2'] = ['priority: critical'];

    out.length = 0;
    const code2 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code2).toBe(0);
    // If the label read were cached from claim 1, B would still be 'low' and C
    // (medium) would win. Honoring the new label means B wins instead.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });
  });

  it('TR-2 happy + neg 2: a label-read outage falls open to FIFO, still acks + transitions the ledger, and logs exactly one warning', async () => {
    const { ledger } = await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'newest, would win if banded' },
    ]);
    const { run } = createFakeGh({ throws: ['acme/app#1', 'acme/app#2'] });
    const { out, err, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    // Pure FIFO on outage — the oldest wins, regardless of what labels would
    // have said had the reader not failed.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });

    // Fallback side effects are identical to the banded path: ack + ledger
    // 'claimed' transition still happened.
    expect((await ledger.get('github-issues', 'acme/app#1'))?.status).toBe('claimed');

    const warnings = err.filter((l) => /priority|outage|label/i.test(l));
    expect(warnings.length).toBe(1);
  });

  it('TR-2 neg 1: reader throws on the 2nd of 3 refs (partial success before the throw) — order is still pure FIFO, never half-banded', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'middle, throws' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-03T00:00:00.000Z', text: 'newest' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#1': ['priority: low'] },
      throws: ['acme/app#2'],
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });
  });

  it('TR-4 happy 1: banding composes with blocker deferral — a blocked critical defers, the unblocked high is claimed', async () => {
    // The blocked entry is also the chronologically oldest, so a claim that
    // ONLY deferred blockers (no banding at all) would coincidentally land on
    // the same winner. The real discriminator is that the label endpoint must
    // actually have been consulted — proof the banded walk, not luck of
    // ordering, is what ran.
    const { ledger } = await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'critical, blocked' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'high, unblocked' },
    ]);
    const { run, calls } = createFakeGh({
      labels: { 'acme/app#1': ['priority: critical'], 'acme/app#2': ['priority: high'] },
      blockedBy: { 'acme/app#1': [openBlocker('acme/app', 9)] },
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    // Deferral is stateless — the blocked critical's ledger status is untouched.
    expect((await ledger.get('github-issues', 'acme/app#1'))?.status).toBe('pending');

    // The banded walk actually read labels — not just deferral-by-luck.
    const labelCalls = calls.filter((c) => c.some((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a)));
    expect(labelCalls.length).toBeGreaterThan(0);
  });
});
