import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  NativeSchemaRequest,
} from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import { validateRemediationPlan } from '../../src/engine/remediation-plan-contract.js';
import { persistRemediationPlan } from '../../src/engine/remediation-plan-store.js';
import type { StepRunOptions } from '../../src/engine/conductor.js';

export type RemediationPlanProviderKey = 'claude' | 'codex';

export type RemediationPlanProviderOutcome =
  | {
    kind: 'structured';
    finalStructuredResult: unknown;
    output?: string;
    exitCode?: number;
  }
  | {
    kind: 'chat';
    output: string;
    exitCode?: number;
  }
  | { kind: 'throw'; error: unknown }
  | {
    kind: 'timeout';
    output?: string;
    exitCode?: number;
  }
  | { kind: 'provider-condition'; result: InvokeResult };

export interface RemediationPlanProviderCall {
  sessionId: string;
  nativeSchema: NativeSchemaRequest | undefined;
}

export interface RemediationPlanProviderFixture {
  provider: LLMProvider;
  runtime: ProviderRuntime;
  runtimes: ProviderRuntimeSet;
  calls: RemediationPlanProviderCall[];
  readonly invocationCount: number;
}

/**
 * The faithful remediation seam for conductor fixtures with a deliberately
 * small StepRunner fake.  Production's DefaultStepRunner validates provider
 * output against the dispatch projection before atomically persisting it; a
 * runner fake must not bypass that authority by writing a plan sidecar itself.
 */
export async function persistFixtureRemediationPlan(
  projectRoot: string,
  options: StepRunOptions | undefined,
  result: unknown,
): Promise<void> {
  const request = options?.remediationRequest;
  const runId = options?.runId;
  if (request?.mode !== 'gap-plan' || runId === undefined) {
    throw new Error('fixture remediation dispatch requires a gap-plan request and run id');
  }
  const validated = validateRemediationPlan(result, request.projection);
  if (validated.kind === 'rejected') {
    throw new Error(`fixture remediation plan rejected: ${validated.diagnostics.join('; ')}`);
  }
  const persisted = await persistRemediationPlan(projectRoot, {
    attemptId: runId,
    source: request.projection.source,
    requiredReferences: request.projection.requiredReferences,
    dispositions: validated.dispositions,
  });
  if (persisted.kind !== 'persisted') throw new Error(persisted.reason);
}

/**
 * Adapts deliberately small routing fixtures to the engine-owned test
 * reference vocabulary.  It is intentionally limited to sources without
 * required typed findings: PRD/as-built fixtures must supply their actual
 * projected reference through `persistFixtureRemediationPlan` instead.
 */
export async function persistFixtureTestRemediationPlan(
  projectRoot: string,
  options: StepRunOptions | undefined,
  dispositions: readonly {
    readonly id: string;
    /** Resolve a stamped engine reference without coupling the fixture to its attempt id. */
    readonly referenceKind?: 'prd-criterion' | 'as-built-finding' | 'refusal';
    readonly disposition: string;
    readonly category: string | null;
    readonly rationale: string;
    readonly tasks: readonly { readonly id: string; readonly title: string }[];
    readonly boundTaskIds?: readonly string[];
  }[],
): Promise<void> {
  const request = options?.remediationRequest;
  if (request?.mode !== 'gap-plan' || request.projection.source !== 'finish-verification') {
    throw new Error('test remediation fixture requires a finish-verification gap-plan request');
  }
  await persistFixtureRemediationPlan(projectRoot, options, {
    version: 'v1',
    dispositions: dispositions.map((disposition) => ({
      reference: { kind: 'test', id: `test:${disposition.id}` },
      disposition: disposition.disposition,
      category: disposition.category,
      rationale: disposition.rationale,
      tasks: disposition.tasks.map(({ id, title }) => ({ id, title })),
      boundTaskIds: disposition.boundTaskIds ?? [],
    })),
  });
}

/** Maps fixture IDs only to references the engine permits for this attempt. */
export async function persistFixtureProjectedRemediationPlan(
  projectRoot: string,
  options: StepRunOptions | undefined,
  dispositions: readonly {
    readonly id: string;
    /** Resolve a stamped engine reference without coupling the fixture to its attempt id. */
    readonly referenceKind?: 'prd-criterion' | 'as-built-finding' | 'refusal';
    readonly disposition: string;
    readonly category: string | null;
    readonly rationale: string;
    readonly tasks: readonly { readonly id: string; readonly title: string }[];
    readonly boundTaskIds?: readonly string[];
  }[],
): Promise<void> {
  const request = options?.remediationRequest;
  if (request?.mode !== 'gap-plan') throw new Error('fixture remediation dispatch requires a gap-plan request');
  const raw = dispositions.map((disposition) => {
    const reference = request.projection.requiredReferences.find((candidate) =>
      candidate.id === disposition.id ||
      (candidate.kind === 'prd-criterion' && candidate.id.toLowerCase() === disposition.id.toLowerCase()) ||
      (candidate.kind === 'refusal' && `refusal-${candidate.id}` === disposition.id) ||
      (candidate.kind === 'as-built-finding' && candidate.id.endsWith(`:${disposition.id.replace(/^AB-/, '')}`)) ||
      candidate.kind === disposition.referenceKind,
    );
    if (reference !== undefined) {
      return {
        reference: { kind: reference.kind, id: reference.id },
        disposition: disposition.disposition,
        category: disposition.category,
        rationale: disposition.rationale,
        tasks: disposition.tasks.map(({ id, title }) => ({ id, title })),
        boundTaskIds: disposition.boundTaskIds ?? [],
      };
    }
    const untypedKind = request.projection.source === 'build-stall' ? 'stall'
      : request.projection.source === 'finish-verification' ? 'test'
      : undefined;
    if (untypedKind === undefined || !new RegExp(`^${untypedKind}:[A-Za-z0-9][A-Za-z0-9._-]*$`).test(disposition.id)) {
      throw new Error(
        `fixture remediation disposition ${disposition.id} is not an engine-projected reference ` +
        `(${request.projection.requiredReferences.map((candidate) => `${candidate.kind}:${candidate.id}`).join(', ') || 'none'})`,
      );
    }
    return {
      reference: { kind: untypedKind, id: disposition.id },
      disposition: disposition.disposition,
      category: disposition.category,
      rationale: disposition.rationale,
      tasks: disposition.tasks.map(({ id, title }) => ({ id, title })),
      boundTaskIds: disposition.boundTaskIds ?? [],
    };
  });
  await persistFixtureRemediationPlan(projectRoot, options, { version: 'v1', dispositions: raw });
}

export function createRemediationPlanProviderFixture({
  key,
  outcomes,
}: {
  key: RemediationPlanProviderKey;
  outcomes: readonly RemediationPlanProviderOutcome[];
}): RemediationPlanProviderFixture {
  const calls: RemediationPlanProviderCall[] = [];
  const policy = key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;

  const provider: LLMProvider = {
    supportsSessionResume: key === 'claude',
    lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
    async invoke(options: InvokeOptions): Promise<InvokeResult> {
      calls.push({ sessionId: options.sessionId, nativeSchema: options.nativeSchema });
      const outcome = outcomes[calls.length - 1];
      if (!outcome) {
        throw new Error(`Remediation plan provider fixture has no outcome for invocation ${calls.length}.`);
      }

      switch (outcome.kind) {
        case 'structured':
          return {
            success: true,
            output: outcome.output ?? 'structured result',
            exitCode: outcome.exitCode ?? 0,
            finalStructuredResult: outcome.finalStructuredResult,
          };
        case 'chat':
          return {
            success: true,
            output: outcome.output,
            exitCode: outcome.exitCode ?? 0,
          };
        case 'throw':
          throw outcome.error;
        case 'timeout':
          return {
            success: false,
            output: outcome.output ?? 'fixture timeout',
            exitCode: outcome.exitCode ?? 124,
          };
        case 'provider-condition':
          return outcome.result;
      }
    },
  };
  const runtime: ProviderRuntime = {
    key,
    provider,
    lifecycleCapability: provider.lifecycleCapability,
    nativeSchemaCapability: provider.nativeSchemaCapability,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };

  return {
    provider,
    runtime,
    runtimes: new ProviderRuntimeSet([runtime]),
    calls,
    get invocationCount() { return calls.length; },
  };
}
