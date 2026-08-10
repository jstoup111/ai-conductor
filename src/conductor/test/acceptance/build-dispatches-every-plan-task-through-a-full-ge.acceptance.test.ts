/**
 * RED acceptance specs for declared pattern replication in BUILD.
 *
 * Stories: `.docs/stories/build-dispatches-every-plan-task-through-a-full-ge.md`
 * ADR: `.docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md`
 *
 * Story 1 is a single parser operation and is unit-covered by plan Tasks 1–4.
 * These specs own the multi-operation flows and public skill contracts in
 * Stories 2–7. The build-review case drives the real `DefaultStepRunner`
 * entry point; the skill-backed flows exercise their public, installed
 * contracts because those Markdown workflows are the production interface.
 *
 * No third party is called. The grader is a faithful injected provider fake,
 * and Git is real because base-to-feature diff assembly is part of the
 * build-review boundary under test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState } from '../../src/types/index.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

const execFile = promisify(execFileCb);
const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function readContract(relativePath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relativePath), 'utf8');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

function passingProvider(): { provider: LLMProvider; calls: InvokeOptions[] } {
  const calls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      calls.push(options);
      return { success: true, output: 'PASS', exitCode: 0 };
    }),
    invokeInteractive: vi.fn(async (): Promise<void> => {}),
  };
  return { provider, calls };
}

async function makeMismatchFixture(): Promise<{ root: string; planPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'declared-replication-build-review-'));
  roots.push(root);
  const planPath = join(root, '.docs/plans/replicate-gate.md');
  const sourcePath = join(root, 'src/source-gate.ts');
  const targetPath = join(root, 'src/target-gate.ts');

  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(
    planPath,
    [
      '# Implementation Plan: replicate gate',
      '',
      '**Pattern-source:** src/source-gate.ts',
      '**Rename-map:** source-gate -> target-gate, SourceGate -> TargetGate',
      '',
      '### Task 1: Copy the declared gate',
      '',
      '**Files:**',
      '- `src/target-gate.ts`',
      '',
      '**Wired-into:** none (no new production surface)',
      '',
    ].join('\n'),
  );
  await writeFile(sourcePath, 'export class SourceGate { value = "source-gate"; }\n');

  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.com');
  await git(root, 'config', 'user.name', 'Acceptance');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await git(root, 'add', '.');
  await git(root, 'commit', '-q', '-m', 'fixture base');
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  await git(root, 'checkout', '-q', '-b', 'feature/replicate-gate');

  await writeFile(
    targetPath,
    'export class TargetGate { value = "target-gate"; extra = "undeclared delta"; }\n',
  );
  await git(root, 'add', 'src/target-gate.ts');
  await git(root, 'commit', '-q', '-m', 'copy declared gate');
  return { root, planPath };
}

describe('Story 2: acceptance_specs copies declared source specs and earns RED', () => {
  it('requires renamed paths and bodies with executable RED evidence', async () => {
    const contract = await readContract('skills/writing-system-tests/SKILL.md');

    expect(contract).toMatch(/Pattern-source[\s\S]{0,500}Rename-map/i);
    expect(contract).toMatch(/cop(?:y|ied)[\s\S]{0,220}(?:path|filename)[\s\S]{0,220}content/i);
    expect(contract).toMatch(/(?:failed|failure)[^\n]*(?:at least one|non-zero)[\s\S]{0,180}zero (?:errors|skips)/i);
    expect(contract).toMatch(/(?:never|no|does not)[^\n]*fall back[^\n]*deriv/i);
  });
});

describe('Story 3: pipeline performs one atomic declared copy task without an LLM', () => {
  it('requires complete Files scope, renamed outputs, zero turns, and atomic failure', async () => {
    const contract = await readContract('skills/pipeline/SKILL.md');

    expect(contract).toMatch(/exactly one[\s\S]{0,160}copy task/i);
    expect(contract).toMatch(/Files:[\s\S]{0,220}(?:every|all)[^\n]*(?:target|path)/i);
    expect(contract).toMatch(/rename map[\s\S]{0,220}(?:content|target)/i);
    expect(contract).toMatch(/(?:zero|no)[^\n]*(?:LLM )?(?:turn|dispatch)/i);
    expect(contract).toMatch(/(?:unreadable|read failure)[\s\S]{0,220}(?:partial|atomic|roll back)/i);
    expect(contract).toMatch(/(?:no|absent|without)[^\n]*declaration[\s\S]{0,180}(?:fail|halt|reject)/i);
    expect(contract).toMatch(/undeclared path[\s\S]{0,180}(?:fail|halt|reject)/i);
  });
});

describe('Story 4: build_review blocks a copy that differs beyond the rename map', () => {
  it('drives the real runner, refuses the mismatch before grading, and names the target', async () => {
    const { root, planPath } = await makeMismatchFixture();
    const { provider, calls } = passingProvider();
    const runner = new DefaultStepRunner(provider, 'acceptance-session', root, {
      featureDesc: 'replicate-gate',
      planPath,
      modelOverride: 'fable',
      config: {
        model_fallback_ladder: ['fable'],
        build_review: { per_task_floor: false },
      } as HarnessConfig,
    });

    const result = await runner.run('build_review', {
      feature_desc: 'replicate-gate',
    } as ConductState);

    expect(result.success).toBe(false);
    expect(result.output ?? '').toMatch(/copy|equivalen|mismatch/i);
    expect(result.output ?? '').toContain('src/target-gate.ts');
    expect(calls).toHaveLength(0);
  });
});

describe('Stories 5 and 6: copied work closes whole tasks; deltas retain full TDD', () => {
  it('preserves satisfied-by validation and sends partial or ambiguous tasks through RED first', async () => {
    const [pipeline, tdd] = await Promise.all([
      readContract('skills/pipeline/SKILL.md'),
      readContract('skills/tdd/SKILL.md'),
    ]);

    expect(pipeline).toMatch(/Evidence:\s*satisfied-by[\s\S]{0,260}(?:whole|every|all)[^\n]*(?:task|acceptance criteria)/i);
    expect(pipeline).toMatch(/(?:partial|partly|ambigu)[\s\S]{0,220}(?:full|complete)[^\n]*(?:TDD|cycle)/i);
    expect(pipeline).toMatch(/(?:nonexistent|unresolvable)[^\n]*(?:sha|commit)[\s\S]{0,180}(?:fail|incomplete|not complete)/i);
    expect(pipeline).toMatch(/not an ancestor[\s\S]{0,180}(?:fail|incomplete|not complete)/i);
    expect(tdd).toMatch(/(?:declared replication|Pattern-source)[\s\S]{0,260}(?:full|complete)[^\n]*(?:RED|cycle)/i);
    expect(tdd).toMatch(/first test[\s\S]{0,120}pass[\s\S]{0,220}(?:does not|must not|stop)[^\n]*implementation/i);
  });
});

describe('Story 7: simplify scopes duplication suppression to declared pairs', () => {
  it('does not reflex-flag declared pairs but retains undeclared and merits-based findings', async () => {
    const contract = await readContract('skills/simplify/SKILL.md');

    expect(contract).toMatch(/declared replication[\s\S]{0,220}(?:not|do not|suppress)[^\n]*(?:similar|duplication|copy)/i);
    expect(contract).toMatch(/outside[^\n]*(?:declared|target)[\s\S]{0,180}(?:flag|finding|duplicate)/i);
    expect(contract).toMatch(/(?:may|can|retain)[^\n]*(?:extract|extraction)[\s\S]{0,180}(?:rationale|reason|merit)/i);
    expect(contract).toMatch(/(?:no|without|absent)[^\n]*declaration[\s\S]{0,160}unchanged/i);
  });
});
