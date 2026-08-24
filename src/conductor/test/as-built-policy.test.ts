import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../src/execution/llm-provider.js';
import { resolveAsBuiltPolicy, type AsBuiltPolicyConfig } from '../src/engine/as-built-policy.js';
import { DefaultStepRunner } from '../src/engine/step-runners.js';
import type { HarnessConfig } from '../src/types/config.js';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'as-built-policy-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveAsBuiltPolicy', () => {
  it('keeps reachability and plan-gap checks on for an S-tier feature without ADRs or diagrams', async () => {
    const policy = await resolveAsBuiltPolicy({ projectRoot: await fixture(), tier: 'S' });

    expect(policy).toMatchObject({
      reachability: { enabled: true },
      planGap: { enabled: true },
      adrCompliance: { enabled: false, reason: 'no approved ADRs' },
      diagramDrift: { enabled: false, reason: 'no diagrams' },
    });
  });

  it('enables every check for an L-tier feature with approved ADRs and diagrams', async () => {
    const root = await fixture();
    await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
    await mkdir(join(root, '.docs', 'architecture'), { recursive: true });
    await writeFile(join(root, '.docs', 'decisions', 'adr-feature.md'), '# ADR\n\nStatus: APPROVED\n');
    await writeFile(join(root, '.docs', 'architecture', 'feature.md'), '# Architecture\n');

    const policy = await resolveAsBuiltPolicy({ projectRoot: root, tier: 'L' });

    expect(Object.values(policy).every(({ enabled }) => enabled)).toBe(true);
  });

  it('reports a tier-disabled check in the rendered as-built prompt', async () => {
    const root = await fixture();
    const config: AsBuiltPolicyConfig = {
      architecture_review_as_built: {
        checks: { reachability: { tiers: ['M', 'L'] } },
      },
    };
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn().mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'test-session', root, {
      config: config as unknown as HarnessConfig,
      mode: 'auto',
    });

    await runner.run('architecture_review_as_built', { complexity_tier: 'S' });

    const systemPrompt = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      ?.systemPrompt as string;
    expect(systemPrompt).toContain('reachability: off — architecture_review_as_built.checks.reachability.tiers excludes S');
    expect(systemPrompt).toContain('planGap: on');
    expect(systemPrompt).toContain('adrCompliance: off — no approved ADRs');
    expect(systemPrompt).toContain('diagramDrift: off — no diagrams');
  });
});
