// Covers: task:13
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { PRD_AUDIT_VERDICT_PATH } from '../../src/engine/prd-audit-verdict-store.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-dispatch-'));
  dirs.push(root);
  const git = (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);
  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true }); await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n**Stories:** .docs/stories/feature.md\n\n## Technical Approach\nBound the PRD audit.\n\n### Task 1: Audit\n\n**Story:** Story 1\n\n**Done when:**\n- the audit dispatches typed evidence\n`);
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories\n\n## Story 1: Audit\n\n### Happy Path\n- Given an active feature, when audited, then the evidence is bounded.\n`);
  await writeFile(join(root, 'tracked.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/audit'); await writeFile(join(root, 'tracked.ts'), 'export const value = 2;\n'); await git('add', '.'); await git('commit', '-m', 'change');
  return root;
}

function runner(root: string, result: InvokeResult, native = true) {
  const invoke = vi.fn(async (_: InvokeOptions) => result);
  const provider = { name: 'claude', invoke } as unknown as LLMProvider;
  const runtimes = new ProviderRuntimeSet([{ key: 'claude', provider, lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: native }, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]);
  return { invoke, runner: new DefaultStepRunner({ invoke: vi.fn() }, 'prd-attempt', root, { mode: 'auto', featureDesc: 'feature', config: { llm_provider: 'claude', steps: { prd_audit: { llm_provider: 'claude' } } }, configuredProviders: ['claude'], providerRuntimes: runtimes, sessionStore: new ProviderSessionStore() }) };
}

describe('PRD audit typed provider dispatch', () => {
  it('sends engine-owned bounded evidence and persists only a validated terminal judgment', async () => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'done', finalStructuredResult: { version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, grade: 'PASS', evidence: 'Covered.', rationale: 'The changed path is covered.', requirementAssociations: [], evidenceTaskIds: ['1'] }], noOwnerObservations: [] } } as InvokeResult);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].interactive).toBe(false);
    expect(invoke.mock.calls[0]![0].nativeSchema).toBeDefined();
    expect(invoke.mock.calls[0]![0].prompt).toContain('PRD-AUDIT EVIDENCE');
    expect(JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'))).toMatchObject({ attemptId: 'prd-attempt', complete: true });
  });

  it('refuses a candidate lacking native structured output before invocation', async () => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable' } as InvokeResult, false);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: false, prdAuditFault: { kind: 'capability' } });
    expect(invoke).not.toHaveBeenCalled();
  });
});
