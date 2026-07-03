// End-to-end intake integration (Phase 9.3b, T26 + T29).
//
// T26 cross-repo isolation: an idea captured from repo A's issue, routed to repo
//   B, must produce a spec branch ONLY in B — A and C stay byte-for-byte unchanged.
// T29 lifecycle: poll → enqueue → process (route+author+spec PR) → write-back done
//   (comment + label) + ledger done → re-poll is a no-op (labeled+ledgered) →
//   spec PR closes unmerged → re-poll reopens.
//
// One shared fake `gh` serves both the adapter (poll/report) and the loop (pr create).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { runEngineerMode } from '../../../../src/engine/engineer/loop.js';
import { createGithubIssuesAdapter } from '../../../../src/engine/engineer/intake/github-issues.js';
import { createFileQueue } from '../../../../src/engine/engineer/intake/queue.js';
import { createLedger } from '../../../../src/engine/engineer/intake/ledger.js';

const exec = promisify(execFileCb);

// ── shared fake gh ─────────────────────────────────────────────────────────────

interface GhState {
  issuesByRepo: Record<string, Array<{ number: number; title: string; body: string }>>;
  appliedLabels: Map<string, Set<string>>; // ref -> labels
  comments: Array<{ ref: string; body: string }>;
  prs: Record<string, { state: 'OPEN' | 'CLOSED' | 'MERGED'; mergedAt: string | null }>;
  prCreateUrl: string;
}

function ref(repo: string, num: string | number) {
  return `${repo}#${num}`;
}

function makeFullGh(state: GhState) {
  const calls: string[][] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push(args);
    const rIdx = args.indexOf('-R');
    const repo = rIdx >= 0 ? args[rIdx + 1] : opts.cwd.split('/').slice(-2).join('/');

    if (args[0] === 'issue' && args[1] === 'list') {
      const issues = state.issuesByRepo[repo] ?? [];
      return {
        stdout: JSON.stringify(
          issues.map((i) => {
            const labels = [...(state.appliedLabels.get(ref(repo, i.number)) ?? [])];
            return { number: i.number, title: i.title, body: i.body, labels: labels.map((l) => ({ name: l })) };
          }),
        ),
      };
    }
    if (args[0] === 'issue' && args[1] === 'comment') {
      const bi = args.indexOf('--body');
      state.comments.push({ ref: ref(repo, args[2]), body: bi >= 0 ? args[bi + 1] : '' });
      return { stdout: '' };
    }
    // Owner-identity resolution (fail-closed slice B): resolve a login.
    if (args[0] === 'api' && args[1] === 'user') return { stdout: 'test-owner\n' };
    // REST label mutation: `gh api --method POST|DELETE repos/<repo>/issues/<n>/labels[/<name>]`
    if (args[0] === 'api' && /\/issues\/\d+\/labels/.test(args[3] ?? '')) {
      const pm = (args[3] ?? '').match(
        /repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/labels(?:\/(.+))?$/,
      );
      if (pm) {
        const r = ref(pm[1], pm[2]);
        const set = state.appliedLabels.get(r) ?? new Set<string>();
        const mi = args.indexOf('--method');
        const method = mi >= 0 ? args[mi + 1] : '';
        if (method === 'POST') {
          const fi = args.indexOf('-f');
          const label = fi >= 0 ? (args[fi + 1] ?? '').replace(/^labels\[\]=/, '') : '';
          if (label) set.add(label);
        } else if (method === 'DELETE') {
          set.delete(decodeURIComponent(pm[3] ?? ''));
        }
        state.appliedLabels.set(r, set);
      }
      return { stdout: '' };
    }
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '' };
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = state.prs[args[2]];
      if (!pr) {
        const e: any = new Error('no pr');
        e.code = 1;
        throw e;
      }
      return { stdout: JSON.stringify(pr) };
    }
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: state.prCreateUrl };
    return { stdout: '' };
  };
  return { gh, calls };
}

// ── route provider + decide + git scaffolding ─────────────────────────────────

function routeTo(name: string) {
  return { invoke: async () => JSON.stringify([{ name, score: 0.9, rationale: 'match' }]) };
}

function decideStub() {
  return async (ctx: { step: 'brainstorm' | 'stories' | 'plan'; idea: string }) => {
    if (ctx.step === 'brainstorm') return { approved: true, artifact: `# PRD: ${ctx.idea}\nOk.\n` };
    if (ctx.step === 'stories')
      return { approved: true, artifact: `# Stories\n\n**Status:** Accepted\n\n## S\n### AC\n- Given a, when b, then c.\n` };
    return { approved: true, artifact: `# Plan\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n\`\`\`\n1\n\`\`\`\n` };
  };
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  await exec('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
  await exec('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
  await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
}

async function specBranches(dir: string): Promise<string> {
  return (await exec('git', ['branch', '--list', 'spec/*'], { cwd: dir })).stdout.trim();
}

// ── scaffolding ───────────────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};
let repos: Record<string, string>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'intake-life-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  repos = { 'o/a': join(workDir, 'a'), 'o/b': join(workDir, 'b'), 'o/c': join(workDir, 'c') };
  for (const p of Object.values(repos)) await initRepo(p);
  await writeFile(
    registryPath,
    JSON.stringify(
      Object.entries(repos).map(([name, path]) => ({
        schemaVersion: 1,
        name,
        path,
        remote: 'https://example.invalid/x.git',
        status: 'registered',
        registeredAt: '2026-06-27T00:00:00.000Z',
      })),
      null,
      2,
    ),
  );
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir, { recursive: true, force: true });
});

function buildIntake(state: GhState) {
  const { gh, calls } = makeFullGh(state);
  const ledger = createLedger(join(engineerDir, 'ledger.json'));
  const queue = createFileQueue(join(engineerDir, 'inbox'));
  const adapter = createGithubIssuesAdapter({
    gh,
    registry: { list: async () => Object.entries(repos).map(([name, path]) => ({ name, path })) },
    ledger,
  });
  return { gh, calls, ledger, queue, adapter };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('T26 cross-repo isolation through the full route-to-target path', () => {
  it('issue in repo A routed to B → spec branch in B only; A and C untouched', async () => {
    const state: GhState = {
      issuesByRepo: { 'o/a': [{ number: 1, title: 'Add export', body: 'csv please' }] },
      appliedLabels: new Map(),
      comments: [],
      prs: {},
      prCreateUrl: 'https://example.invalid/o/b/pull/5',
    };
    const { gh, adapter, queue, ledger } = buildIntake(state);

    const io = (() => {
      const lines = ['y', 'exit']; // confirm routing to B, then exit
      return { prompt: async () => (lines.length ? lines.shift()! : null), print: () => {} };
    })();

    await runEngineerMode({
      route: routeTo('o/b'),
      io,
      gh,
      decide: decideStub(),
      engineerDir,
      sources: [adapter],
      queue,
      intakePort: adapter,
      ledger,
    });

    // Spec branch landed in B only.
    expect(await specBranches(repos['o/b'])).toMatch(/spec\//);
    expect(await specBranches(repos['o/a'])).toBe('');
    expect(await specBranches(repos['o/c'])).toBe('');

    // Repo C's working tree only holds the initial README (no intake artifacts leaked).
    expect((await readdir(repos['o/c'])).sort()).toEqual(['.git', 'README.md']);
  });
});

describe('T29 full lifecycle: capture → done → re-poll no-op → reopen', () => {
  it('processes the issue, writes back done+label, dedups on re-poll, reopens on closed-unmerged PR', async () => {
    const state: GhState = {
      issuesByRepo: { 'o/b': [{ number: 1, title: 'Lifecycle idea', body: 'do the thing' }] },
      appliedLabels: new Map(),
      comments: [],
      prs: {},
      prCreateUrl: 'https://example.invalid/o/b/pull/9',
    };
    const { gh, adapter, queue, ledger } = buildIntake(state);

    const io = (() => {
      const lines = ['y', 'exit'];
      return { prompt: async () => (lines.length ? lines.shift()! : null), print: () => {} };
    })();

    // 1. Launch → poll, process the one issue, write back.
    await runEngineerMode({
      route: routeTo('o/b'),
      io,
      gh,
      decide: decideStub(),
      engineerDir,
      sources: [adapter],
      queue,
      intakePort: adapter,
      ledger,
    });

    // done write-back: comment + label + ledger done.
    expect(state.comments.some((c) => /Spec PR opened/.test(c.body))).toBe(true);
    expect(state.appliedLabels.get('o/b#1')?.has('engineer:handled')).toBe(true);
    const doneEntry = await ledger.get('github-issues', 'o/b#1');
    expect(doneEntry?.status).toBe('done');
    expect(doneEntry?.prUrl).toBe('https://example.invalid/o/b/pull/9');

    // 2. Re-poll: labeled + ledgered → no new envelope.
    expect(await adapter.poll()).toEqual([]);

    // 3. Spec PR closes unmerged → re-poll reopens the issue.
    state.prs['https://example.invalid/o/b/pull/9'] = { state: 'CLOSED', mergedAt: null };
    const reopened = await adapter.poll();
    expect(reopened.map((e) => e.sourceRef)).toEqual(['o/b#1']);
    // The handled label was stripped as part of reopen.
    expect(state.appliedLabels.get('o/b#1')?.has('engineer:handled')).toBe(false);
  });
});
