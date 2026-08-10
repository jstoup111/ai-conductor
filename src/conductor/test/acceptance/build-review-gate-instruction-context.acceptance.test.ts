/**
 * Acceptance coverage for the build_review context added by
 * build-review-flags-gate-mandated-wired-into-rewrit, Task 9.
 *
 * The observable boundary is the fresh grader-provider dispatch: the real
 * runner must carry a persisted wiring_check -> build instruction and the
 * matching plan diff hunk in the one prompt it gives the grader. A direct
 * prompt unit test could not prove the ledger reader is wired into that path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const execFile = promisify(execFileCallback);

const GATE_TASK = 'Task 17';
const OLD_ANCHOR = 'src/conductor/src/engine/legacy-anchor.ts#LEGACY_ANCHOR';
const REWRITTEN_ANCHOR = 'src/conductor/src/engine/wiring-probe.ts#checkInertContractContradiction';
const UNRELATED_ANCHOR = 'src/conductor/src/engine/unrelated.ts#UNRELATED_ANCHOR';

async function git(dir: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd: dir });
}

async function createFeatureRepo(): Promise<{ dir: string; planPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'build-review-gate-instruction-'));
  const planPath = join(dir, '.docs', 'plans', 'fixture.md');
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(
    planPath,
    `# Fixture plan\n\n### ${GATE_TASK}\n**Wired-into:** \`${OLD_ANCHOR}\`\n`,
  );
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test User']);
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-qm', 'seed approved plan']);
  await git(dir, ['checkout', '-qb', 'feature/gate-anchor-rewrite']);
  return { dir, planPath };
}

async function captureGraderPrompt(
  dir: string,
  planPath: string,
): Promise<{ prompt: string; provider: LLMProvider }> {
  const invoke = vi.fn<LLMProvider['invoke']>().mockResolvedValue({
    success: true,
    output: 'grader completed',
    exitCode: 0,
  });
  const provider: LLMProvider = {
    invoke,
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
  const runner = new DefaultStepRunner(provider, 'maker-session-must-not-be-reused', dir, {
    planPath,
  });

  const result = await runner.run('build_review', {});
  expect(result.success).toBe(true);
  expect(invoke).toHaveBeenCalledOnce();

  const options = invoke.mock.calls[0][0];
  expect(options.resume).toBe(false);
  expect(options.sessionId).not.toBe('maker-session-must-not-be-reused');
  return { prompt: options.prompt, provider };
}

describe('acceptance: build_review gate-instruction context (Task 9)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('sends a wiring_check instruction and its gate-mandated anchor rewrite together to the grader', async () => {
    const fixture = await createFeatureRepo();
    dir = fixture.dir;
    const { planPath } = fixture;
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const evidence = `${GATE_TASK}: contract is stale; switch the anchor to a declared call site (found in: ${REWRITTEN_ANCHOR})`;
    await writeFile(
      join(dir, '.pipeline', 'events.jsonl'),
      `${JSON.stringify({
        type: 'kickback', from: 'wiring_check', to: 'build', evidence, count: 1, ts: Date.now(),
      })}\n`,
    );
    await writeFile(
      planPath,
      `# Fixture plan\n\n### ${GATE_TASK}\n**Wired-into:** \`${REWRITTEN_ANCHOR}\`\n`,
    );
    await git(dir, ['add', '.docs/plans/fixture.md']);
    await git(dir, ['commit', '-qm', 'rewrite gate-mandated anchor']);

    const { prompt } = await captureGraderPrompt(dir, planPath);

    expect(prompt).toContain('- wiring_check → build (attempt 1)');
    expect(prompt).toContain(evidence);
    expect(prompt).toContain(OLD_ANCHOR);
    expect(prompt).toContain(REWRITTEN_ANCHOR);
    expect(prompt.indexOf(REWRITTEN_ANCHOR)).toBeLessThan(
      prompt.indexOf('## Engine-recorded gate instructions'),
    );
    expect(prompt.indexOf(evidence)).toBeGreaterThan(
      prompt.indexOf('## Engine-recorded gate instructions'),
    );
  });

  it('does not give an unrelated plan-anchor rewrite covering gate evidence', async () => {
    const fixture = await createFeatureRepo();
    dir = fixture.dir;
    const { planPath } = fixture;
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const unrelatedEvidence = `${GATE_TASK}: switch only to ${REWRITTEN_ANCHOR}`;
    await writeFile(
      join(dir, '.pipeline', 'events.jsonl'),
      `${JSON.stringify({
        type: 'kickback', from: 'wiring_check', to: 'build', evidence: unrelatedEvidence, count: 2, ts: Date.now(),
      })}\n`,
    );
    await writeFile(
      planPath,
      `# Fixture plan\n\n### ${GATE_TASK}\n**Wired-into:** \`${UNRELATED_ANCHOR}\`\n`,
    );
    await git(dir, ['add', '.docs/plans/fixture.md']);
    await git(dir, ['commit', '-qm', 'rewrite unrelated anchor']);

    const { prompt } = await captureGraderPrompt(dir, planPath);
    const instructions = prompt.slice(
      prompt.indexOf('## Engine-recorded gate instructions'),
      prompt.indexOf('## Engine-recorded rebase repair context'),
    );

    expect(prompt).toContain(UNRELATED_ANCHOR);
    expect(instructions).toContain(unrelatedEvidence);
    expect(instructions).not.toContain(UNRELATED_ANCHOR);
  });
});
