// Covers: task:10
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { AS_BUILT_VERDICT_SCHEMA, renderAsBuiltVerdictShape } from '../../src/engine/as-built-contract.js';
import {
  AS_BUILT_PROJECTION_VERSION,
  renderAsBuiltProjection,
  type AsBuiltProjection,
} from '../../src/engine/as-built-projection.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY, CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const { buildProjection } = vi.hoisted(() => ({ buildProjection: vi.fn() }));

vi.mock('../../src/engine/as-built-projection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/as-built-projection.js')>();
  return { ...actual, buildAsBuiltProjection: buildProjection };
});

const dirs: string[] = [];

const projection: AsBuiltProjection = {
  version: AS_BUILT_PROJECTION_VERSION,
  diff: { changedFiles: [{ path: 'src/example.ts', additions: 1, deletions: 0 }], hunks: ['+export const reviewed = true;'], omittedFiles: [] },
  tasks: [{ id: '10', doneWhen: ['the schema constrains the verdict'] }],
  storyCriteria: ['Story 1 happy: Given a projection, when reviewed, then it is bounded.'],
  policy: {
    reachability: { enabled: true, reason: 'all tiers' },
    planGap: { enabled: true, reason: 'all tiers' },
    adrCompliance: { enabled: true, reason: 'approved ADRs present' },
    diagramDrift: { enabled: false, reason: 'no diagrams' },
  },
  diagrams: [],
  governingAdrs: [],
  priorFindings: [],
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runtime(providerKey: 'claude' | 'codex', provider: LLMProvider): ProviderRuntimeSet {
  const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  return new ProviderRuntimeSet([{
    key: providerKey,
    provider,
    lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  }]);
}

function runner(
  projectDir: string,
  providerKey: 'claude' | 'codex',
  provider: LLMProvider,
  mode: 'auto' | 'interactive' = 'auto',
) {
  return new DefaultStepRunner({ invoke: vi.fn() }, 'as-built-test', projectDir, {
    mode,
    config: { llm_provider: providerKey, steps: { architecture_review_as_built: { llm_provider: providerKey } } },
    configuredProviders: [providerKey],
    providerRuntimes: runtime(providerKey, provider),
    sessionStore: new ProviderSessionStore(),
  });
}

function approvedVerdict() {
  return {
    version: 'v1',
    verdict: 'APPROVED',
    reachability: [],
    driftNotes: [],
  };
}

describe('architecture_review_as_built native-schema dispatch', () => {
  it('passes the native schema, bounded projection, and schema-derived shape to the Claude adapter', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'as-built-claude-'));
    dirs.push(projectDir);
    buildProjection.mockResolvedValue({ ok: true, projection });
    const subprocess = vi.fn(async (_file: string, _args: string[]) => ({
      stdout: JSON.stringify({ type: 'result', result: 'review complete', structured_output: JSON.stringify(approvedVerdict()) }),
      stderr: '', exitCode: 0,
    }));
    const adapter = new ClaudeProvider(undefined, subprocess as never);
    const invoke = vi.fn(adapter.invoke.bind(adapter));
    const provider: LLMProvider = { ...adapter, invoke };

    await runner(projectDir, 'claude', provider).run('architecture_review_as_built', { complexity_tier: 'M' });

    const options = invoke.mock.calls[0]?.[0] as InvokeOptions;
    const args = subprocess.mock.calls[0]?.[1] ?? [];
    const schemaIndex = args.indexOf('--json-schema');
    expect({
      nativeSchemaIdentity: options.nativeSchema === AS_BUILT_VERDICT_SCHEMA,
      interactive: options.interactive,
      adapterSchema: JSON.parse(args[schemaIndex + 1]!),
      skillCommand: options.prompt.startsWith('/architecture-review --as-built\n\n'),
      projectionBlocks: options.prompt.match(new RegExp(`AS-BUILT INPUT PROJECTION v${AS_BUILT_PROJECTION_VERSION}`, 'g'))?.length,
      hasSchemaShape: options.prompt.includes(renderAsBuiltVerdictShape(AS_BUILT_VERDICT_SCHEMA)),
    }).toEqual({
      nativeSchemaIdentity: true,
      interactive: false,
      adapterSchema: AS_BUILT_VERDICT_SCHEMA,
      skillCommand: true,
      projectionBlocks: 1,
      hasSchemaShape: true,
    });
  });

  it('writes the Codex schema under the invocation scratch home and removes it after dispatch', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'as-built-codex-'));
    dirs.push(projectDir);
    buildProjection.mockResolvedValue({ ok: true, projection });
    let schemaPath: string | undefined;
    let schemaBytes: string | undefined;
    const subprocess = vi.fn(async (_file: string, args: readonly string[]) => {
      const index = args.indexOf('--output-schema');
      schemaPath = index === -1 ? undefined : args[index + 1];
      schemaBytes = schemaPath === undefined ? undefined : await readFile(schemaPath, 'utf8');
      return {
        stdout: [
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(approvedVerdict()) } }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'),
        stderr: '', exitCode: 0,
      };
    });
    const adapter = new CodexProvider(
      async () => ({ stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }), exitCode: 0 }),
      'codex',
      undefined,
      subprocess as never,
    );
    const invoke = vi.fn(adapter.invoke.bind(adapter));
    const provider: LLMProvider = { ...adapter, invoke };

    await runner(projectDir, 'codex', provider).run('architecture_review_as_built', { complexity_tier: 'M' });

    const options = invoke.mock.calls[0]?.[0] as InvokeOptions;
    expect({
      nativeSchemaIdentity: options.nativeSchema === AS_BUILT_VERDICT_SCHEMA,
      interactive: options.interactive,
      schemaUnderScratch: schemaPath?.startsWith(join(projectDir, '.daemon', 'scratch')) ?? false,
      schema: JSON.parse(schemaBytes!),
      scratchRemoved: await access(schemaPath!).then(() => false).catch(() => true),
    }).toEqual({
      nativeSchemaIdentity: true,
      interactive: false,
      schemaUnderScratch: true,
      schema: AS_BUILT_VERDICT_SCHEMA,
      scratchRemoved: true,
    });
  });

  it('keeps the as-built native-schema invocation non-interactive in interactive conductor mode', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'as-built-interactive-'));
    dirs.push(projectDir);
    buildProjection.mockResolvedValue({ ok: true, projection });
    const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true, output: 'review complete', exitCode: 0, finalStructuredResult: approvedVerdict(),
    }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };

    await runner(projectDir, 'claude', provider, 'interactive').run(
      'architecture_review_as_built',
      { complexity_tier: 'M' },
    );

    const options = invoke.mock.calls[0]?.[0] as InvokeOptions;
    expect({ interactive: options.interactive, nativeSchemaIdentity: options.nativeSchema === AS_BUILT_VERDICT_SCHEMA }).toEqual({
      interactive: false,
      nativeSchemaIdentity: true,
    });
  });

  it('returns a projection fault without invoking a provider', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'as-built-projection-fault-'));
    dirs.push(projectDir);
    buildProjection.mockResolvedValue({ ok: false, fault: { dimension: 'plan-tasks', actual: 5, limit: 4 } });
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };

    const result = await runner(projectDir, 'claude', provider).run('architecture_review_as_built', { complexity_tier: 'M' });

    expect({ result, invokeCalls: invoke.mock.calls.length }).toEqual({
      result: { success: false, output: 'as-built input projection fault: plan-tasks (actual 5, limit 4)' },
      invokeCalls: 0,
    });
  });
});
