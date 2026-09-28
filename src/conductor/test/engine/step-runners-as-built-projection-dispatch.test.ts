// Covers: task:9
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

// Drives the REAL projection (no mock) through the as-built dispatch path.
const execFileAsync = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-dispatch-'));
  dirs.push(root);
  const git = (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);
  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  for (const dir of ['plans', 'stories', 'decisions']) await mkdir(join(root, '.docs', dir), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan

**Stories:** .docs/stories/feature.md

## Architecture Obligation Coverage

| Decision | Disposition | Tasks | Evidence |
| --- | --- | --- | --- |
| adr-plan-one#D1 | task | task-1 | first done condition |

### Task 1: First

**Done when:**
- first done condition
`);
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories

## Story 1: Projection

### Happy Path
- Given a sealed criterion, when projected, then it remains authoritative.
`);
  await writeFile(join(root, '.docs', 'decisions', 'adr-plan-one.md'), '# ADR\n\nStatus: APPROVED\n\n## Decision\n\n1. First.\n');
  await writeFile(join(root, 'tracked.ts'), 'export const unchanged = true;\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/projection');
  await writeFile(join(root, 'tracked.ts'), 'export const changed = true;\n');
  await git('add', '.');
  await git('commit', '-m', 'feature change');
  return root;
}

function harness(projectDir: string) {
  const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
    success: true,
    output: 'review complete',
    finalStructuredResult: { version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] },
  } as unknown as InvokeResult));
  const provider = { name: 'claude', invoke } as unknown as LLMProvider;
  const runtimes = new ProviderRuntimeSet([{
    key: 'claude',
    provider,
    lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
    policy: CLAUDE_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
  }]);
  const stepRunner = new DefaultStepRunner({ invoke: vi.fn() }, 'as-built-dispatch', projectDir, {
    mode: 'auto',
    config: { llm_provider: 'claude', steps: { architecture_review_as_built: { llm_provider: 'claude' } } },
    configuredProviders: ['claude'],
    providerRuntimes: runtimes,
    sessionStore: new ProviderSessionStore(),
  });
  return { invoke, stepRunner };
}

describe('architecture_review_as_built dispatch with the real input projection', () => {
  it('dispatches to the provider when the total diff overflows, naming the omitted files', async () => {
    const root = await fixture();
    for (const name of ['a-big.ts', 'b-big.ts', 'c-big.ts']) {
      await writeFile(join(root, name), `export const v = '${'x'.repeat(200 * 1024)}';\n`);
    }
    await execFileAsync('git', ['-C', root, 'add', '.']);
    await execFileAsync('git', ['-C', root, 'commit', '-m', 'overflow']);
    const { invoke, stepRunner } = harness(root);

    const result = await stepRunner.run('architecture_review_as_built', { complexity_tier: 'M' });

    expect(result.asBuiltFault).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].prompt).toContain('c-big.ts');
  });

  it('halts with an input fault and no provider dispatch when the sealed stories are unreadable', async () => {
    const root = await fixture();
    await rm(join(root, '.docs', 'stories', 'feature.md'));
    const { invoke, stepRunner } = harness(root);

    const result = await stepRunner.run('architecture_review_as_built', { complexity_tier: 'M' });

    expect(result).toMatchObject({ success: false, asBuiltFault: { kind: 'input', reason: expect.stringContaining('story-criteria') } });
    expect(invoke).not.toHaveBeenCalled();
    expect(stepRunner.callCount).toBe(0);
  });

  it('halts with an input fault and no provider dispatch when a governing ADR is unparseable', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'decisions', 'adr-plan-one.md'), '# ADR\n\nStatus: APPROVED\n\nNo decision heading.\n');
    const { invoke, stepRunner } = harness(root);

    const result = await stepRunner.run('architecture_review_as_built', { complexity_tier: 'M' });

    expect(result).toMatchObject({
      success: false,
      asBuiltFault: { kind: 'input', reason: expect.stringMatching(/governing-adr-decisions.*adr-plan-one.*parseAdrDecisions diagnostic \(missing-decision-heading\)/) },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(stepRunner.callCount).toBe(0);
  });
});
