// Task 8: CLI regression — handoff with failing write-back stays a successful
// handoff (#290).
//
// Contract (plan Task 8 AC):
// 1. `dispatchEngineer({kind:'handoff', sourceRef})` where `pr create` succeeds but
//    the subsequent write-back gh calls (issue comment / label) fail: exit code 0,
//    stdout is unchanged (`{ "kind": "pr-opened", "url": ... }`), stderr contains
//    the remediation command(s), and the ledger entry is `done` + `prUrl` +
//    `writebackPending: true`.
// 2. All-success companion: no remediation text on stderr, no `writebackPending`
//    flag, and the GhRunner call count matches the pre-fix expectation (FR-38
//    de-dup unchanged: `pr create` + 3 write-back calls, no more on a would-be
//    retry within the same process).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

const execFile = promisify(execFileCb);

const ACCEPTED_STORIES = [
  '# Stories: test',
  '',
  '**Status:** Accepted',
  '',
  '## Story: test feature',
  '### Acceptance Criteria',
  '- Given X, when Y, then Z.',
  '',
].join('\n');

const PLAN_WITH_DEPS = [
  '# Implementation Plan: test',
  '',
  '**Stories:** .docs/stories/test.md',
  '',
  '## Task Dependency Graph',
  '```',
  '1 → 2',
  '```',
  '',
].join('\n');

let workDir: string;
let registryPath: string;
let engineerDir: string;
let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function seedWorktree(): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, 'test feature');
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, '.docs', 'specs', 'test.md'), '# PRD: test\n\nApproved.\n');
  await writeFile(join(dir, '.docs', 'stories', 'test.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs', 'plans', 'test.md'), PLAN_WITH_DEPS);
  return dir;
}

async function writeRegistry(): Promise<void> {
  const records = [
    {
      schemaVersion: 1,
      name: 'test-proj',
      path: repoPath,
      status: 'registered',
      registeredAt: '2026-07-04T00:00:00.000Z',
    },
  ];
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function captureOpts(extra: Partial<DispatchEngineerOpts>): {
  out: string[];
  err: string[];
  opts: DispatchEngineerOpts;
} {
  const out: string[] = [];
  const err: string[] = [];
  const opts: DispatchEngineerOpts = {
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  };
  return { out, err, opts };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-handoff-writeback-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  repoPath = join(workDir, 'test-proj');
  await mkdir(engineerDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  await writeRegistry();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer handoff — write-back failure is visible, non-fatal, deduped (Task 8, #290)', () => {
  it('pr-opened + write-back comment fails → exit 0, unchanged stdout, remediation on stderr, ledger done+prUrl+writebackPending:true', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/e#200';
    const PR_URL = 'https://github.com/o/e/pull/999';

    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: `Opening pull request...\n${PR_URL}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        return { stdout: '' };
      }
      if (args[0] === 'issue' && args[1] === 'comment') {
        throw new Error('gh: failed to comment on issue (403 Forbidden)');
      }
      return { stdout: JSON.stringify({}) };
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'test-proj', branch, worktree, sourceRef },
      opts,
    );

    // Exit code 0 — write-back failure is non-fatal.
    expect(code).toBe(0);

    // stdout unchanged: exactly one line, the pr-opened envelope.
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ kind: 'pr-opened', url: PR_URL });

    // stderr contains the remediation command (copy/paste-retryable).
    const stderrText = err.join('\n');
    expect(stderrText).toMatch(/gh issue comment 200 --repo o\/e --body/);

    // Ledger reflects done + prUrl + writebackPending:true.
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    expect(afterHandoff?.status).toBe('done');
    expect(afterHandoff?.prUrl).toBe(PR_URL);
    expect(afterHandoff?.writebackPending).toBe(true);
  });

  it('all-success path: no remediation on stderr, no writebackPending flag, expected GhRunner call count (FR-38 de-dup unchanged)', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/e#201';
    const PR_URL = 'https://github.com/o/e/pull/1000';

    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: `Opening pull request...\n${PR_URL}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        return { stdout: '' };
      }
      // issue comment / label create / REST label-add all succeed.
      return { stdout: JSON.stringify({}) };
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'test-proj', branch, worktree, sourceRef },
      opts,
    );

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ kind: 'pr-opened', url: PR_URL });

    // No remediation / write-back failure text on stderr.
    const stderrText = err.join('\n');
    expect(stderrText).not.toMatch(/write-back failed/i);
    expect(stderrText).not.toMatch(/retry manually/i);

    // Ledger reflects done + prUrl, and writebackPending is cleared (not left set).
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    expect(afterHandoff?.status).toBe('done');
    expect(afterHandoff?.prUrl).toBe(PR_URL);
    expect(afterHandoff?.writebackPending).toBeUndefined();

    // GhRunner call count: pr create (+ any auxiliary openSpecPr calls) + the
    // three write-back calls (issue comment, label create, REST label-add).
    const writebackCalls = calls.filter(
      (c) =>
        (c[0] === 'issue' && c[1] === 'comment') ||
        (c[0] === 'label' && c[1] === 'create') ||
        (c[0] === 'api' && c.some((a) => a.includes('labels'))),
    );
    expect(writebackCalls).toHaveLength(3);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(true);
  });
});
