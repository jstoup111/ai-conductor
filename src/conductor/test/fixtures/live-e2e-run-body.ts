import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { deriveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-aggregate.js';
import { Conductor } from '../../src/engine/conductor.js';
import { runDaemon } from '../../src/engine/daemon.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { ProviderHome } from '../../src/engine/self-host/provider-home.js';
import type { StepName } from '../../src/types/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { dumpPipelineDiagnostics } from '../engine/daemon-e2e-fixture.test.js';
import { initTestRepo } from './git-repo.js';
import type { LiveE2EProviderDescriptor } from './live-e2e-providers.js';
import { provisionLiveProviderHome } from './live-provider-home.js';
import { dispatchableStepCommands } from './step-command-preflight.js';

export class TokenMeter implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];
  totalTokens = 0;
  totalTurns = 0;
  unmetered = 0;
  readonly unmeteredSteps: (StepName | 'unattributed')[] = [];

  constructor(
    private readonly provider: LLMProvider,
    private readonly currentStep: () => StepName | undefined = () => undefined,
  ) {
    this.supportsSessionResume = provider.supportsSessionResume;
    this.lifecycleCapability = provider.lifecycleCapability;
    this.readiness = provider.readiness?.bind(provider);
    this.prepareSelfHostAuth = provider.prepareSelfHostAuth?.bind(provider);
    this.resolveSelfHostExecutable = provider.resolveSelfHostExecutable?.bind(provider);
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const result = await this.provider.invoke(options);
    this.record(result);
    return result;
  }

  async invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    const result = await this.provider.invokeInteractive(options);
    if (result) this.record(result);
    return result;
  }

  private record(result: InvokeResult): void {
    if (!result.tokenUsage) {
      this.unmetered += 1;
      this.unmeteredSteps.push(this.currentStep() ?? 'unattributed');
      return;
    }
    this.totalTokens += result.tokenUsage.input + result.tokenUsage.output;
    this.totalTurns += result.tokenUsage.numTurns ?? 0;
  }
}

export class ProvisionedHome implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];
  dispatches = 0;

  constructor(
    private readonly provider: LLMProvider,
    private readonly selfHost: NonNullable<InvokeOptions['selfHost']>,
  ) {
    this.supportsSessionResume = provider.supportsSessionResume;
    this.lifecycleCapability = provider.lifecycleCapability;
    this.readiness = provider.readiness?.bind(provider);
    this.prepareSelfHostAuth = provider.prepareSelfHostAuth?.bind(provider);
    this.resolveSelfHostExecutable = provider.resolveSelfHostExecutable?.bind(provider);
  }

  invoke(options: InvokeOptions): Promise<InvokeResult> {
    this.dispatches += 1;
    return this.provider.invoke({ ...options, selfHost: this.selfHost });
  }

  invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    this.dispatches += 1;
    return this.provider.invokeInteractive({ ...options, selfHost: this.selfHost });
  }
}

type LiveProviderPreflight = (homeDir: string, providerKey?: string) => Promise<void>;

export interface LiveE2ERunBodyDependencies {
  readonly binaryAvailable?: (binaryName: string) => boolean;
  readonly provisionProviderHome?: typeof provisionLiveProviderHome;
}

export async function dispatchAfterLivePreflight(
  home: Pick<ProviderHome, 'homeDir'>,
  dispatch: () => Promise<void>,
  providerKey: string,
  preflight: LiveProviderPreflight = dispatchableStepCommands.assertResolves,
): Promise<void> {
  await preflight(home.homeDir, providerKey);
  await dispatch();
}

export function assertTokenCap(totalTokens: number, unmetered: number, cap: number): void {
  if (totalTokens > cap) {
    throw new Error(`Token cap ${cap} exceeded: observed ${totalTokens}; unmetered results: ${unmetered}`);
  }
}

const STEPS_ALLOWED_UNMETERED: readonly StepName[] = ['finish'];

export function assertSuccessfulCredentialedRun(
  provisioned: Pick<ProvisionedHome, 'dispatches'> | undefined,
  meter: Pick<TokenMeter, 'totalTurns' | 'totalTokens' | 'unmetered' | 'unmeteredSteps'>,
): void {
  expect(provisioned?.dispatches ?? 0).toBeGreaterThan(0);
  expect(meter.totalTurns).toBeGreaterThan(0);
  expect(meter.totalTokens).toBeGreaterThan(0);
  const disallowed = meter.unmeteredSteps.filter(
    (step) => !STEPS_ALLOWED_UNMETERED.includes(step as StepName),
  );
  expect(disallowed).toEqual([]);
  expect(meter.unmeteredSteps.length).toBe(meter.unmetered);
}

const fixturePlanPath = fileURLToPath(new URL('./daemon-e2e/plan.md', import.meta.url));
const fixtureStoriesPath = fileURLToPath(new URL('./daemon-e2e/stories.md', import.meta.url));

export function providerBinaryAvailable(binaryName: string): boolean {
  try {
    execFileSync('which', [binaryName], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function liveProviderAvailable(descriptor: LiveE2EProviderDescriptor): boolean {
  return providerBinaryAvailable(descriptor.binaryName) && !!process.env[descriptor.credentialEnvVar];
}

export function assertLiveProviderBinary(
  descriptor: LiveE2EProviderDescriptor,
  binaryAvailable: (binaryName: string) => boolean = providerBinaryAvailable,
): void {
  if (binaryAvailable(descriptor.binaryName)) return;

  throw new Error(`Unmet toolchain requirement: ${descriptor.binaryName} binary is unavailable.`);
}

/**
 * Providers select their authentication source during construction.  Keep the
 * credential snapshot explicit so a live leg cannot construct Codex as a
 * cached-login provider and attempt to add its API key afterward.
 */
export function createLiveProvider(
  descriptor: LiveE2EProviderDescriptor,
  credential: string | undefined,
): LLMProvider {
  if (credential) process.env[descriptor.credentialEnvVar] = credential;
  return descriptor.createProvider();
}

/**
 * Codex may authenticate with either an API key or its cached login. Reject
 * an unavailable pair before constructing a provider or reaching dispatch.
 */
export function assertLiveProviderCredential(
  descriptor: LiveE2EProviderDescriptor,
  credential: string | undefined,
): void {
  if (descriptor.id !== 'codex' || credential?.trim()) return;

  const cachedLoginPath = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  if (existsSync(cachedLoginPath)) return;

  throw new Error(
    `Missing Codex credential: set ${descriptor.credentialEnvVar} or sign in at ${cachedLoginPath}`,
  );
}

export function defineLiveE2EProviderSmoke(descriptor: LiveE2EProviderDescriptor): void {
  const tokenCap = Number(process.env.DAEMON_E2E_LIVE_TOKEN_CAP ?? '100000');
  const shouldRun = liveProviderAvailable(descriptor);

  describe.skipIf(!shouldRun)(`daemon E2E with real ${descriptor.id} provider`, () => {
    it('finishes a seeded daemon fixture with a trailered task commit', async () => {
      await runLiveE2ERunBody(descriptor, tokenCap);
    }, 20 * 60_000);
  });
}

export async function assertDescriptorAuthenticationSource(
  descriptor: LiveE2EProviderDescriptor,
  provider: LLMProvider,
): Promise<void> {
  const resolvedAuthenticationSource = await descriptor.resolveAuthenticationSource(provider);
  if (resolvedAuthenticationSource !== descriptor.expectedAuthenticationSource) {
    throw new Error(`Authentication source mismatch: expected ${descriptor.expectedAuthenticationSource}, resolved ${resolvedAuthenticationSource}`);
  }
}

async function hasSuccessfulTerminalState(worktreeDir: string, slug: string): Promise<boolean> {
  return existsSync(join(worktreeDir, '.pipeline/DONE')) &&
    !existsSync(join(worktreeDir, '.pipeline/HALT')) &&
    !existsSync(join(worktreeDir, `.daemon/parked/${slug}`));
}

export async function runLiveE2ERunBody(
  descriptor: LiveE2EProviderDescriptor,
  tokenCap: number,
  dependencies: LiveE2ERunBodyDependencies = {},
): Promise<void> {
  assertLiveProviderBinary(descriptor, dependencies.binaryAvailable);
  const credential = process.env[descriptor.credentialEnvVar];
  assertLiveProviderCredential(descriptor, credential);
  const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-'));
  const slug = 'daemon-e2e-live';
  const pipelineDir = join(worktreeDir, '.pipeline');
  const statePath = join(pipelineDir, 'conduct-state.json');
  const planPath = join(worktreeDir, `.docs/plans/${slug}.md`);
  const provider = createLiveProvider(
    descriptor,
    credential,
  );
  await assertDescriptorAuthenticationSource(descriptor, provider);
  let meter = new TokenMeter(provider);
  let providerHome: ProviderHome | undefined;
  let provisioned: ProvisionedHome | undefined;
  let baselineSha: string | undefined;

  try {
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeUndefined();
    await initTestRepo(worktreeDir);
    await mkdir(join(worktreeDir, '.docs/plans'), { recursive: true });
    await mkdir(join(worktreeDir, '.docs/stories'), { recursive: true });
    await mkdir(join(worktreeDir, 'test/fixtures/daemon-e2e'), { recursive: true });
    await copyFile(fixturePlanPath, planPath);
    await copyFile(fixtureStoriesPath, join(worktreeDir, `.docs/stories/${slug}.md`));
    providerHome = await (dependencies.provisionProviderHome ?? provisionLiveProviderHome)(
      fileURLToPath(new URL('../../../../', import.meta.url)),
      process.env[descriptor.credentialEnvVar],
    );
    provisioned = new ProvisionedHome(provider, {
      executable: descriptor.selfHostExecutable,
      env: providerHome.childEnv(),
      args: providerHome.childArgs(),
      teardown: () => providerHome?.teardown() ?? Promise.resolve(),
    });
    const stepTracker: { current: StepName | undefined } = { current: undefined };
    meter = new TokenMeter(provisioned, () => stepTracker.current);
    await dispatchAfterLivePreflight(providerHome, async () => {
      // The harness repo gitignores its runtime dirs; without this the
      // review-era .pipeline writes (rubric caches, verdicts) surface as
      // uncommitted paths and the completion gate halts the fixture dirty
      // (0.103.0 release-gate failure). Mirror the harness repo's full
      // runtime-dir ignore set.
      await writeFile(
        join(worktreeDir, '.gitignore'),
        ['.pipeline/', '.daemon/', '.memory/', '.memory*.bak/', '.worktrees/', '.claude/'].join('\n') + '\n',
      );
      await execa('git', ['add', '-A'], { cwd: worktreeDir });
      await execa('git', ['commit', '-m', 'test: seed live daemon E2E fixture', '-m', 'Task: T0'], { cwd: worktreeDir });
      const { stdout: seededBaselineSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir });
      baselineSha = seededBaselineSha;
      const { stdout: seededFiles } = await execa('git', ['ls-tree', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir });
      expect(seededFiles.split('\n')).not.toContain('test/fixtures/daemon-e2e/touched.txt');
      await execa('git', ['checkout', '-b', `feature/${slug}`], { cwd: worktreeDir });
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(statePath, JSON.stringify({
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        complexity_tier: 'S', track: 'technical', stories: 'done', conflict_check: 'done',
        plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
        architecture_review: 'done', acceptance_specs: 'done',
      }));
      const runner = new DefaultStepRunner(meter, 'daemon-e2e-live-session', worktreeDir, {
        featureDesc: slug, pipelineDir, planPath, providerKey: descriptor.providerKey, mode: 'auto',
        // The tautology preflight (#1618) fails instantly in a standalone
        // temp repository with missing-scoped-configuration; disable only
        // that branch — the other three fan-out branches still run live.
        config: { build_review: { maxParallel: 4, rubrics: { tautology: { enabled: false } } } },
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT',
            evidence: {
              provenanceHeadSha: (await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir })).stdout.trim(),
            },
          } as never),
        },
        // Parity with the scripted fixture's resolver stub: the disposition
        // resolver derives the feature identity from the linked-worktree
        // layout, which this standalone temp repository does not have.
        // Derive the effective verdict from the aggregate alone; there are
        // no operator dispositions in a freshly seeded fixture.
        buildReviewEffectiveResolver: async (_root: string, aggregate: unknown) => {
          const effective = deriveEffectiveBuildReviewVerdict(aggregate);
          return effective
            ? {
                ok: true as const,
                feature: { version: 'v1' as const, repository: worktreeDir, feature: slug },
                effective,
              }
            : { ok: false as const, reason: 'fixture aggregate is invalid' };
        },
      });
      await runDaemon({
        discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
        runFeature: async (item) => {
          const events = new ConductorEventEmitter();
          events.on('step_started', (event) => {
            if (event.type === 'step_started') stepTracker.current = event.step;
          });
          const conductor = new Conductor({
            stateFilePath: statePath, stepRunner: runner, events, projectRoot: worktreeDir,
            fromStep: 'build', mode: 'auto', daemon: true, verifyArtifacts: false,
            fullSuiteVerifier: {
              ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
              inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
            },
            escalateBuildFailure: async () => ({}),
          });
          await conductor.run();
          return { slug: item.slug, status: 'done' };
        },
      }, { concurrency: 1, once: true });
    }, descriptor.providerKey);
    const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir });
    const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], { cwd: worktreeDir });
    const { stdout: changedFiles } = await execa('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir });
    assertSuccessfulCredentialedRun(provisioned, meter);
    expect({
      terminal: await hasSuccessfulTerminalState(worktreeDir, slug),
      madeCommit: commitSha.trim() !== baselineSha?.trim(),
      touchedFixture: changedFiles.split('\n').includes('test/fixtures/daemon-e2e/touched.txt'),
      taskTrailer: /(?:^|\n)Task:\s*1\s*$/m.test(commitBody),
    }).toEqual({ terminal: true, madeCommit: true, touchedFixture: true, taskTrailer: true });
  } catch (error) {
    await dumpPipelineDiagnostics(worktreeDir);
    throw error;
  } finally {
    console.info(`daemon E2E live smoke total tokens: ${meter.totalTokens}; dispatches: ${provisioned?.dispatches ?? 0}; cap: ${tokenCap}`);
    assertTokenCap(meter.totalTokens, meter.unmetered, tokenCap);
    await providerHome?.teardown();
    await rm(worktreeDir, { recursive: true, force: true });
  }
}
