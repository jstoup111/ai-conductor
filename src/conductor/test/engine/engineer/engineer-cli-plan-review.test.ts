// Covers: task:15, remediation:31729538-c8e3-4af5-9737-d147a44a7500
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { parsePlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const argv = (...rest: string[]) => ['node', 'conduct-ts', 'compose', ...rest];

async function paths(root: string, at = root): Promise<string[]> {
  const entries = await readdir(at, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? paths(root, join(at, entry.name))
    : [relative(root, join(at, entry.name))]))).flat().sort();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'engineer-cli-plan-review-')); roots.push(root);
  const canonical = join(root, 'canonical'); const worktree = join(root, 'engineer-active-feature');
  for (const dir of [canonical, worktree]) {
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    const stem = dir === worktree ? 'active-feature' : basename(dir);
    await writeFile(join(dir, '.docs', 'plans', `${stem}.md`), '# Plan\n\n### Task 1: Review\n**Done when:**\n- review runs\n\n**Dependencies:** none\n', 'utf8');
    await writeFile(join(dir, '.docs', 'stories', `${stem}.md`), '# Stories\n\n## Story 1: Review\n', 'utf8');
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(join(dir, '.ai-conductor', 'config.yml'), 'llm_provider:\n  - claude\n  - codex\n', 'utf8');
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test']);
    await execFileAsync('git', ['-C', dir, 'add', '.']);
    await execFileAsync('git', ['-C', dir, 'commit', '-m', 'baseline']);
    if (dir === worktree) await execFileAsync('git', ['-C', dir, 'checkout', '-b', 'spec/active-feature']);
  }
  const registryPath = join(root, 'registry.json');
  await writeFile(registryPath, JSON.stringify([{ schemaVersion: 1, name: 'alpha', path: canonical, status: 'registered', registeredAt: '2026-10-13T00:00:00.000Z' }]));
  return { canonical, worktree, registryPath };
}

describe('compose plan-review command surface', () => {
  it('parses run and disposition forms and rejects unknown flags', () => {
    expect(detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', '/tmp/feature')))
      .toEqual({ kind: 'plan-review', project: 'alpha', worktree: '/tmp/feature' });
    expect(detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', '/tmp/feature', '--source-ref', 'acme/app#7')))
      .toMatchObject({ kind: 'plan-review', sourceRef: 'acme/app#7' });
    expect(detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', '/tmp/feature', '--accept', 'F-1', '--reason', 'intentional')))
      .toMatchObject({ kind: 'plan-review', accept: 'F-1', reason: 'intentional' });
    expect(detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', '/tmp/feature', '--acknowledge', '--reason', 'reviewed')))
      .toMatchObject({ kind: 'plan-review', acknowledge: true, reason: 'reviewed' });
    expect(detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', '/tmp/feature', '--unknown')))
      .toEqual({ kind: 'reject', sub: 'plan-review', flag: '--unknown' });
  });

  it('selects the active feature plan despite historical plans, writes a clean cross-provider review, and persists lifecycle events', async () => {
    const { canonical, worktree, registryPath } = await fixture(); const out: string[] = []; const calls: any[] = [];
    await writeFile(join(worktree, '.docs', 'plans', 'historical.md'), '# Historical plan\n', 'utf8');
    const before = await paths(worktree);
    const command = detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', worktree))!;
    await expect(dispatchEngineer(command, {
      registryPath, print: (line) => out.push(line), printErr: (line) => { throw new Error(line); },
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }), env: { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' },
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    })).resolves.toBe(0);
    expect(calls.map((call) => call.configuredProviders[0])).toEqual(['codex']);
    expect(out).toEqual(['plan review clean']);
    expect(await paths(worktree)).toEqual([...before, '.docs/plan-review/active-feature.md'].sort());
    expect(parsePlanReviewArtifact(await readFile(join(worktree, '.docs/plan-review/active-feature.md'), 'utf8')))
      .toMatchObject({ authoringHost: 'claude', reviewerProvider: 'codex', independence: 'cross-provider' });
    const events = (await readFile(join(canonical, '.pipeline', 'composer-events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['plan_review_dispatched', 'plan_review_completed']);
  });

  it.each([
    ['same-provider', { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }],
    ['unknown-host', {}],
  ] as const)('reports a one-line %s independence notice to the compose operator', async (independence, env) => {
    const { worktree, registryPath } = await fixture(); const errors: string[] = [];
    await writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'llm_provider: claude\n', 'utf8');
    const command = detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', worktree))!;

    await expect(dispatchEngineer(command, {
      registryPath, printErr: (line) => errors.push(line),
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }), env,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    })).resolves.toBe(0);

    expect(errors).toEqual([expect.stringContaining(`plan review independence: ${independence}`)]);
    expect(parsePlanReviewArtifact(await readFile(join(worktree, '.docs/plan-review/active-feature.md'), 'utf8')))
      .toMatchObject({ independence });
  });

  it('keeps the review artifact when completion-event persistence fails', async () => {
    const { canonical, worktree, registryPath } = await fixture(); const errors: string[] = [];
    const command = detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', worktree))!;
    const code = await dispatchEngineer(command, {
      registryPath, printErr: (line) => errors.push(line), probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerExecutor: (async () => {
        await rm(join(canonical, '.pipeline'), { recursive: true, force: true });
        await writeFile(join(canonical, '.pipeline'), 'not a directory', 'utf8');
        return { success: true, finalStructuredResult: { findings: [] } };
      }) as any,
    });
    expect(code).toBe(0);
    await expect(readFile(join(worktree, '.docs/plan-review/active-feature.md'), 'utf8')).resolves.toContain('reviewerProvider');
    expect(errors.join('\n')).toContain('event ledger write failed');
  });

  it('keeps the review artifact when the event ledger is unwritable before dispatch', async () => {
    const { canonical, worktree, registryPath } = await fixture(); const errors: string[] = [];
    const calls: unknown[] = [];
    await writeFile(join(canonical, '.pipeline'), 'not a directory', 'utf8');
    const command = detectEngineerCommand(argv('plan-review', '--project', 'alpha', '--worktree', worktree))!;
    const code = await dispatchEngineer(command, {
      registryPath, printErr: (line) => errors.push(line), probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerExecutor: (async (input: unknown) => {
        calls.push(input);
        return { success: true, finalStructuredResult: { findings: [] } };
      }) as any,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    await expect(readFile(join(worktree, '.docs/plan-review/active-feature.md'), 'utf8')).resolves.toContain('reviewerProvider');
    expect(errors.join('\n')).toContain('event ledger write failed');
  });
});
