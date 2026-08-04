/**
 * RED acceptance specs for full-replay rebase intent validation (#1152).
 *
 * Track: technical. The behavior oracle is
 * `.docs/stories/rebase-full-replay-intent-validation.md` plus the APPROVED
 * `adr-2026-08-01-rebase-full-replay-intent-validation`.
 *
 * These specs cross the shipped semantic boundary in three ways:
 *   1. read the canonical `skills/rebase/SKILL.md` contract consumed by direct
 *      supported-host invocations;
 *   2. drive `DefaultStepRunner.resolveRebaseConflict` through an injected
 *      provider fake and inspect the contract delivered at dispatch; and
 *   3. feed the real parsed provider result through `resolveRebaseConflicts`
 *      and `writeHalt` against a real paused local Git rebase.
 *
 * No real LLM, GitHub command, registry, network, or other third party runs.
 * Local Git is real because paused-rebase state and preservation of that state
 * are part of the acceptance boundary.
 *
 * Production call sites covered for the correctness-critical replay judgment:
 *   - src/conductor/src/engine/step-runners.ts:1368
 *     (`DefaultStepRunner.resolveRebaseConflict`)
 *   - src/conductor/src/engine/conductor.ts (`runRebaseStep` consumer)
 *   - src/conductor/src/engine/daemon-rekick.ts (`resumeRebaseFirst` consumer)
 * Both consumers share `runGatedRebaseResolution`/`resolveRebaseConflicts`; the
 * final two specs exercise that shared production boundary through a paused
 * rebase and the operator-visible HALT writer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import {
  makeGitRunner,
  performRebase,
  resolveRebaseConflicts,
  writeHalt,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);
const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const REBASE_SKILL = join(REPO_ROOT, 'skills', 'rebase', 'SKILL.md');

interface ProviderDouble {
  provider: LLMProvider;
  calls: InvokeOptions[];
}

function scriptedProvider(result: InvokeResult): ProviderDouble {
  const calls: InvokeOptions[] = [];
  return {
    calls,
    provider: {
      invoke: vi.fn(async (options: InvokeOptions) => {
        calls.push(options);
        return result;
      }),
      invokeInteractive: vi.fn(async () => undefined),
    },
  };
}

function expectContract(text: string, pattern: RegExp, obligation: string): void {
  expect(text, `rebase contract must ${obligation}`).toMatch(pattern);
}

describe('Story 1 — validate the complete replay before continuing', () => {
  it('requires source/parent/upstream discovery, complete staged review, and post-continue inspection', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /replay(?:ed)? (?:source )?commit|commit being replayed/i, 'identify the replay source commit');
    expectContract(skill, /parent (?:commit|context|diff)|source commit(?:'s)? parent/i, 'inspect the source parent context');
    expectContract(skill, /upstream (?:change|context|intent)/i, 'inspect the upstream change and intent');
    expectContract(skill, /complete staged (?:diff|replay|resolution)|entire staged (?:diff|replay|resolution)|git diff --cached/i, 'review the complete staged replay before continue');
    expectContract(skill, /after (?:each )?(?:rebase --continue|continue)[\s\S]{0,240}(?:resulting|replayed|created) commit|post-continue/i, 'inspect the resulting replay commit before advancing or succeeding');
    expectContract(skill, /conflict markers?.{0,120}(?:not|never|insufficient)|(?:not|never).{0,120}conflict markers?/is, 'refuse to infer correctness only from removed conflict markers');
  });

  it('rejects unexplained EOF-newline, file-mode, and unrelated-file side effects', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /EOF|end[- ]of[- ]file|final newline/i, 'review EOF newline changes');
    expectContract(skill, /file mode|executable bit|mode change/i, 'review file mode changes');
    expectContract(skill, /unrelated file|unexplained (?:file|change)|every staged change/i, 'reject unrelated or unexplained staged changes');
    expectContract(skill, /resolved.{0,80}false|must not continue|do not continue/is, 'stop rather than report success when replay intent is unverified');
  });
});

describe('Story 2 — HALT with actionable ambiguity evidence', () => {
  let repo: string;
  const git = (args: string[]) => execFile('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-intent-acceptance-'));
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test User']);
    await writeFile(join(repo, 'replay.ts'), 'base\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    await git(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'replay.ts'), 'source intent\n');
    await git(['commit', '-q', '-am', 'feat: replay source intent']);
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'replay.ts'), 'upstream intent\n');
    await git(['commit', '-q', '-am', 'main: refactor replay target']);
    await git(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function pauseRebase(): Promise<{
    gitRunner: ReturnType<typeof makeGitRunner>;
    conflict: RebaseOutcome;
  }> {
    const gitRunner = makeGitRunner(repo);
    const conflict = await performRebase(gitRunner, repo, 'main');
    expect(conflict.kind).toBe('conflict_halt');
    return { gitRunner, conflict };
  }

  it('preserves specific semantic ambiguity from fake provider output through the bounded flow and HALT', async () => {
    const ambiguity =
      'replay commit abc1234; replay.ts lines 1-3; source intends feature behavior, ' +
      'upstream intends replacement behavior; missing decision: which behavior wins';
    const fake = scriptedProvider({
      success: false,
      output: `{"resolved": false, "reason": "${ambiguity}"}`,
      exitCode: 1,
    });
    const runner = new DefaultStepRunner(fake.provider, 'acceptance-session', repo);
    const { gitRunner, conflict } = await pauseRebase();
    let attempts = 0;

    const outcome = await resolveRebaseConflicts(
      gitRunner,
      repo,
      conflict,
      async (context) => {
        attempts += 1;
        return runner.resolveRebaseConflict(context);
      },
      3,
    );

    expect(attempts).toBe(1);
    expect(outcome).toMatchObject({ kind: 'conflict_halt', reason: ambiguity });
    if (outcome.kind !== 'conflict_halt') throw new Error('expected semantic ambiguity HALT');
    await writeHalt(repo, outcome.conflicts, outcome.reason);
    const halt = await readFile(join(repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(ambiguity);
    expect(halt).toContain('replay.ts');
    expect(halt).not.toContain('rebase resolution failed after 3 attempt(s)');
  });

  it('rejects malformed success and active-rebase success without losing the completion failure', async () => {
    const malformed = scriptedProvider({ success: true, output: 'resolved, probably', exitCode: 0 });
    const malformedRunner = new DefaultStepRunner(malformed.provider, 'malformed-session', repo);
    const first = await malformedRunner.resolveRebaseConflict({
      conflicts: ['replay.ts'],
      projectRoot: repo,
      baseRef: 'main',
    });
    expect(first.resolved).toBe(false);
    expect((first as { resolved: false; reason: string }).reason).toMatch(/parse|output|json/i);

    const claimedSuccess = scriptedProvider({
      success: true,
      output: '{"resolved": true}',
      exitCode: 0,
    });
    const successRunner = new DefaultStepRunner(claimedSuccess.provider, 'success-session', repo);
    const { gitRunner, conflict } = await pauseRebase();
    const outcome = await resolveRebaseConflicts(
      gitRunner,
      repo,
      conflict,
      (context) => successRunner.resolveRebaseConflict(context),
      1,
    );

    expect(outcome).toMatchObject({
      kind: 'conflict_halt',
      reason: expect.stringMatching(/failed after 1 attempt/i),
    });
    if (outcome.kind !== 'conflict_halt') throw new Error('expected active-rebase HALT');
    await writeHalt(repo, outcome.conflicts, outcome.reason);
    expect(await readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).toContain(outcome.reason);
  });
});

describe('Story 3 — preserve coordinated resolution freedom and provider delivery', () => {
  it('permits explained cross-file adaptations while forbidding mechanical edit-surface gates', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /cross-file|outside (?:the )?(?:conflict|conflicted) (?:hunk|file)|supporting edit/i, 'permit coordinated edits outside the immediate conflict surface');
    expectContract(skill, /(?:cross-file|supporting).{0,180}(?:source intent|upstream adaptation|explain|attribut)/is, 'require coordinated edits to be explained by replay intent');
    expectContract(skill, /(?:do not|must not|never).{0,100}(?:file allowlist|hunk-only|whole-patch equality|deterministic resolver)/is, 'forbid mechanical edit-surface restrictions as the acceptance boundary');
  });

  it('delivers the same full-replay and ambiguity-HALT obligations at the fake-provider boundary', async () => {
    const fake = scriptedProvider({ success: true, output: '{"resolved": true}', exitCode: 0 });
    const runner = new DefaultStepRunner(fake.provider, 'provider-boundary-session', '/wt/feature');

    await runner.resolveRebaseConflict({
      conflicts: ['src/replay.ts'],
      projectRoot: '/wt/feature',
      baseRef: 'base123',
    });

    expect(fake.calls).toHaveLength(1);
    const delivered = `${fake.calls[0]?.systemPrompt ?? ''}\n${fake.calls[0]?.prompt ?? ''}`;
    expectContract(delivered, /source (?:commit|intent)|commit being replayed/i, 'deliver source-intent inspection');
    expectContract(delivered, /complete staged (?:diff|replay|resolution)|entire staged (?:diff|replay|resolution)/i, 'deliver complete staged-replay validation');
    expectContract(delivered, /post-continue|resulting replay(?:ed)? commit|after (?:rebase --continue|continue)/i, 'deliver post-continue replay inspection');
    expectContract(delivered, /resolved.{0,80}false[\s\S]{0,180}(?:replay commit|file|region|competing|missing decision)/i, 'deliver actionable ambiguity failure evidence');
    expect(fake.provider.invokeInteractive).not.toHaveBeenCalled();
  });
});
