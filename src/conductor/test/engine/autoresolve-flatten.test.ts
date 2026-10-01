// Covers: task:11, task:12
import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { PASSING_SUITE, buildPrFixture } from './autoresolve-pr-fixture.js';

const execFile = promisify(execFileCallback);

describe('resolveConflictingPr flattened replay (Tasks 11–12)', () => {
  it('replays a merge-bearing PR through the shared flattened primitive and emits one audit', async () => {
    const fx = await buildPrFixture({
      initial: { 'base.txt': 'base\n' },
      feature: [{ subject: 'feat: first-parent work', files: { 'feature.ts': 'feature\n' } }],
      main: { 'upstream.txt': 'upstream\n' },
    });
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: fx.repo });
      await git(['checkout', '-q', 'feature']);
      await git(['branch', 'side']); await git(['checkout', '-q', 'side']);
      await writeFile(join(fx.repo, 'side.ts'), 'side-only\n'); await git(['add', 'side.ts']);
      await git(['commit', '-qm', 'side lineage subject']);
      await git(['checkout', '-q', 'feature']); await git(['merge', '--no-ff', '-m', 'PR flattened merge subject', 'side']);
      await git(['push', '-q', 'origin', 'feature']);
      const pushesBeforeResolve = await fx.pushes();

      const outcome = await resolveConflictingPr(
        { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo }, 'feature',
        { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 1 },
        { ...fx.deps, runSuite: PASSING_SUITE, resolver: async () => ({ resolved: false, reason: 'not reached' }), log: fx.log, events: fx.events },
      );
      expect(outcome).toEqual({ kind: 'refreshed' });
      expect(await fx.pushes()).toBe(pushesBeforeResolve + 1);
      expect(fx.emitted.filter((event) => event.type === 'rebase_merge_audit')).toHaveLength(1);
    } finally { await fx.cleanup(); }
  });

  it('keeps merge-free PR replay behavior and emits no flattened audit', async () => {
    const fx = await buildPrFixture({
      initial: { 'a.ts': 'base\n' },
      feature: [{ subject: 'feat: merge-free', files: { 'b.ts': 'feature\n' } }],
      main: { 'a.ts': 'upstream\n' },
    });
    try {
      const outcome = await resolveConflictingPr(
        { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo }, 'feature',
        { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 1 },
        { ...fx.deps, runSuite: PASSING_SUITE, resolver: async () => ({ resolved: false, reason: 'not reached' }), log: fx.log, events: fx.events },
      );
      expect(outcome).toEqual({ kind: 'refreshed' });
      expect(fx.emitted.filter((event) => event.type === 'rebase_merge_audit')).toEqual([]);
    } finally { await fx.cleanup(); }
  });

  it('escalates a flattened replay refusal with its merge sha and recipe before resolver or push', async () => {
    const fx = await buildPrFixture({
      initial: { 'a.ts': 'base\n' },
      feature: [{ subject: 'feat: first parent', files: { 'feature.ts': 'feature\n' } }],
      main: { 'a.ts': 'upstream\n' },
    });
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: fx.repo });
      await git(['checkout', '-q', 'feature']); await git(['branch', 'conflicting-side']);
      await git(['checkout', '-q', 'conflicting-side']); await writeFile(join(fx.repo, 'a.ts'), 'side\n');
      await git(['commit', '-qam', 'side creates target conflict']);
      await git(['checkout', '-q', 'feature']); await git(['merge', '--no-ff', '-m', 'refused merge subject', 'conflicting-side']);
      await git(['push', '-q', 'origin', 'feature']);
      let resolverCalls = 0;
      const outcome = await resolveConflictingPr(
        { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo }, 'feature',
        { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 1 },
        { ...fx.deps, runSuite: PASSING_SUITE, resolver: async () => { resolverCalls++; return { resolved: false, reason: 'unreachable' }; }, log: fx.log, events: fx.events },
      );
      expect(outcome).toEqual({ kind: 'escalated' });
      expect(resolverCalls).toBe(0); expect(await fx.pushes()).toBe(1);
      expect(fx.commentBodies().join('\n')).toMatch(/merge-flatten-refused|refused merge subject|recovery/i);
    } finally { await fx.cleanup(); }
  });
});
