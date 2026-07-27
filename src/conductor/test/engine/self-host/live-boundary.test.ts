import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintLiveBoundary, verifyLiveBoundary } from '../../../src/engine/self-host/live-boundary.js';

describe('live self-host boundary', () => {
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
