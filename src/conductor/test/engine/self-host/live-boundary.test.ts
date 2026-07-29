import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fingerprintLiveBoundary, verifyLiveBoundary } from '../../../src/engine/self-host/live-boundary.js';

const execFileAsync = promisify(execFile);

describe('live self-host boundary', () => {
  it('accepts an operator edit to a tracked live-checkout file during the build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-tracked-edit-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
    await writeFile(join(live, 'README.md'), 'before');
    await execFileAsync('git', ['add', 'README.md'], { cwd: live });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(live, 'README.md'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts an operator deletion of a tracked live-checkout file during the build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-tracked-delete-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
    await writeFile(join(live, 'obsolete.md'), 'tracked');
    await execFileAsync('git', ['add', 'obsolete.md'], { cwd: live });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await rm(join(live, 'obsolete.md'));
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts operator edits when every changed live-checkout file is tracked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-tracked-edits-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
    await Promise.all([
      writeFile(join(live, 'README.md'), 'before'),
      writeFile(join(live, 'CHANGELOG.md'), 'before'),
    ]);
    await execFileAsync('git', ['add', 'README.md', 'CHANGELOG.md'], { cwd: live });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await Promise.all([
      writeFile(join(live, 'README.md'), 'after'),
      writeFile(join(live, 'CHANGELOG.md'), 'after'),
    ]);
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('allows only the approved staged and mixed Git statuses', async () => {
    const cases: ReadonlyArray<{
      label: string;
      mutate: (live: string) => Promise<void>;
      expectedOk: boolean;
    }> = [
      {
        label: 'staged modification (M )',
        mutate: async live => {
          await writeFile(join(live, 'README.md'), 'staged');
          await execFileAsync('git', ['add', 'README.md'], { cwd: live });
        },
        expectedOk: true,
      },
      {
        label: 'staged deletion (D )',
        mutate: async live => {
          await rm(join(live, 'README.md'));
          await execFileAsync('git', ['add', '-A'], { cwd: live });
        },
        expectedOk: true,
      },
      {
        label: 'index and working-tree modification (MM)',
        mutate: async live => {
          await writeFile(join(live, 'README.md'), 'staged');
          await execFileAsync('git', ['add', 'README.md'], { cwd: live });
          await writeFile(join(live, 'README.md'), 'staged then modified');
        },
        expectedOk: true,
      },
      {
        label: 'unexpected staged addition (A )',
        mutate: async live => {
          await writeFile(join(live, 'added.txt'), 'staged addition');
          await execFileAsync('git', ['add', 'added.txt'], { cwd: live });
        },
        expectedOk: false,
      },
    ];
    for (const testCase of cases) {
      const root = await mkdtemp(join(tmpdir(), 'live-boundary-git-status-'));
      const live = join(root, 'live'); const provider = join(root, 'provider');
      await Promise.all([mkdir(live), mkdir(provider)]);
      await execFileAsync('git', ['init'], { cwd: live });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
      await writeFile(join(live, 'README.md'), 'before');
      await execFileAsync('git', ['add', 'README.md'], { cwd: live });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
      const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
      await testCase.mutate(live);
      try {
        expect(await verifyLiveBoundary(baseline), testCase.label).toMatchObject({ ok: testCase.expectedOk });
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  it('rejects mixed tracked edits and untracked live-checkout additions with the untracked path named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-mixed-edits-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
    await writeFile(join(live, 'README.md'), 'before');
    await execFileAsync('git', ['add', 'README.md'], { cwd: live });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await Promise.all([
      writeFile(join(live, 'README.md'), 'after'),
      writeFile(join(live, 'untracked.txt'), 'unexplained'),
    ]);
    try {
      expect(await verifyLiveBoundary(baseline)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('added untracked.txt'),
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects an untracked live-checkout addition with its path named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-untracked-addition-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(live, 'escaped.txt'), 'untracked');
    try {
      expect(await verifyLiveBoundary(baseline)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('added escaped.txt'),
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('fails closed when Git classification cannot inspect the live checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-git-failure-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await execFileAsync('git', ['init'], { cwd: live });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: live });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: live });
    await writeFile(join(live, 'README.md'), 'before');
    await execFileAsync('git', ['add', 'README.md'], { cwd: live });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: live });
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await rm(join(live, '.git'), { recursive: true });
    await writeFile(join(live, 'README.md'), 'after');
    try {
      expect(await verifyLiveBoundary(baseline)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('changed README.md'),
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts a feature-worktree mutation while live checkout and unrelated provider state remain identical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-'));
    const live = join(root, 'live'); const worktree = join(root, 'worktree'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(worktree), mkdir(provider)]);
    await writeFile(join(live, 'sentinel'), 'live'); await writeFile(join(provider, 'preferences'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(worktree, 'feature-change'), 'allowed');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects terminal success when either live surface drifts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-drift-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await writeFile(join(live, 'sentinel'), 'before'); await writeFile(join(provider, 'preferences'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(live, 'sentinel'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('ignores the harness bookkeeping it writes itself during the run (#985)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-bookkeeping-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(join(live, '.git', 'refs'), { recursive: true }),
      mkdir(join(live, '.daemon'), { recursive: true }),
      mkdir(join(live, '.worktrees', 'feature'), { recursive: true }),
      mkdir(provider),
    ]);
    await writeFile(join(live, 'sentinel'), 'harness source');
    await writeFile(join(live, '.git', 'refs', 'head'), 'before');
    await writeFile(join(live, '.daemon', 'daemon.log'), 'before');
    await writeFile(join(live, '.worktrees', 'feature', 'file.ts'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    // Every write below is the harness mutating its own runtime state.
    await writeFile(join(live, '.git', 'refs', 'head'), 'after');
    await writeFile(join(live, '.git', 'ORIG_HEAD'), 'new file');
    await writeFile(join(live, '.daemon', 'daemon.log'), 'appended log line');
    await writeFile(join(live, '.worktrees', 'feature', 'file.ts'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('ignores live-checkout pipeline state and agent worktrees (#985)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-nested-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(join(live, '.pipeline', 'gates'), { recursive: true }),
      mkdir(join(live, '.claude', 'worktrees', 'agent-abc'), { recursive: true }),
      mkdir(provider),
    ]);
    await writeFile(join(live, 'sentinel'), 'harness source');
    // .claude itself stays fingerprinted — only the worktrees subtree is volatile.
    await writeFile(join(live, '.claude', 'settings.json'), '{"permissions":{}}');
    await writeFile(join(live, '.pipeline', '.memory-count-at-start'), 'before');
    await writeFile(join(live, '.pipeline', 'gates', 'verdict.json'), 'before');
    await writeFile(join(live, '.claude', 'worktrees', 'agent-abc', 'file.ts'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    // Every write below is the harness mutating its own runtime state.
    await writeFile(join(live, '.pipeline', '.memory-count-at-start'), 'after');
    await writeFile(join(live, '.pipeline', 'gates', 'verdict.json'), 'after');
    await writeFile(join(live, '.pipeline', 'task-evidence.json'), 'new file');
    await writeFile(join(live, '.claude', 'worktrees', 'agent-abc', 'file.ts'), 'after');
    await mkdir(join(live, '.claude', 'worktrees', 'agent-new'), { recursive: true });
    await writeFile(join(live, '.claude', 'worktrees', 'agent-new', 'file.ts'), 'new worktree');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still trips on .claude harness state beside the excluded worktrees subtree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-claude-state-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(join(live, '.claude', 'worktrees', 'agent-abc'), { recursive: true }),
      mkdir(join(live, '.claude', 'hooks'), { recursive: true }),
      mkdir(provider),
    ]);
    await writeFile(join(live, '.claude', 'settings.json'), 'before');
    await writeFile(join(live, '.claude', 'hooks', 'guard.sh'), 'before');
    await writeFile(join(live, '.claude', 'worktrees', 'agent-abc', 'file.ts'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(live, '.claude', 'worktrees', 'agent-abc', 'file.ts'), 'churn');
    await writeFile(join(live, '.claude', 'settings.json'), 'after');
    try {
      expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false });
      await writeFile(join(live, '.claude', 'settings.json'), 'before');
      await writeFile(join(live, '.claude', 'hooks', 'guard.sh'), 'after');
      expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still rejects real harness-source mutation beside the excluded paths', async () => {
    const cases: ReadonlyArray<readonly [string, (live: string) => Promise<void>]> = [
      ['modified', async live => { await writeFile(join(live, 'src', 'engine.ts'), 'after'); }],
      ['added', async live => { await writeFile(join(live, 'src', 'extra.ts'), 'new'); }],
      ['deleted', async live => { await rm(join(live, 'src', 'engine.ts')); }],
    ];
    for (const [label, mutate] of cases) {
      const root = await mkdtemp(join(tmpdir(), `live-boundary-source-${label}-`));
      const live = join(root, 'live'); const provider = join(root, 'provider');
      await Promise.all([
        mkdir(join(live, 'src'), { recursive: true }),
        mkdir(join(live, '.git'), { recursive: true }),
        mkdir(provider),
      ]);
      await writeFile(join(live, 'src', 'engine.ts'), 'before');
      const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
      await writeFile(join(live, '.git', 'index'), 'churn');
      await mutate(live);
      try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  it('excludes a nested provider-state path by prefix without excluding its lookalikes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-provider-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(join(provider, 'auth'), { recursive: true })]);
    await writeFile(join(provider, 'auth', 'token.json'), 'before');
    await writeFile(join(provider, 'auth-notes'), 'before');
    const baseline = await fingerprintLiveBoundary({
      liveCheckout: live, unrelatedProviderState: provider, selectedAuthPaths: ['auth'],
    });
    await writeFile(join(provider, 'auth', 'token.json'), 'refreshed');
    try {
      expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true });
      await writeFile(join(provider, 'auth-notes'), 'after');
      expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('fingerprints a broken live-checkout symlink by its target without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-broken-link-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await symlink('missing-worktree', join(live, 'stale-worktree'));
    try {
      expect((await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider })).surfaces[0].manifest)
        .toEqual([{ path: 'stale-worktree', digest: '3a290960b8a3c3913dfd9c042d391b18e7afa36617c19b37f134e3ea2883573b' }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  // --- #907 provider-state exclusions (counterpart to #985's live-checkout exclusions) ---
  //
  // Verified tonight: 18 files under a LIVE ~/.claude changed in a 12-minute window during
  // a self-host run, written by an unrelated interactive session and background jobs, not
  // the sandboxed build: settings.json, history.jsonl, .last-cleanup,
  // plugins/known_marketplaces.json, shell-snapshots/*, backups/*, sessions/*. Everything
  // else below each provider's excluded list is the same category of noise, confirmed by
  // read-only inspection of a live ~/.claude and ~/.codex (file purpose + observed churn),
  // not by a second incident.

  it('ignores Claude provider-state noise from concurrent sessions/background jobs, not the sandboxed build (#907)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-claude-noise-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(live),
      mkdir(join(provider, 'plugins'), { recursive: true }),
      mkdir(join(provider, 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin'), { recursive: true }),
      mkdir(join(provider, 'shell-snapshots'), { recursive: true }),
      mkdir(join(provider, 'backups'), { recursive: true }),
      mkdir(join(provider, 'sessions'), { recursive: true }),
      mkdir(join(provider, 'session-env', 'abc'), { recursive: true }),
      mkdir(join(provider, 'projects', 'proj'), { recursive: true }),
      mkdir(join(provider, 'tasks', 'task-1'), { recursive: true }),
      mkdir(join(provider, 'cache'), { recursive: true }),
    ]);
    await writeFile(join(provider, 'history.jsonl'), 'before');
    await writeFile(join(provider, '.last-cleanup'), 'before');
    await writeFile(join(provider, 'plugins', 'known_marketplaces.json'), 'before');
    await writeFile(join(provider, 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'), 'before');
    await writeFile(join(provider, 'plugins', 'marketplaces', 'claude-plugins-official', '.gcs-sha'), 'before');
    await writeFile(join(provider, 'shell-snapshots', 'a.sh'), 'before');
    await writeFile(join(provider, 'backups', '.claude.json.backup.1'), 'before');
    await writeFile(join(provider, 'sessions', '123.json'), 'before');
    await writeFile(join(provider, 'session-env', 'abc', 'env'), 'before');
    await writeFile(join(provider, 'projects', 'proj', 'transcript.jsonl'), 'before');
    await writeFile(join(provider, 'tasks', 'task-1', '.lock'), 'before');
    await writeFile(join(provider, '.last-update-result.json'), 'before');
    await writeFile(join(provider, 'stats-cache.json'), 'before');
    await writeFile(join(provider, 'mcp-needs-auth-cache.json'), 'before');
    await writeFile(join(provider, 'cache', 'my-closed-issues.json'), 'before');
    await writeFile(join(provider, 'settings.json'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'claude' });
    // Every write below simulates an unrelated concurrent session or background job.
    await writeFile(join(provider, 'history.jsonl'), 'after');
    await writeFile(join(provider, '.last-cleanup'), 'after');
    await writeFile(join(provider, 'plugins', 'known_marketplaces.json'), 'after');
    await writeFile(join(provider, 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'), 'after');
    await writeFile(join(provider, 'plugins', 'marketplaces', 'claude-plugins-official', '.gcs-sha'), 'after');
    await writeFile(join(provider, 'shell-snapshots', 'a.sh'), 'after');
    await writeFile(join(provider, 'shell-snapshots', 'b.sh'), 'new');
    await writeFile(join(provider, 'backups', '.claude.json.backup.2'), 'new');
    await writeFile(join(provider, 'sessions', '123.json'), 'after');
    await writeFile(join(provider, 'sessions', '456.json'), 'new');
    await writeFile(join(provider, 'session-env', 'abc', 'env'), 'after');
    await mkdir(join(provider, 'session-env', 'def'), { recursive: true });
    await writeFile(join(provider, 'session-env', 'def', 'env'), 'new');
    await writeFile(join(provider, 'projects', 'proj', 'transcript.jsonl'), 'after');
    await writeFile(join(provider, 'tasks', 'task-1', '.lock'), 'after');
    await rm(join(provider, 'tasks', 'task-1', '.lock'));
    await writeFile(join(provider, '.last-update-result.json'), 'after');
    await writeFile(join(provider, 'stats-cache.json'), 'after');
    await writeFile(join(provider, 'mcp-needs-auth-cache.json'), 'after');
    await writeFile(join(provider, 'cache', 'my-closed-issues.json'), 'after');
    await writeFile(join(provider, 'cache', 'changelog.md'), 'new');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('deliberately still trips on Claude settings.json — leak-indicative, kept fingerprinted despite noise cost (#907)', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['settings.json', 'settings.json'],
      ['settings.local.json', 'settings.local.json'],
      ['CLAUDE.md', 'CLAUDE.md'],
      ['rules', join('rules', 'context7.md')],
      ['skills', join('skills', 'some-skill', 'SKILL.md')],
    ];
    for (const [label, relPath] of cases) {
      const root = await mkdtemp(join(tmpdir(), `live-boundary-claude-config-${label}-`));
      const live = join(root, 'live'); const provider = join(root, 'provider');
      await Promise.all([mkdir(live), mkdir(join(provider, ...relPath.split('/').slice(0, -1)), { recursive: true })]);
      await writeFile(join(provider, relPath), 'before');
      // Noise churns alongside the config-like mutation and must not mask it.
      await writeFile(join(provider, 'history.jsonl'), 'noise');
      const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'claude' });
      await writeFile(join(provider, relPath), 'after');
      await writeFile(join(provider, 'history.jsonl'), 'more noise');
      try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  it('ignores Codex provider-state noise from concurrent sessions/background jobs, not the sandboxed build (#907)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-codex-noise-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(live),
      mkdir(join(provider, 'sessions', '2026', '07'), { recursive: true }),
      mkdir(join(provider, 'shell_snapshots'), { recursive: true }),
      mkdir(join(provider, 'cache', 'codex_app_directory'), { recursive: true }),
      mkdir(join(provider, 'plugins', 'cache'), { recursive: true }),
      mkdir(join(provider, 'mcp-oauth-locks'), { recursive: true }),
      mkdir(join(provider, '.tmp', 'plugins'), { recursive: true }),
      mkdir(join(provider, 'tmp'), { recursive: true }),
      mkdir(join(provider, 'packages', 'standalone'), { recursive: true }),
    ]);
    await writeFile(join(provider, 'history.jsonl'), 'before');
    await writeFile(join(provider, 'sessions', '2026', '07', 'a.jsonl'), 'before');
    await writeFile(join(provider, 'shell_snapshots', 'a.sh'), 'before');
    await writeFile(join(provider, 'cache', 'codex_app_directory', 'x.json'), 'before');
    await writeFile(join(provider, 'plugins', 'cache', 'x.json'), 'before');
    await writeFile(join(provider, 'mcp-oauth-locks', 'file-store.lock'), 'before');
    await writeFile(join(provider, '.tmp', 'plugins', 'x'), 'before');
    await writeFile(join(provider, 'tmp', 'arg0'), 'before');
    await writeFile(join(provider, 'packages', 'standalone', 'install.lock'), 'before');
    await writeFile(join(provider, 'models_cache.json'), 'before');
    await writeFile(join(provider, 'goals_1.sqlite'), 'before');
    await writeFile(join(provider, 'goals_1.sqlite-wal'), 'before');
    await writeFile(join(provider, 'logs_2.sqlite'), 'before');
    await writeFile(join(provider, 'logs_2.sqlite-wal'), 'before');
    await writeFile(join(provider, 'memories_1.sqlite'), 'before');
    await writeFile(join(provider, 'state_5.sqlite'), 'before');
    await writeFile(join(provider, 'config.toml'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
    // Every write below simulates an unrelated concurrent session or background job.
    await writeFile(join(provider, 'history.jsonl'), 'after');
    await writeFile(join(provider, 'sessions', '2026', '07', 'a.jsonl'), 'after');
    await writeFile(join(provider, 'shell_snapshots', 'a.sh'), 'after');
    await writeFile(join(provider, 'cache', 'codex_app_directory', 'x.json'), 'after');
    await writeFile(join(provider, 'plugins', 'cache', 'x.json'), 'after');
    await writeFile(join(provider, 'mcp-oauth-locks', 'file-store.lock'), 'after');
    await writeFile(join(provider, '.tmp', 'plugins', 'x'), 'after');
    await writeFile(join(provider, 'tmp', 'arg0'), 'after');
    await writeFile(join(provider, 'packages', 'standalone', 'install.lock'), 'after');
    await writeFile(join(provider, 'models_cache.json'), 'after');
    await writeFile(join(provider, 'goals_1.sqlite'), 'after');
    await writeFile(join(provider, 'goals_1.sqlite-wal'), 'after');
    await writeFile(join(provider, 'logs_2.sqlite'), 'after');
    await writeFile(join(provider, 'logs_2.sqlite-wal'), 'after');
    await writeFile(join(provider, 'memories_1.sqlite'), 'after');
    await writeFile(join(provider, 'state_5.sqlite'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  // --- halt-reason diagnostics: the reason must name what differed ---

  it('names the added, removed and changed paths, tagged by kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-reason-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await writeFile(join(live, 'kept.ts'), 'same');
    await writeFile(join(live, 'doomed.ts'), 'before');
    await writeFile(join(live, 'edited.ts'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await rm(join(live, 'doomed.ts'));
    await writeFile(join(live, 'edited.ts'), 'after');
    await writeFile(join(live, 'appeared.ts'), 'new');
    try {
      const result = await verifyLiveBoundary(baseline);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('live checkout changed during self-host execution');
      expect(result.reason).toContain('1 added, 1 removed, 1 changed');
      expect(result.reason).toContain('added appeared.ts');
      expect(result.reason).toContain('removed doomed.ts');
      expect(result.reason).toContain('changed edited.ts');
      expect(result.reason).not.toContain('kept.ts');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('bounds the named paths so a large diff cannot flood daemon.log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-reason-bound-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await writeFile(join(live, 'sentinel'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    for (let index = 0; index < 40; index += 1) await writeFile(join(live, `churn-${index}.ts`), 'new');
    try {
      const reason = (await verifyLiveBoundary(baseline)).reason ?? '';
      expect(reason).toContain('40 added, 0 removed, 0 changed');
      expect(reason).toContain('and 32 more');
      // 8 named paths, not 40.
      expect(reason.match(/added churn-/g)).toHaveLength(8);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('redacts token-shaped fragments out of a reported path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-reason-redact-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'claude' });
    await writeFile(join(provider, 'token=sk-abcdef123456'), 'leaked');
    try {
      const reason = (await verifyLiveBoundary(baseline)).reason ?? '';
      expect(reason).toContain('provider state changed');
      expect(reason).toContain('token=[REDACTED]');
      expect(reason).not.toContain('sk-abcdef123456');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  // --- pattern-based SQLite exclusions (version-proofing the enumeration) ---

  it('ignores an unknown SQLite generation at the Codex provider-state root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-sqlite-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await writeFile(join(provider, 'config.toml'), 'unchanged');
    await writeFile(join(provider, 'state_9.sqlite'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
    // A schema-generation bump Codex has not shipped yet, plus a brand new store.
    await writeFile(join(provider, 'state_9.sqlite'), 'after');
    await writeFile(join(provider, 'state_9.sqlite-wal'), 'new');
    await writeFile(join(provider, 'state_9.sqlite-shm'), 'new');
    await writeFile(join(provider, 'state_9.sqlite-journal'), 'new');
    await writeFile(join(provider, 'threads_1.sqlite'), 'new store');
    await writeFile(join(provider, 'threads_1.sqlite-wal'), 'new');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('scopes the SQLite pattern to the provider-state root — a nested lookalike still trips the guard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-sqlite-nested-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(join(provider, 'skills'), { recursive: true })]);
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
    await writeFile(join(provider, 'skills', 'state_9.sqlite-wal'), 'planted below the root');
    try {
      const result = await verifyLiveBoundary(baseline);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('added skills/state_9.sqlite-wal');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not apply the provider-state pattern to the live checkout surface', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-sqlite-checkout-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
    await writeFile(join(live, 'fixtures.sqlite-wal'), 'harness source, not provider state');
    try {
      const result = await verifyLiveBoundary(baseline);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('live checkout changed');
      expect(result.reason).toContain('added fixtures.sqlite-wal');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still trips on an unexcluded provider-state file added, changed or deleted beside the patterns', async () => {
    const cases: ReadonlyArray<readonly [string, (provider: string) => Promise<void>]> = [
      ['added', async provider => { await writeFile(join(provider, 'hooks.json'), 'planted'); }],
      ['changed', async provider => { await writeFile(join(provider, 'config.toml'), 'after'); }],
      ['deleted', async provider => { await rm(join(provider, 'config.toml')); }],
    ];
    for (const [label, tamper] of cases) {
      const root = await mkdtemp(join(tmpdir(), `live-boundary-tamper-${label}-`));
      const live = join(root, 'live'); const provider = join(root, 'provider');
      await Promise.all([mkdir(live), mkdir(provider)]);
      await writeFile(join(provider, 'config.toml'), 'before');
      await writeFile(join(provider, 'state_5.sqlite-wal'), 'before');
      const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
      // Excluded churn alongside the tamper must not mask it.
      await writeFile(join(provider, 'state_5.sqlite-wal'), 'after');
      await tamper(provider);
      try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  // --- #1113: five self-host halts on 2026-07-28, all `via claude` steps ---

  it('ignores ~/.claude file-history and paste-cache churn from unrelated concurrent sessions (#1113)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-file-history-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([
      mkdir(live),
      mkdir(join(provider, 'file-history', '64996150-7240-4e3d-8e82-c7423918ddd8'), { recursive: true }),
      mkdir(join(provider, 'paste-cache'), { recursive: true }),
    ]);
    await writeFile(join(provider, 'file-history', '64996150-7240-4e3d-8e82-c7423918ddd8', '0a2a0627758ee5b5@v1'), 'before');
    await writeFile(join(provider, 'paste-cache', 'abc'), 'before');
    await writeFile(join(provider, 'settings.json'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'claude' });
    // Exactly what an unrelated interactive session's Edit/Write produces.
    await writeFile(join(provider, 'file-history', '64996150-7240-4e3d-8e82-c7423918ddd8', '0a2a0627758ee5b5@v2'), 'new version');
    await mkdir(join(provider, 'file-history', 'ffffffff-0000-0000-0000-000000000000'), { recursive: true });
    await writeFile(join(provider, 'file-history', 'ffffffff-0000-0000-0000-000000000000', '6a4ec7b1047bb013@v1'), 'new session');
    await writeFile(join(provider, 'paste-cache', 'abc'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still trips on Codex config-like state beside the excluded noise (#907)', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['config.toml', 'config.toml'],
      ['hooks.json', 'hooks.json'],
      ['rules', join('rules', 'default.rules')],
    ];
    for (const [label, relPath] of cases) {
      const root = await mkdtemp(join(tmpdir(), `live-boundary-codex-config-${label}-`));
      const live = join(root, 'live'); const provider = join(root, 'provider');
      await Promise.all([mkdir(live), mkdir(join(provider, ...relPath.split('/').slice(0, -1)), { recursive: true })]);
      await writeFile(join(provider, relPath), 'before');
      await writeFile(join(provider, 'history.jsonl'), 'noise');
      const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider, provider: 'codex' });
      await writeFile(join(provider, relPath), 'after');
      await writeFile(join(provider, 'history.jsonl'), 'more noise');
      try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  });
});
