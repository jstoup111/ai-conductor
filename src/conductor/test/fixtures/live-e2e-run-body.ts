import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import type {
  AuthenticationReadiness,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
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
    const usage = result.tokenUsage;
    if (!usage || !Number.isFinite(usage.input) || !Number.isFinite(usage.output)) {
      this.unmetered += 1;
      this.unmeteredSteps.push(this.currentStep() ?? 'unattributed');
      return;
    }
    this.totalTokens += usage.input + usage.output;
    this.totalTurns += usage.numTurns ?? 0;
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

export const DEFAULT_LIVE_E2E_TOKEN_CAP = 100000;

/** Every descriptor enters through this shared cap policy. */
export function resolveLiveE2ETokenCap(environment: NodeJS.ProcessEnv = process.env): number {
  return Number(environment.DAEMON_E2E_LIVE_TOKEN_CAP ?? DEFAULT_LIVE_E2E_TOKEN_CAP);
}

export function reportLiveE2ESpend(
  metrics: { totalTokens: number; dispatches: number },
  cap: number,
  report: (message: string) => void = console.info,
): void {
  report(`daemon E2E live smoke observed total: ${metrics.totalTokens}; dispatch count: ${metrics.dispatches}; cap: ${cap}`);
}

/**
 * Keep the throwaway provider home alive for exactly one live-fixture run.
 * The fixture's checkout is deliberately outside this lifecycle: provider
 * initialization and teardown may only touch the isolated home.
 */
export async function withProvisionedLiveProviderHome<T>(
  sourceRoot: string,
  descriptor: LiveE2EProviderDescriptor,
  provider: LLMProvider,
  provision: typeof provisionLiveProviderHome,
  run: (home: ProviderHome) => Promise<T>,
): Promise<T> {
  const home = await provision(sourceRoot, descriptor, provider);
  try {
    return await run(home);
  } finally {
    await home.teardown();
  }
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

/**
 * Keep the spend limit outside the live leg so it is asserted after either a
 * successful return or an earlier failure from the provider/fixture.
 */
export async function enforceLiveE2ETokenCap<T>(
  run: () => Promise<T>,
  metrics: () => Pick<TokenMeter, 'totalTokens' | 'unmetered'>,
  cap: number,
): Promise<T> {
  try {
    return await run();
  } finally {
    const observed = metrics();
    assertTokenCap(observed.totalTokens, observed.unmetered, cap);
  }
}

const STEPS_ALLOWED_UNMETERED: readonly StepName[] = ['finish'];

export function assertSuccessfulCredentialedRun(
  provisioned: Pick<ProvisionedHome, 'dispatches'> | undefined,
  meter: Pick<TokenMeter, 'totalTurns' | 'totalTokens' | 'unmetered' | 'unmeteredSteps'>,
): void {
  if (meter.unmeteredSteps.includes('unattributed')) {
    throw new Error('Unattributable unmetered dispatch cannot be allow-listed.');
  }
  const disallowed = meter.unmeteredSteps.filter(
    (step) => !STEPS_ALLOWED_UNMETERED.includes(step as StepName),
  );
  if (disallowed.length > 0) {
    throw new Error(`Unmetered dispatch at ${disallowed[0]} before publication boundary.`);
  }
  expect(meter.unmeteredSteps.length).toBe(meter.unmetered);
  expect(provisioned?.dispatches ?? 0).toBeGreaterThan(0);
  expect(meter.totalTurns).toBeGreaterThan(0);
  expect(meter.totalTokens).toBeGreaterThan(0);
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
 * Provider descriptors own any provider-specific credential fallback. The
 * shared body only enforces that validation before construction or dispatch.
 */
export function assertLiveProviderCredential(
  descriptor: LiveE2EProviderDescriptor,
  credential: string | undefined,
): void {
  descriptor.assertCredentialAvailable(credential);
}

export function defineLiveE2EProviderSmoke(descriptor: LiveE2EProviderDescriptor): void {
  const shouldRun = liveProviderAvailable(descriptor);

  describe.skipIf(!shouldRun)(`daemon E2E with real ${descriptor.id} provider`, () => {
    it('finishes a seeded daemon fixture with a trailered task commit', async () => {
      await runLiveE2ERunBody(descriptor);
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

function readinessRemediation(readiness: Exclude<AuthenticationReadiness, { state: 'ready' }>): string {
  return readiness.state === 'probe-failed'
    ? 'Retry the Codex readiness probe.'
    : readiness.remediation ?? 'Restore the configured provider credential.';
}

/**
 * A live leg must not spend against a provider whose own readiness probe did
 * not affirmatively accept its selected authentication source.
 */
export async function assertLiveProviderReadiness(provider: LLMProvider): Promise<void> {
  const readiness = await provider.readiness?.();
  if (!readiness || readiness.state === 'ready') return;

  throw new Error(`Provider readiness is ${readiness.state}: ${readinessRemediation(readiness)}`);
}

function redactLiveE2ECredentialValues(value: unknown, credentialValues: readonly string[]): string {
  return credentialValues
    .filter((credential) => credential.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, credential) => redacted.split(credential).join('[redacted]'), String(value));
}

export async function dumpLiveE2EFailureDiagnostics(
  worktreeDir: string | undefined,
  credentialValues: readonly string[] = [],
): Promise<void> {
  if (!worktreeDir) {
    console.error('live worktree was not created; pipeline diagnostics unavailable.');
    return;
  }
  if (!existsSync(worktreeDir)) {
    console.error(`live worktree not found at ${worktreeDir}; pipeline diagnostics unavailable.`);
    return;
  }

  const logPath = join(worktreeDir, '.daemon/daemon.log');
  const daemonLog = await readFile(logPath, 'utf8').catch(() => null);
  if (daemonLog === null) {
    console.error(`daemon log not found at ${logPath}`);
  } else if (daemonLog.trim().length === 0) {
    console.error(`daemon log is empty at ${logPath}`);
  }

  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    originalError(...args.map((argument) => redactLiveE2ECredentialValues(argument, credentialValues)));
  };
  try {
    await dumpPipelineDiagnostics(worktreeDir);
  } catch {
    console.error('live E2E pipeline diagnostics failed; diagnostic details redacted.');
  } finally {
    console.error = originalError;
  }
}

function redactLiveE2EFailure(error: unknown, credentialValues: readonly string[]): Error {
  const message = redactLiveE2ECredentialValues(
    error instanceof Error ? error.message : error,
    credentialValues,
  );
  const redacted = new Error(message);
  if (error instanceof Error) redacted.name = error.name;
  return redacted;
}

async function runWithLiveE2EFailureDiagnostics<T>(
  resolveWorktreeDir: () => string | undefined,
  credentialValues: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await dumpLiveE2EFailureDiagnostics(resolveWorktreeDir(), credentialValues);
    throw redactLiveE2EFailure(error, credentialValues);
  }
}

export function withLiveE2EFailureDiagnostics<T>(
  worktreeDir: string | undefined,
  credentialValues: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  return runWithLiveE2EFailureDiagnostics(() => worktreeDir, credentialValues, run);
}

async function hasSuccessfulTerminalState(worktreeDir: string, slug: string): Promise<boolean> {
  return existsSync(join(worktreeDir, '.pipeline/DONE')) &&
    !existsSync(join(worktreeDir, '.pipeline/HALT')) &&
    !existsSync(join(worktreeDir, `.daemon/parked/${slug}`));
}

export async function runLiveE2ERunBody(
  descriptor: LiveE2EProviderDescriptor,
  tokenCap = resolveLiveE2ETokenCap(),
  dependencies: LiveE2ERunBodyDependencies = {},
): Promise<void> {
  const credential = process.env[descriptor.credentialEnvVar];
  let worktreeDir: string | undefined;
  const slug = 'daemon-e2e-live';
  let meter: TokenMeter | undefined;
  let provisioned: ProvisionedHome | undefined;
  let baselineSha: string | undefined;

  try {
    return await runWithLiveE2EFailureDiagnostics(() => worktreeDir, [credential ?? ''], async () => {
    assertLiveProviderBinary(descriptor, dependencies.binaryAvailable);
    assertLiveProviderCredential(descriptor, credential);
    worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-'));
    const pipelineDir = join(worktreeDir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    const planPath = join(worktreeDir, `.docs/plans/${slug}.md`);
    const provider = createLiveProvider(descriptor, credential);
    meter = new TokenMeter(provider);
    await assertDescriptorAuthenticationSource(descriptor, provider);
    await assertLiveProviderReadiness(provider);
    return await enforceLiveE2ETokenCap(async () => {
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeUndefined();
        await initTestRepo(worktreeDir);
        await mkdir(join(worktreeDir, '.docs/plans'), { recursive: true });
        await mkdir(join(worktreeDir, '.docs/stories'), { recursive: true });
        await mkdir(join(worktreeDir, 'test/fixtures/daemon-e2e'), { recursive: true });
        await copyFile(fixturePlanPath, planPath);
        await copyFile(fixtureStoriesPath, join(worktreeDir, `.docs/stories/${slug}.md`));
        await withProvisionedLiveProviderHome(
      fileURLToPath(new URL('../../../../', import.meta.url)),
      descriptor,
      provider,
      dependencies.provisionProviderHome ?? provisionLiveProviderHome,
      async (providerHome) => {
        provisioned = new ProvisionedHome(provider, {
          executable: descriptor.selfHostExecutable,
          env: providerHome.childEnv(),
          args: providerHome.childArgs(),
          teardown: () => providerHome.teardown(),
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
      },
        );
    }, () => meter!, tokenCap);
    });
  } finally {
    if (meter) {
      reportLiveE2ESpend({
        totalTokens: meter.totalTokens,
        dispatches: provisioned?.dispatches ?? 0,
      }, tokenCap);
    }
    if (worktreeDir) await rm(worktreeDir, { recursive: true, force: true });
  }
}
