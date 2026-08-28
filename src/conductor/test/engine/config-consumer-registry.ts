import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_CONSUMER_KEY_SETS } from '../../src/engine/config.js';

export interface ConsumerDeclaration {
  consumer: string | 'none';
  reason?: string;
}

export type ConfigKeySets = Record<string, readonly string[]>;

export function flattenedConfigKeys(sets: ConfigKeySets): string[] {
  return Object.entries(sets).flatMap(([block, keys]) =>
    keys.map((key) => (block === 'top' ? key : `${block}.${key}`)),
  );
}

const consumer = (path: string): ConsumerDeclaration => ({ consumer: path });
const none = (reason: string): ConsumerDeclaration => ({ consumer: 'none', reason });
const declarations = (
  block: string,
  keys: readonly string[],
  declaration: ConsumerDeclaration,
): Record<string, ConsumerDeclaration> => Object.fromEntries(
  keys.map((key) => [`${block}.${key}`, declaration]),
);

/**
 * The validator deliberately is not a consumer: listing it here would make a
 * key pass merely because it is accepted. Each path is the first production
 * seam that gives the setting an observable effect.
 */
const BLOCK_CONSUMERS: Record<string, ConsumerDeclaration> = {
  defaults: consumer('src/conductor/src/engine/resolved-config.ts'),
  phases: consumer('src/conductor/src/engine/resolved-config.ts'),
  steps: consumer('src/conductor/src/engine/steps.ts'),
  'steps.parallel': consumer('src/conductor/src/engine/conductor.ts'),
  'steps.by_tier': consumer('src/conductor/src/engine/resolved-config.ts'),
  conductor: consumer('bin/update'),
  harness_self_host: consumer('src/conductor/src/engine/resolved-config.ts'),
  harness_self_host_build_auth: consumer('src/conductor/src/engine/resolved-config.ts'),
  mergeable_autoresolve: consumer('src/conductor/src/engine/autoresolve.ts'),
  build_review: consumer('src/conductor/src/engine/build-review-coordinator.ts'),
  'build_review.rubrics': consumer('src/conductor/src/engine/build-review-coordinator.ts'),
  ci_watch: consumer('src/conductor/src/engine/mergeable-sweep.ts'),
  kickback_escalation: consumer('src/conductor/src/engine/conductor.ts'),
  cumulative_kickback_bound: consumer('src/conductor/src/engine/conductor.ts'),
  conflict_check: consumer('src/conductor/src/engine/resolved-config.ts'),
  prd_audit: consumer('src/conductor/src/engine/conductor.ts'),
  architecture_review_as_built: consumer('src/conductor/src/engine/as-built-policy.ts'),
  'architecture_review_as_built.remediation': consumer('src/conductor/src/engine/as-built-policy.ts'),
  'architecture_review_as_built.checks': consumer('src/conductor/src/engine/as-built-policy.ts'),
  assess: consumer('src/conductor/src/engine/resolved-config.ts'),
  test_suite: consumer('src/conductor/src/engine/full-suite-verifier.ts'),
  build_progress: consumer('src/conductor/src/engine/build-progress-watcher.ts'),
  provider_stream: consumer('src/conductor/src/engine/step-runners.ts'),
  build_progress_halt: consumer('src/conductor/src/engine/daemon.ts'),
  gate_code_validity: consumer('src/conductor/src/engine/gate-code-validity.ts'),
  retry_routing: consumer('src/conductor/src/engine/conductor.ts'),
  markdown_viewer: consumer('src/conductor/src/cli.ts'),
  mermaid_renderer: consumer('src/conductor/src/engine/render-cli.ts'),
};

const TOP_LEVEL_CONSUMERS: Record<string, ConsumerDeclaration> = {
  harness_version: consumer('src/conductor/src/engine/project-prelude.ts'),
  defaults: BLOCK_CONSUMERS.defaults,
  phases: BLOCK_CONSUMERS.phases,
  steps: BLOCK_CONSUMERS.steps,
  complexity: none('inert compatibility block after #1025 removed default_tier'),
  conductor: BLOCK_CONSUMERS.conductor,
  markdown_viewer: BLOCK_CONSUMERS.markdown_viewer,
  mermaid_renderer: BLOCK_CONSUMERS.mermaid_renderer,
  assess: BLOCK_CONSUMERS.assess,
  acceptance_spec_globs: consumer('src/conductor/src/engine/artifacts.ts'),
  test_suite: BLOCK_CONSUMERS.test_suite,
  llm_provider: consumer('src/conductor/src/engine/provider-selection.ts'),
  ui_renderer: consumer('src/conductor/src/engine/plugin-loader.ts'),
  memory_provider: consumer('src/conductor/src/engine/local-memory-provider.ts'),
  otel: consumer('src/conductor/src/engine/otel/otel-config.ts'),
  build_progress: BLOCK_CONSUMERS.build_progress,
  provider_stream: BLOCK_CONSUMERS.provider_stream,
  spec_owner: consumer('src/conductor/src/engine/owner-gate/identity.ts'),
  owner_gate_cutover: consumer('src/conductor/src/engine/conductor.ts'),
  attribution_audit_sample_pct: consumer('src/conductor/src/engine/attribution-telemetry.ts'),
  rebase_resolution_attempts: consumer('src/conductor/src/engine/conductor.ts'),
  validation_concurrency: consumer('src/conductor/src/engine/conductor.ts'),
  harness_self_host: BLOCK_CONSUMERS.harness_self_host,
  model_fallback_ladder: consumer('src/conductor/src/engine/provider-execution.ts'),
  auto_restart_on_stale_engine: consumer('src/conductor/src/engine/stale-engine-init.ts'),
  engine_refresh_min_interval_seconds: consumer('src/conductor/src/daemon-cli.ts'),
  codex_doctor_timeout_seconds: consumer('src/conductor/src/engine/plugin-loader.ts'),
  mergeable_autoresolve: BLOCK_CONSUMERS.mergeable_autoresolve,
  build_review: BLOCK_CONSUMERS.build_review,
  conflict_check: BLOCK_CONSUMERS.conflict_check,
  prd_audit: BLOCK_CONSUMERS.prd_audit,
  architecture_review_as_built: BLOCK_CONSUMERS.architecture_review_as_built,
  ci_watch: BLOCK_CONSUMERS.ci_watch,
  build_progress_halt: BLOCK_CONSUMERS.build_progress_halt,
  retry_routing: BLOCK_CONSUMERS.retry_routing,
  wiring: none('deprecated compatibility no-op; build_review owns wiring judgement (#1025)'),
  kickback_escalation: BLOCK_CONSUMERS.kickback_escalation,
  cumulative_kickback_bound: BLOCK_CONSUMERS.cumulative_kickback_bound,
  gate_code_validity: BLOCK_CONSUMERS.gate_code_validity,
  daemon_verbose: consumer('src/conductor/src/engine/daemon-deps.ts'),
  reconcile_parked_auto_cleanup: consumer('src/conductor/src/daemon-cli.ts'),
  step_heartbeat_stall_minutes: none('deprecated compatibility no-op; never grants termination authority (#1025)'),
  stale_claim_window_hours: consumer('src/conductor/src/engine/resolved-config.ts'),
  provider_preparation_timeout_minutes: consumer('src/conductor/src/engine/resolved-config.ts'),
  teardown_timeout_seconds: consumer('src/conductor/src/engine/resolved-config.ts'),
};

export const configConsumerRegistry: Record<string, ConsumerDeclaration> = {
  ...TOP_LEVEL_CONSUMERS,
  ...declarations('defaults', ['model', 'effort', 'max_retries', 'escalate'], BLOCK_CONSUMERS.defaults),
  ...declarations('phases', ['model', 'effort', 'max_retries', 'escalate', 'by_tier'], BLOCK_CONSUMERS.phases),
  ...declarations('steps', ['llm_provider', 'model', 'effort', 'max_retries', 'disable', 'escalate', 'skill', 'hooks', 'by_tier', 'after', 'enforcement', 'completion_artifact', 'gate', 'kickback_target', 'when', 'parallel'], BLOCK_CONSUMERS.steps),
  ...declarations('conductor', ['update_channel', 'auto_check', 'current_version', 'last_checked_at'], BLOCK_CONSUMERS.conductor),
  ...declarations('harness_self_host', ['activation', 'version_freeze', 'auth_park_timeout_minutes', 'build_auth', 'sandbox_build_env', 'live_containment', 'version_approval_gate', 'release_artifact_gate'], BLOCK_CONSUMERS.harness_self_host),
  ...declarations('harness_self_host_build_auth', ['mode', 'token_path'], BLOCK_CONSUMERS.harness_self_host_build_auth),
  ...declarations('mergeable_autoresolve', ['enabled', 'cooldownMinutes', 'suiteCommand'], BLOCK_CONSUMERS.mergeable_autoresolve),
  ...declarations('steps.parallel', ['name', 'skill', 'model', 'effort', 'advisory'], BLOCK_CONSUMERS['steps.parallel']),
  ...declarations('steps.by_tier', ['model', 'effort', 'max_retries'], BLOCK_CONSUMERS['steps.by_tier']),
  ...declarations('build_review', ['enabled', 'perTaskFloor', 'scopeContainmentEnforced', 'maxParallel', 'rubrics'], BLOCK_CONSUMERS.build_review),
  ...declarations('build_review.rubrics', ['enabled', 'llm_provider', 'model', 'effort', 'model_fallback_ladder', 'max_retries', 'escalate'], BLOCK_CONSUMERS['build_review.rubrics']),
  ...declarations('ci_watch', ['enabled', 'cooldownMinutes'], BLOCK_CONSUMERS.ci_watch),
  ...declarations('kickback_escalation', ['enabled'], BLOCK_CONSUMERS.kickback_escalation),
  ...declarations('cumulative_kickback_bound', ['enabled'], BLOCK_CONSUMERS.cumulative_kickback_bound),
  ...declarations('conflict_check', ['adr_corpus'], BLOCK_CONSUMERS.conflict_check),
  ...declarations('prd_audit', ['max_remediation_laps', 'max_appended_tasks', 'max_appended_ratio', 'halt_on_any_plan_gap'], BLOCK_CONSUMERS.prd_audit),
  ...declarations('architecture_review_as_built', ['checks', 'remediation', 'max_remediation_laps'], BLOCK_CONSUMERS.architecture_review_as_built),
  ...declarations('architecture_review_as_built.remediation', ['enabled'], BLOCK_CONSUMERS['architecture_review_as_built.remediation']),
  ...declarations('architecture_review_as_built.checks', ['tiers'], BLOCK_CONSUMERS['architecture_review_as_built.checks']),
  ...declarations('assess', ['stale_after_days', 'stale_after_commits'], BLOCK_CONSUMERS.assess),
  ...declarations('test_suite', ['command', 'scoped_command', 'working_directory', 'timeout_seconds', 'inputs', 'environment'], BLOCK_CONSUMERS.test_suite),
  ...declarations('build_progress', ['poll_seconds', 'quiet_minutes', 'heartbeat_minutes', 'enabled'], BLOCK_CONSUMERS.build_progress),
  ...declarations('provider_stream', ['min_interval_ms'], BLOCK_CONSUMERS.provider_stream),
  ...declarations('build_progress_halt', ['enabled', 'attempt_ceiling', 'dispatch_ceiling'], BLOCK_CONSUMERS.build_progress_halt),
  ...declarations('gate_code_validity', ['enabled'], BLOCK_CONSUMERS.gate_code_validity),
  ...declarations('retry_routing', ['enabled'], BLOCK_CONSUMERS.retry_routing),
  ...declarations('markdown_viewer', ['preset', 'command', 'args', 'mode'], BLOCK_CONSUMERS.markdown_viewer),
  ...declarations('mermaid_renderer', ['preset', 'command', 'args', 'mode'], BLOCK_CONSUMERS.mermaid_renderer),
};

export function assertRegistryCovers(
  sets: ConfigKeySets,
  registry: Record<string, ConsumerDeclaration>,
  repoRoot = resolve(process.cwd(), '../..'),
): void {
  const accepted = new Set(flattenedConfigKeys(sets));
  for (const key of accepted) {
    const declaration = registry[key];
    if (!declaration) throw new Error(`Config key is undeclared: ${key}`);
    if (declaration.consumer === 'none') {
      if (!declaration.reason?.trim()) throw new Error(`Config key ${key} is none without a reason`);
      continue;
    }
    if (!existsSync(resolve(repoRoot, declaration.consumer))) {
      throw new Error(`Config key ${key} has unresolvable consumer: ${declaration.consumer}`);
    }
  }
  for (const key of Object.keys(registry)) {
    if (!accepted.has(key)) throw new Error(`Config-key declaration is orphaned: ${key}`);
  }
}
