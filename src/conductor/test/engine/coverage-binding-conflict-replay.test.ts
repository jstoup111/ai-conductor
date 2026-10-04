// Covers: task:12
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

type Fixture = { criterion?: string; adr?: string; decision?: string; adrs?: [string, string][]; tasks: [string, string, string][]; conflictTaskIds?: string[] };

function conflictClaims(options: InvokeOptions): Array<{ id: string; kind: string; text: string }> {
  const body = options.prompt.slice(options.prompt.lastIndexOf('\n\n{') + 2);
  return (JSON.parse(body) as { claims: Array<{ id: string; kind: string; text: string }> }).claims;
}

async function fixture(name: string): Promise<Fixture> {
  return JSON.parse(await readFile(join(process.cwd(), 'test', 'fixtures', 'coverage-binding-conflicts', `${name}.json`), 'utf8')) as Fixture;
}

async function runReplay(name: string, conflict = true) {
  const data = await fixture(name);
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-conflict-replay-'));
  const feature = 'replay';
  const planPath = join(projectDir, '.docs', 'plans', `${feature}.md`);
  const storiesPath = join(projectDir, '.docs', 'stories', 'custom-story-artifact.md');
  const adrs = data.adrs ?? (data.adr && data.decision ? [[data.adr, data.decision]] : []);
  await mkdir(join(projectDir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(projectDir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(projectDir, '.docs', 'decisions'), { recursive: true });
  await writeFile(storiesPath, data.criterion
    ? `# Stories\n\n## Story 1\n\n### Happy Path\n\n- Given the plan is evaluated, when coverage binding runs, then ${data.criterion}\n`
    : '# Stories\n');
  await writeFile(planPath, [
    '**Stories:** .docs/stories/custom-story-artifact.md',
    ...data.tasks.map(([id, title, done]) => `### Task ${id}: ${title}\n**Done when:**\n- ${done}`),
    ...adrs.map(([stem]) => `Uses ${stem}#D1.`),
  ].join('\n\n'));
  await Promise.all(adrs.map(([stem, decision]) => writeFile(join(projectDir, '.docs', 'decisions', `${stem}.md`), `# ADR\n\n**Status:** APPROVED\n\n## Decision\n\n${decision}\n`)));
  const git = (...args: string[]) => promisify(execFile)('git', ['-C', projectDir, ...args]);
  await git('init', '-q', '-b', 'main');
  await git('add', '.');
  await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
  await git('remote', 'add', 'origin', '.');
  await git('fetch', '-q', 'origin', 'main:refs/remotes/origin/main');
  await git('checkout', '-q', '-b', 'feature');
  const prompts: string[] = [];
  const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
    prompts.push(options.prompt);
    const claims = conflictClaims(options);
    const isConflict = options.prompt.includes('complete plan task table');
    return { success: true, exitCode: 0, output: JSON.stringify({ verdicts: claims.map(({ id }) => isConflict
      ? { id, verdict: conflict ? 'conflicts' : 'consistent', ...(conflict ? { taskIds: data.conflictTaskIds, conflict: 'Fixture contradiction.' } : {}) }
      : { id, verdict: 'asserts' }) }) };
  }) };
  const runner = new DefaultStepRunner(provider, `replay-${name}`, projectDir, { featureDesc: feature, planPath, config: { coverage_binding: { judge: { enabled: true, batch_size: 2 } } } });
  return { projectDir, runner, prompts, provider, data };
}

describe('coverage-binding conflict evidence replays', () => {
  it.each(['case-1', 'case-2', 'case-3'] as const)('refuses replay %s with its sealed criterion and conflicting task', async (name) => {
    const replay = await runReplay(name);
    try {
      const result = await replay.runner.run('coverage_binding', { complexity_tier: 'M' });
      expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
      expect(result.output).toContain(replay.data.criterion!);
      expect(result.output).toContain(`Task ids: ${replay.data.conflictTaskIds![0]}`);
    } finally { await rm(replay.projectDir, { recursive: true, force: true }); }
  });

  it('replays the tier-S D4 ADR claim against every task', async () => {
    const replay = await runReplay('tier-s-d4');
    try {
      const result = await replay.runner.run('coverage_binding', { complexity_tier: 'S' });
      expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
      expect(result.output).toContain('adr-generated-values#D4');
      for (const taskId of replay.data.conflictTaskIds!) expect(result.output).toContain(taskId);
    } finally { await rm(replay.projectDir, { recursive: true, force: true }); }
  });

  it('replays two ADR decisions conflicting with Task 6', async () => {
    const replay = await runReplay('tier-s-two-adr');
    try {
      const result = await replay.runner.run('coverage_binding', { complexity_tier: 'S' });
      expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
      expect(result.output).toContain('adr-enum-pin#D1');
      expect(result.output).toContain('adr-roster#D2');
      expect(result.output).toContain('Task ids: 6');
    } finally { await rm(replay.projectDir, { recursive: true, force: true }); }
  });

  it('keeps a consistent plan done and dispatches its first conflict batch', async () => {
    const replay = await runReplay('consistent-plan', false);
    try {
      await expect(replay.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(replay.provider.invoke).toHaveBeenCalled();
    } finally { await rm(replay.projectDir, { recursive: true, force: true }); }
  });
});
