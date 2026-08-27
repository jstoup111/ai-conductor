import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_CONSUMER_KEY_SETS } from './config.js';

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

/**
 * The validator deliberately is not a consumer: listing it here would make a
 * key pass merely because it is accepted. Keep these declarations at the
 * first production seam that gives each setting observable effect.
 */
export const configConsumerRegistry: Record<string, ConsumerDeclaration> = {
  harness_version: consumer('src/conductor/src/engine/project-prelude.ts'),
  defaults: consumer('src/conductor/src/engine/resolved-config.ts'),
  phases: consumer('src/conductor/src/engine/resolved-config.ts'),
  steps: consumer('src/conductor/src/engine/steps.ts'),
  complexity: { consumer: 'none', reason: 'inert compatibility block after #1025 removed default_tier' },
  conductor: consumer('src/conductor/src/cli.ts'),
  markdown_viewer: consumer('src/conductor/src/cli.ts'),
  mermaid_renderer: consumer('src/conductor/src/engine/render-cli.ts'),
  assess: consumer('src/conductor/src/engine/resolved-config.ts'),
  acceptance_spec_globs: consumer('src/conductor/src/engine/artifacts.ts'),
  test_suite: consumer('src/conductor/src/engine/full-suite-verifier.ts'),
  llm_provider: consumer('src/conductor/src/engine/provider-selection.ts'),
  ui_renderer: consumer('src/conductor/src/engine/plugin-loader.ts'),
  memory_provider: consumer('src/conductor/src/engine/local-memory-provider.ts'),
  otel: consumer('src/conductor/src/engine/otel/otel-config.ts'),
  build_progress: consumer('src/conductor/src/engine/build-progress-watcher.ts'),
  provider_stream: consumer('src/conductor/src/engine/step-runners.ts'),
  spec_owner: consumer('src/conductor/src/engine/owner-gate/identity.ts'),
  owner_gate_cutover: consumer('src/conductor/src/engine/conductor.ts'),
  attribution_audit_sample_pct: consumer('src/conductor/src/engine/attribution-telemetry.ts'),
  rebase_resolution_attempts: consumer('src/conductor/src/engine/conductor.ts'),
  validation_concurrency: consumer('src/conductor/src/engine/conductor.ts'),
  harness_self_host: consumer('src/conductor/src/engine/resolved-config.ts'),
  model_fallback_ladder: consumer('src/conductor/src/engine/provider-execution.ts'),
  auto_restart_on_stale_engine: consumer('src/conductor/src/engine/stale-engine-init.ts'),
  engine_refresh_min_interval_seconds: consumer('src/conductor/src/daemon-cli.ts'),
  codex_doctor_timeout_seconds: consumer('src/conductor/src/engine/plugin-loader.ts'),
  mergeable_autoresolve: consumer('src/conductor/src/engine/autoresolve.ts'),
  build_review: consumer('src/conductor/src/engine/build-review-coordinator.ts'),
  conflict_check: consumer('src/conductor/src/engine/resolved-config.ts'),
  prd_audit: consumer('src/conductor/src/engine/conductor.ts'),
  architecture_review_as_built: consumer('src/conductor/src/engine/as-built-policy.ts'),
  ci_watch: consumer('src/conductor/src/engine/mergeable-sweep.ts'),
  build_progress_halt: consumer('src/conductor/src/engine/daemon.ts'),
  retry_routing: consumer('src/conductor/src/engine/conductor.ts'),
  wiring: consumer('src/conductor/src/engine/conductor.ts'),
  kickback_escalation: consumer('src/conductor/src/engine/conductor.ts'),
  cumulative_kickback_bound: consumer('src/conductor/src/engine/conductor.ts'),
  gate_code_validity: consumer('src/conductor/src/engine/gate-code-validity.ts'),
  daemon_verbose: consumer('src/conductor/src/engine/daemon-deps.ts'),
  reconcile_parked_auto_cleanup: consumer('src/conductor/src/daemon-cli.ts'),
  step_heartbeat_stall_minutes: consumer('src/conductor/src/engine/step-heartbeat.ts'),
  stale_claim_window_hours: consumer('src/conductor/src/engine/resolved-config.ts'),
  provider_preparation_timeout_minutes: consumer('src/conductor/src/engine/resolved-config.ts'),
  teardown_timeout_seconds: consumer('src/conductor/src/engine/resolved-config.ts'),

  'defaults.model': consumer('src/conductor/src/engine/resolved-config.ts'),
  'defaults.effort': consumer('src/conductor/src/engine/resolved-config.ts'),
  'defaults.max_retries': consumer('src/conductor/src/engine/resolved-config.ts'),
  'defaults.escalate': consumer('src/conductor/src/engine/resolved-config.ts'),
  'phases.model': consumer('src/conductor/src/engine/resolved-config.ts'),
  'phases.effort': consumer('src/conductor/src/engine/resolved-config.ts'),
  'phases.max_retries': consumer('src/conductor/src/engine/resolved-config.ts'),
  'phases.escalate': consumer('src/conductor/src/engine/resolved-config.ts'),
  'phases.by_tier': consumer('src/conductor/src/engine/resolved-config.ts'),

  'steps.llm_provider': consumer('src/conductor/src/engine/provider-selection.ts'),
  'steps.model': consumer('src/conductor/src/engine/resolved-config.ts'),
  'steps.effort': consumer('src/conductor/src/engine/resolved-config.ts'),
  'steps.max_retries': consumer('src/conductor/src/engine/resolved-config.ts'),
  'steps.disable': consumer('src/conductor/src/engine/steps.ts'),
  'steps.escalate': consumer('src/conductor/src/engine/resolved-config.ts'),
  'steps.skill': consumer('src/conductor/src/engine/skill-resolver.ts'),
  'steps.hooks': consumer('src/conductor/src/engine/hooks.ts'),
  'steps.by_tier': consumer('src/conductor/src/engine/resolved-config.ts'),
  'steps.after': consumer('src/conductor/src/engine/steps.ts'),
  'steps.enforcement': consumer('src/conductor/src/engine/steps.ts'),
  'steps.completion_artifact': consumer('src/conductor/src/engine/artifacts.ts'),
  'steps.gate': consumer('src/conductor/src/engine/steps.ts'),
  'steps.kickback_target': consumer('src/conductor/src/engine/steps.ts'),
  'steps.when': consumer('src/conductor/src/engine/steps.ts'),
  'steps.parallel': consumer('src/conductor/src/engine/steps.ts'),

  'conductor.update_channel': consumer('src/conductor/src/cli.ts'),
  'conductor.auto_check': consumer('src/conductor/src/cli.ts'),
  'conductor.current_version': consumer('src/conductor/src/cli.ts'),
  'conductor.last_checked_at': consumer('src/conductor/src/cli.ts'),
  'harness_self_host.activation': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.version_freeze': consumer('src/conductor/src/engine/self-host/version-gate.ts'),
  'harness_self_host.auth_park_timeout_minutes': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.build_auth': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.sandbox_build_env': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.live_containment': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.version_approval_gate': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host.release_artifact_gate': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host_build_auth.mode': consumer('src/conductor/src/engine/resolved-config.ts'),
  'harness_self_host_build_auth.token_path': consumer('src/conductor/src/engine/resolved-config.ts'),
  'mergeable_autoresolve.enabled': consumer('src/conductor/src/engine/autoresolve.ts'),
  'mergeable_autoresolve.cooldownMinutes': consumer('src/conductor/src/engine/autoresolve.ts'),
  'mergeable_autoresolve.suiteCommand': consumer('src/conductor/src/engine/autoresolve.ts'),
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
