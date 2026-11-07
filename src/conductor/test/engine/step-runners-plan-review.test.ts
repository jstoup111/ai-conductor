// Covers: task:8, task:16, rem-as-built-rem-validation-AB1
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'step-runners-plan-review-')); roots.push(root);
  for (const dir of ['plans', 'stories']) await mkdir(join(root, '.docs', dir), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.docs/plans/feature.md'), '# Plan\n\n### Task 1: Review\n**Done when:**\n- review runs\n\n**Dependencies:** none\n', 'utf8');
  await writeFile(join(root, '.docs/stories/feature.md'), '# Stories\n\n## Story 1: Review\n', 'utf8');
  await execFileAsync('git', ['init', '-b', 'main', root]);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Test']);
  await execFileAsync('git', ['-C', root, 'add', '.']); await execFileAsync('git', ['-C', root, 'commit', '-m', 'baseline']);
  return root;
}

describe('plan_review step runner', () => {
  it('runs the engine-owned review and persists its lifecycle on the runner event spine', async () => {
    const root = await fixture(); const events = new ConductorEventEmitter(); const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events); const calls: any[] = [];
    persister.start();
    try {
      const runner = new DefaultStepRunner({ invoke: async () => ({ success: false }) } as any, 'plan-review-run', root, {
        mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'codex' } as any,
        configuredProviders: ['codex'], providerRuntimes: {} as any, sessionStore: new ProviderSessionStore(), events,
        providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
      });
      const result = await runner.run('plan_review', { complexity_tier: 'M' } as any);
      expect(result).toEqual({ success: true });
    } finally { persister.stop(); }
    expect(calls.map((call) => call.configuredProviders[0])).toEqual(['codex']);
    await expect(readFile(join(root, '.docs/plan-review/feature.md'), 'utf8')).resolves.toContain('reviewerProvider');
    const persisted = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const reviewEvents = persisted.filter((event) => event.type.startsWith('plan_review_'));
    expect(reviewEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'plan_review_dispatched', round: 1, reviewerProvider: 'codex', independence: expect.any(String) }),
      expect.objectContaining({ type: 'plan_review_completed', round: 1, reviewerProvider: 'codex', independence: expect.any(String) }),
    ]));
  });

  it.each([
    ['same-provider', { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }],
    ['unknown-host', { AI_CONDUCTOR_AUTHORING_PROVIDER: '', CLAUDECODE: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' }],
  ])('prints the %s independence notice for an interactive conduct run', async (independence, env) => {
    const root = await fixture();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const log = vi.fn();
    const runner = new DefaultStepRunner({ invoke: vi.fn() } as any, 'attempt', root, {
      mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'claude' } as any,
      configuredProviders: ['claude'], providerRuntimes: {} as any, sessionStore: {} as any, log,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    });

    await expect(runner.run('plan_review', {} as any)).resolves.toEqual({ success: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`plan review independence: ${independence}`));
  });

  it('passes plan_review.max_prompt_chars to the engine-owned runner', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n${'x'.repeat(450_000)}`, 'utf8');
    const runner = new DefaultStepRunner({ invoke: vi.fn() } as any, 'attempt', root, {
      mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'codex', plan_review: { max_prompt_chars: 600_000 } } as any,
      configuredProviders: ['codex'], providerRuntimes: {} as any, sessionStore: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    await expect(runner.run('plan_review', {} as any)).resolves.toEqual({ success: true });
    expect(calls).toHaveLength(1);
  });

  it('uses the configured budget for its refusal and otherwise keeps the runner default', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n${'x'.repeat(600_001)}`, 'utf8');
    const configured = new DefaultStepRunner({ invoke: vi.fn() } as any, 'attempt', root, {
      mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'codex', plan_review: { max_prompt_chars: 600_000 } } as any,
      configuredProviders: ['codex'], providerRuntimes: {} as any, sessionStore: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    });
    await expect(configured.run('plan_review', {} as any)).resolves.toEqual(expect.objectContaining({ success: false, output: expect.stringContaining('exceeds 600000') }));

    const defaultBudget = new DefaultStepRunner({ invoke: vi.fn() } as any, 'attempt', root, {
      mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'codex' } as any,
      configuredProviders: ['codex'], providerRuntimes: {} as any, sessionStore: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    });
    await expect(defaultBudget.run('plan_review', {} as any)).resolves.toEqual(expect.objectContaining({ success: false, output: expect.stringContaining('exceeds 400000') }));
  });

  it('returns the same size-refusal text that compose prefixes for the same inputs', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n${'x'.repeat(450_000)}`, 'utf8');
    let composeRefusal = '';
    await runPlanReview({ worktreePath: root, planStem: 'feature', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    }).catch((error) => { composeRefusal = error.message; });
    const runner = new DefaultStepRunner({ invoke: vi.fn() } as any, 'attempt', root, {
      mode: 'interactive', featureDesc: 'feature', config: { llm_provider: 'codex' } as any,
      configuredProviders: ['codex'], providerRuntimes: {} as any, sessionStore: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
    });
    await expect(runner.run('plan_review', {} as any)).resolves.toEqual({ success: false, output: composeRefusal });
  });
});
