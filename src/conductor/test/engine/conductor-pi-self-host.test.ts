// Covers: task:9
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { executeProviderCandidates, type ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, ConductorEvent } from '../../src/types/index.js';

const STATE = { feature_desc: 'pi-lifecycle' } as ConductState;

function guardrails(): SelfHostGuardrails {
  return {
    resolveHarnessRoot: vi.fn(async () => '/live'),
    resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: '/live' })),
    relink: vi.fn(async () => {}),
    provisionSandbox: vi.fn(),
    provisionProviderHome,
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
  };
}

describe('Pi self-host conductor lifecycle', () => {
  it('settles a resolver refusal without invoking Pi and releases its scratch lease', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-pi-refusal-'));
    const operatorHome = await mkdtemp(join(tmpdir(), 'operator-pi-home-'));
    const priorHome = process.env.PI_CODING_AGENT_DIR;
    try {
      await mkdir(join(projectRoot, 'skills'));
      await writeFile(join(operatorHome, 'settings.json'), '{}');
      process.env.PI_CODING_AGENT_DIR = operatorHome;
      const invoke = vi.fn();
      const resolverFailure = new ProviderSetupUnavailableError({
        provider: 'pi', capability: 'self-host-isolation',
        reason: 'Pi self-host credential resolution for openrouter with exit status 1.',
        recoveryAction: 'Configure Pi, then retry.',
      });
      const runtimes = new ProviderRuntimeSet([{
        key: 'pi',
        provider: {
          invoke,
          resolveSelfHostExecutable: vi.fn(async () => 'pi'),
          prepareSelfHostAuth: vi.fn(async () => { throw resolverFailure; }),
        },
        policy: providerDescriptor('pi').modelPolicy,
        builtIn: true,
        availability: new ModelAvailability([]),
      }] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi'] } as ProviderExecutionContext;
      const runner: StepRunner = { run: async () => executeProviderCandidates({
        step: 'build', configuredProviders: ['pi'], preferredProvider: 'pi', runtimes,
        sessions: new ProviderSessionScope(vi.fn()), runId: 'run-1',
        config: { provider_substitution: 'disallow', llm_providers: { pi: { model: 'openrouter/m' } } } as never,
        options: { prompt: 'build', cwd: projectRoot },
        prepareCandidateSelfHost: providerExecution.prepareCandidateSelfHost,
      }) };
      const conductor = new Conductor({
        stateFilePath: join(projectRoot, 'conduct-state.json'), projectRoot, featureSlug: 'pi-lifecycle',
        events: new ConductorEventEmitter(), stepRunner: runner, providerExecution, selfHostGuardrails: guardrails(),
        daemon: true, selfHost: true,
        config: { llm_provider: 'pi', harness_self_host: { live_containment: false, build_auth: { mode: 'api-key' } } } as never,
      });

      const result = await (conductor as unknown as { runSelfBuildDispatch(step: 'build', state: ConductState): Promise<{ success: boolean; output?: string }> })
        .runSelfBuildDispatch('build', STATE);

      expect({
        success: result.success,
        setupRefusal: result.output?.includes('openrouter') === true && result.output.includes('pi'),
        invoked: invoke.mock.calls.length,
        scratch: await readdir(join(projectRoot, '.daemon', 'scratch')).catch(() => []),
      }).toEqual({ success: false, setupRefusal: true, invoked: 0, scratch: [] });
    } finally {
      if (priorHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = priorHome;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(operatorHome, { recursive: true, force: true });
    }
  });

  it('removes the isolated home after successful, failed, and aborted Pi work and halts config drift at the next boundary', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-pi-teardown-'));
    const operatorHome = await mkdtemp(join(tmpdir(), 'operator-pi-state-'));
    const priorHome = process.env.PI_CODING_AGENT_DIR;
    try {
      await mkdir(join(projectRoot, 'skills'));
      await writeFile(join(operatorHome, 'settings.json'), '{"before":true}');
      process.env.PI_CODING_AGENT_DIR = operatorHome;
      const homes: string[] = [];
      const invoke = vi.fn();
      const runtimes = new ProviderRuntimeSet([{
        key: 'pi', provider: {
          invoke,
          resolveSelfHostExecutable: vi.fn(async () => 'pi'),
          prepareSelfHostAuth: vi.fn(async ({ homeDir }: { homeDir: string }) => {
            homes.push(homeDir);
            await writeFile(join(homeDir, 'auth.json'), JSON.stringify({ openrouter: { type: 'api_key', key: 'K' } }), { mode: 0o600 });
            return { args: [] };
          }),
        }, policy: providerDescriptor('pi').modelPolicy, builtIn: true, availability: new ModelAvailability([]),
      }] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi'] } as ProviderExecutionContext;
      const runner: StepRunner = { run: async () => {
        for (const mode of ['success', 'failure', 'abort'] as const) {
          const prepared = await providerExecution.prepareCandidateSelfHost!(
            { step: 'build', providerKey: 'pi', model: 'openrouter/m', effort: 'high' }, runtimes.get('pi') as never,
            { runId: `run-${mode}`, attempt: 1 },
          );
          expect({ args: prepared!.args.includes('K'), env: Object.values(prepared!.env).includes('K') }).toEqual({ args: false, env: false });
          if (mode === 'success') await invoke();
          if (mode === 'abort') await writeFile(join(operatorHome, 'sessions', 'ignored.json'), '{}').catch(async () => {
            await mkdir(join(operatorHome, 'sessions')); await writeFile(join(operatorHome, 'sessions', 'ignored.json'), '{}');
          });
          if (mode === 'failure') await Promise.resolve({ success: false });
          await prepared!.teardown();
        }
        const prepared = await providerExecution.prepareCandidateSelfHost!(
          { step: 'build', providerKey: 'pi', model: 'openrouter/m', effort: 'high' }, runtimes.get('pi') as never,
          { runId: 'run-drift', attempt: 1 },
        );
        await writeFile(join(operatorHome, 'settings.json'), '{"after":true}');
        await prepared!.teardown();
        return { success: true };
      } };
      const events: ConductorEvent[] = [];
      const emitter = new ConductorEventEmitter();
      const emit = emitter.emit.bind(emitter);
      vi.spyOn(emitter, 'emit').mockImplementation(async (event) => {
        events.push(event);
        await emit(event);
      });
      const conductor = new Conductor({
        stateFilePath: join(projectRoot, 'conduct-state.json'), projectRoot, featureSlug: 'pi-lifecycle', events: emitter,
        stepRunner: runner, providerExecution, selfHostGuardrails: guardrails(), daemon: true, selfHost: true,
        config: { llm_provider: 'pi', harness_self_host: { live_containment: false, build_auth: { mode: 'api-key' } } } as never,
      });
      await (conductor as unknown as { runSelfBuildDispatch(step: 'build', state: ConductState): Promise<unknown> }).runSelfBuildDispatch('build', STATE);
      const reason = await (conductor as unknown as { consumePendingLiveBoundaryHalt(): Promise<string | undefined> }).consumePendingLiveBoundaryHalt();

      expect({
        invokes: invoke.mock.calls.length,
        homesGone: await Promise.all(homes.map((home) => access(home).then(() => false, () => true))),
        leases: await readdir(join(projectRoot, '.daemon', 'scratch')).catch(() => []),
        reason,
        halt: await access(join(projectRoot, '.pipeline', 'HALT')).then(() => true, () => false),
        keyInEvents: JSON.stringify(events).includes('K'),
      }).toEqual({ invokes: 1, homesGone: [true, true, true, true], leases: [], reason: expect.stringContaining('provider state'), halt: true, keyInEvents: false });
    } finally {
      if (priorHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = priorHome;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(operatorHome, { recursive: true, force: true });
    }
  });
});
