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
  it('requires replay source, parent, and upstream discovery before resolving a hunk', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /replay(?:ed)? (?:source )?commit|commit being replayed/i, 'identify the replay source commit');
    expectContract(skill, /parent (?:commit|context|diff)|source commit(?:'s)? parent/i, 'inspect the source parent context');
    expectContract(skill, /upstream (?:change|context|intent)/i, 'inspect the upstream change and intent');
    expectContract(skill, /conflict markers?.{0,120}(?:not|never|insufficient)|(?:not|never).{0,120}conflict markers?/is, 'refuse to infer correctness only from removed conflict markers');
  });

  it('reviews the complete staged replay and stops unexplained changes before continue', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /complete staged (?:diff|replay|resolution)|entire staged (?:diff|replay|resolution)|git diff --cached/i, 'review the complete staged replay before continue');
    expectContract(skill, /every staged change.{0,180}(?:source intent|upstream adaptation|attribut)/is, 'attribute every staged change to replay intent or an upstream adaptation');
    expectContract(skill, /unexplained (?:cross-file|staged)\s+(?:edit|change).{0,180}(?:resolved.{0,80}false|must not continue|do not continue)|(?:resolved.{0,80}false|must not continue|do not continue).{0,180}unexplained (?:cross-file|staged)\s+(?:edit|change)/is, 'stop on an unexplained staged or cross-file change');
  });

  it('validates each resulting replay commit before another conflict or successful completion', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /retain.{0,180}(?:pre-continue|before continue).{0,180}(?:replay (?:commit )?(?:identity|id)|source commit)/is, 'retain the pre-continue replay identity');
    expectContract(skill, /(?:after|post)[ -]continue.{0,180}(?:newly created|resulting) replay commit|(?:newly created|resulting) replay commit.{0,180}(?:after|post)[ -]continue/is, 'inspect the newly created replay commit after continue');
    expectContract(skill, /(?:cannot|does not|fails to).{0,180}(?:reconcile|match|preserve).{0,180}validated intent.{0,180}(?:resolved.{0,80}false|must not report.{0,80}resolved.{0,80}true)|(?:resolved.{0,80}false|must not report.{0,80}resolved.{0,80}true).{0,180}(?:cannot|does not|fails to).{0,180}(?:reconcile|match|preserve).{0,180}validated intent/is, 'refuse resolved:true when the replay cannot reconcile with validated intent');
    expectContract(skill, /(?:another|subsequent) conflict.{0,180}(?:return|resume|repeat).{0,180}(?:step 2|capture replay intent)|(?:return|resume|repeat).{0,180}(?:step 2|capture replay intent).{0,180}(?:another|subsequent) conflict/is, 'begin a fresh validation cycle for a subsequent conflicted commit');
    expectContract(skill, /(?:final|completed) replay.{0,180}(?:inspect|validat).{0,180}(?:resolved.{0,80}true|report(?:ing)? success)|(?:resolved.{0,80}true|report(?:ing)? success).{0,180}(?:final|completed) replay.{0,180}(?:inspect|validat)/is, 'inspect the final replay before reporting success');
  });
});

describe('Story 3 — preserve coordinated resolution freedom', () => {
  it('permits explained coordinated edits outside the immediate conflict surface', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /(?:cross-file|coordinated|supporting).{0,180}(?:outside|beyond).{0,120}(?:conflict|conflicted) (?:hunk|file)|outside (?:the )?(?:directly )?(?:conflict|conflicted) (?:hunk|file).{0,180}(?:cross-file|coordinated|supporting)/is, 'permit coordinated edits outside the immediate conflict surface');
    expectContract(skill, /(?:cross-file|coordinated|supporting).{0,180}(?:source intent|upstream adaptation).{0,180}(?:explain|attribut|validat)|(?:explain|attribut|validat).{0,180}(?:source intent|upstream adaptation).{0,180}(?:cross-file|coordinated|supporting)/is, 'require coordinated edits to be explained by replay intent and upstream adaptation');
  });

  it('rejects mechanical edit-surface rules as the acceptance boundary', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    for (const forbiddenBoundary of [
      'file allowlist',
      'hunk-only restriction',
      'whole-patch equality',
      'deterministic resolver',
    ]) {
      expectContract(
        skill,
        new RegExp(`(?:do not|must not|never|reject).{0,100}${forbiddenBoundary}`, 'is'),
        `reject ${forbiddenBoundary} as the acceptance boundary`,
      );
    }
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

  it('requires actionable ambiguity evidence and stops the bounded attempt at the first semantic ambiguity', async () => {
    const skill = await readFile(REBASE_SKILL, 'utf8');

    expectContract(skill, /\{"resolved": false, "reason":/i, 'emit ambiguity evidence through the false-result JSON contract');
    expectContract(skill, /reason.{0,180}replay commit/is, 'identify the replay commit in a false-result reason');
    expectContract(skill, /reason.{0,180}(?:file|path).{0,180}(?:line|region|hunk)/is, 'identify the affected file and line range or conflict region');
    expectContract(skill, /reason.{0,180}(?:source|incoming).{0,180}intent.{0,180}upstream.{0,180}intent/is, 'identify the competing source and upstream intentions');
    expectContract(skill, /reason.{0,180}missing decision/is, 'identify the decision that blocks a safe merge');
    expectContract(skill, /unavailable context.{0,180}(?:reason|fact|evidence)|(?:reason|fact|evidence).{0,180}unavailable context/is, 'state explicitly when required context is unavailable');
    expectContract(skill, /(?:do not|must not|never).{0,120}(?:confidence|confident).{0,180}(?:reason|ambigu|resolve)|(?:reason|ambigu|resolve).{0,180}(?:do not|must not|never).{0,120}(?:confidence|confident)/is, 'reject vague confidence claims as an ambiguity reason');
    expectContract(skill, /first.{0,120}ambiguity.{0,180}(?:stop|short-circuit|halt).{0,180}(?:do\s+not|must\s+not|never).{0,180}(?:edit|stage|continue|later attempt|another (?:hunk|conflict))|(?:do\s+not|must\s+not|never).{0,180}(?:edit|stage|continue|later attempt|another (?:hunk|conflict)).{0,180}first.{0,120}ambiguity/is, 'short-circuit without continuing after semantic ambiguity');
  });

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
