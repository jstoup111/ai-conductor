import { readFile, rename, mkdir } from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import {
  join,
  isAbsolute,
  normalize,
  resolve as resolvePath,
  dirname,
  relative,
  sep,
} from 'path';
import { load as loadYaml } from 'js-yaml';
import type {
  HarnessConfig,
  StepConfig,
  EffortLevel,
  MarkdownViewerConfig,
  MermaidRendererConfig,
  BuildProgressConfig,
} from '../types/config.js';
import type { StepName, EnforcementLevel } from '../types/index.js';
import { ALL_STEPS } from './steps.js';
import { readUserConfig } from './user-config.js';
import { VALID_MARKDOWN_VIEWER_MODES } from './md-viewer-presets.js';
import { VALID_MERMAID_RENDERER_MODES } from './mermaid-renderer-presets.js';
import { validateWhenSyntax } from './when-expression.js';
import type { PluginRegistry } from './plugin-registry.js';
import { FALLBACK_RETRIES } from './resolved-config.js';
import { resolveProviderModelPolicy } from './provider-model-policy.js';

export type ConfigError = {
  type: 'missing' | 'parse_error' | 'version_mismatch' | 'validation_error';
  message: string;
};

export type ConfigWarning = string;

type KeySpec = {
  key: string;
  isValid: (value: unknown) => boolean;
};

export type ConfigResult =
  | { ok: true; config: HarnessConfig; warnings: ConfigWarning[] }
  | { ok: false; error: ConfigError };

const VALID_PHASES = new Set(['SETUP', 'UNDERSTAND', 'DECIDE', 'BUILD', 'SHIP']);
const VALID_EFFORTS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max']);
const VALID_ENFORCEMENTS = new Set<EnforcementLevel>(['structural', 'advisory', 'gating']);
const BUILT_IN_MODEL_PROVIDERS = new Set(['claude', 'codex']);

function normalizeKeyedBlock(
  blockName: string,
  raw: unknown,
  specs: readonly KeySpec[],
  warnings: ConfigWarning[],
): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const specByKey = new Map(specs.map((spec) => [spec.key, spec]));
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const spec = specByKey.get(key);
    if (!spec) {
      warnings.push(`Unknown key in ${blockName}: "${key}"`);
    } else if (spec.isValid(value)) {
      normalized[key] = value;
    } else {
      warnings.push(
        `${blockName}.${key} has invalid value ${JSON.stringify(value)}, omitting.`,
      );
    }
  }
  return normalized;
}

function validateTddModelConfig(
  value: unknown,
  path: string,
  providerKey: string,
): ConfigError | undefined {
  if (!isPlainObject(value)) return { type: 'validation_error', message: `${path} must be an object` };
  if (!BUILT_IN_MODEL_PROVIDERS.has(providerKey)) {
    return {
      type: 'validation_error',
      message: `${path} requires llm_provider to be one of: claude, codex; provider "${providerKey}" has no native TDD model policy.`,
    };
  }

  const config = value as Record<string, unknown>;
  for (const phase of Object.keys(config)) {
    if (phase !== 'red' && phase !== 'green') {
      return { type: 'validation_error', message: `Unknown key in ${path}: "${phase}"` };
    }
  }

  const nativeModels = new Set(resolveProviderModelPolicy(providerKey).modelEscalationOrder);
  for (const phase of ['red', 'green']) {
    const phaseValue = config[phase];
    if (phaseValue === undefined) continue;
    const phasePath = `${path}.${phase}`;
    if (!isPlainObject(phaseValue)) {
      return { type: 'validation_error', message: `${phasePath} must be an object` };
    }
    const phaseConfig = phaseValue as Record<string, unknown>;
    for (const key of Object.keys(phaseConfig)) {
      if (key !== 'model') {
        return { type: 'validation_error', message: `Unknown key in ${phasePath}: "${key}"` };
      }
    }
    if (typeof phaseConfig.model !== 'string' || phaseConfig.model.trim() === '') {
      return { type: 'validation_error', message: `${phasePath}.model must be a non-empty string` };
    }
    if (!nativeModels.has(phaseConfig.model)) {
      return {
        type: 'validation_error',
        message: `${phasePath}.model must be a native ${providerKey} model (${[...nativeModels].join(', ')}).`,
      };
    }
  }
  return undefined;
}

export const PROJECT_CONFIG_DIR = '.ai-conductor';
export const PROJECT_CONFIG_FILE = 'config.yml';
export const LEGACY_PROJECT_CONFIG_DIR = '.harness';

export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

export function legacyProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

/**
 * One-shot, idempotent relocation of legacy .harness/config.yml into
 * .ai-conductor/config.yml. Only moves the file when the new location is
 * absent and the legacy file is readable; on any failure it leaves both
 * files alone so callers can surface a clean error.
 */
export async function migrateLegacyProjectConfig(projectRoot: string): Promise<boolean> {
  const newPath = projectConfigPath(projectRoot);
  const oldPath = legacyProjectConfigPath(projectRoot);
  if (existsSync(newPath) || !existsSync(oldPath)) return false;
  try {
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(
  projectRoot: string,
  harnessVersion?: string,
): Promise<ConfigResult> {
  return loadProjectConfig(projectRoot, harnessVersion, true);
}

async function loadProjectConfig(
  projectRoot: string,
  harnessVersion: string | undefined,
  materializeDefaults: boolean,
): Promise<ConfigResult> {
  // One-shot: relocate legacy .harness/config.yml into .ai-conductor/ on first
  // call. Idempotent — no-op if the new location already exists or legacy is
  // absent.
  await migrateLegacyProjectConfig(projectRoot);

  const configPath = projectConfigPath(projectRoot);

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: {
        type: 'missing',
        message: `Config file not found: ${configPath}. Run conduct-ts config init to create it.`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(raw);
  } catch (e: unknown) {
    let message = 'Failed to parse YAML';
    if (e instanceof Error) {
      message = e.message;
      const yamlErr = e as Error & { mark?: { line?: number } };
      if (yamlErr.mark && typeof yamlErr.mark.line === 'number') {
        message = `YAML parse error at line ${yamlErr.mark.line + 1}: ${e.message}`;
      }
    }
    return { ok: false, error: { type: 'parse_error', message } };
  }

  const validation = validateConfig(parsed, projectRoot, {
    source: 'project',
    materializeDefaults,
  });
  if (!validation.ok) return validation;

  if (harnessVersion && validation.config.harness_version) {
    if (!satisfiesVersion(harnessVersion, validation.config.harness_version)) {
      return {
        ok: false,
        error: {
          type: 'version_mismatch',
          message: `Harness version ${harnessVersion} does not satisfy constraint ${validation.config.harness_version}`,
        },
      };
    }
  }

  return validation;
}

/**
 * `source` distinguishes WHERE the config being validated came from, which
 * controls the anti-leak guard (D2). `'project'` — a raw committed
 * `.ai-conductor/config.yml`: a present `spec_owner` is REJECTED (identity must
 * never live in shared repo state). `'merged'` (default) — user config merged
 * under project, or a standalone validation: `spec_owner` is allowed because it
 * legitimately originates from the user's machine config.
 */
export interface ValidateConfigOpts {
  source?: 'project' | 'merged';
  materializeDefaults?: boolean;
}

export function validateConfig(
  raw: unknown,
  projectRoot?: string,
  opts: ValidateConfigOpts = {},
): ConfigResult {
  const materializeDefaults = opts.materializeDefaults ?? true;

  if (raw === null || raw === undefined) {
    return { ok: true, config: {}, warnings: [] };
  }

  if (typeof raw !== 'object') {
    return {
      ok: false,
      error: { type: 'validation_error', message: 'Config must be an object' },
    };
  }

  const obj = cloneForValidation(raw) as Record<string, unknown>;
  const warnings: ConfigWarning[] = [];

  const knownTopLevelKeys = new Set([
    'harness_version',
    'defaults',
    'phases',
    'steps',
    'complexity',
    'conductor',
    'markdown_viewer',
    'mermaid_renderer',
    'assess',
    'acceptance_spec_globs',
    'test_suite',
    // Plugin selections (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration/adr-2026-06-29-per-project-memory-provider-selection)
    'llm_provider',
    'ui_renderer',
    'memory_provider',
    // Observability
    'otel',
    // Intra-step build progress events (poll/quiet/heartbeat cadence).
    'build_progress',
    // Owner-gate (adr-2026-06-30-*): operator identity + grandfather cutover.
    'spec_owner',
    'owner_gate_cutover',
    'attribution_audit_sample_pct',
    // Rebase auto-resolution attempt cap (rebase-resolution-skill).
    'rebase_resolution_attempts',
    // Bounds the validation-phase fan-out concurrency.
    'validation_concurrency',
    // Self-host guardrails (adr-2026-06-30-self-host-detection-seam).
    'harness_self_host',
    // Model availability fallback ladder.
    'model_fallback_ladder',
    // Daemon auto-restart on stale engine.
    'auto_restart_on_stale_engine',
    // Minimum interval between engine-refresh (origin fetch) attempts.
    'engine_refresh_min_interval_seconds',
    // Maximum time to wait for the Codex readiness doctor command.
    'codex_doctor_timeout_seconds',
    // Auto-resolve merge conflicts on open PRs.
    'mergeable_autoresolve',
    // Opt-in judgement gate at the build → manual_test seam.
    'build_review',
    // CI watch feature (adr-2026-07-07-ship-ci-feedback-loop).
    'ci_watch',
    // Progress-aware build halt/park decision (daemon-halts-a-build-that-is-making-forward-progre).
    'build_progress_halt',
    // Retry-routing kill-switch (retry-classify-rerun-vs-route).
    'retry_routing',
    // Wiring-reachability gate Layer 2 (TS import-graph reachability).
    'wiring',
    // Kickback→build no-op escalation (adr-2026-07-13-kickback-build-no-op-escalation).
    'kickback_escalation',
    // Default-off verbose skip logging in gate-writeback (daemon-suppress-other-owner-log-noise).
    'daemon_verbose',
    // Removes parked feature worktrees after reconciliation by default.
    'reconcile_parked_auto_cleanup',
    // Deprecated heartbeat compatibility no-op; retained so legacy configs load.
    'step_heartbeat_stall_minutes',
    // Stale-claim reap window override (engineer-unclaim-requeue-verb-stale-claimed-ledger).
    'stale_claim_window_hours',
    // Provider lifecycle preparation deadline.
    'provider_preparation_timeout_minutes',
  ]);
  for (const key of Object.keys(obj)) {
    if (!knownTopLevelKeys.has(key)) {
      return errVal(`Unknown top-level key: "${key}"`);
    }
  }

  const providerSelectionErr = validateProviderSelection(obj.llm_provider, 'llm_provider');
  if (providerSelectionErr) return { ok: false, error: providerSelectionErr };

  // defaults
  if (obj.defaults !== undefined) {
    const err = validateEffortAndModelBag(obj.defaults, 'defaults');
    if (err) return { ok: false, error: err };
  }

  // phases
  if (obj.phases !== undefined) {
    if (!isPlainObject(obj.phases)) {
      return {
        ok: false,
        error: { type: 'validation_error', message: 'phases must be an object' },
      };
    }
    for (const [phase, value] of Object.entries(obj.phases)) {
      if (!VALID_PHASES.has(phase)) {
        return errVal(`Unknown phase: "${phase}"`);
      }
      const err = validateEffortAndModelBag(value, `phases.${phase}`);
      if (err) return { ok: false, error: err };
    }
  }

  // steps
  if (obj.steps !== undefined) {
    if (!isPlainObject(obj.steps)) {
      return {
        ok: false,
        error: { type: 'validation_error', message: 'steps must be an object' },
      };
    }

    const builtInNames = new Set(ALL_STEPS.map((s) => s.name));
    const stepDefs = new Map(ALL_STEPS.map((s) => [s.name, s]));
    // Collect all custom-step names up-front so a custom can legally point
    // `after` at a sibling custom (chain ordering). Validation still rejects
    // references that don't resolve to either built-in or declared custom.
    const customStepNames = new Set<string>();
    for (const [n, v] of Object.entries(obj.steps as Record<string, unknown>)) {
      if (!builtInNames.has(n as StepName) && isPlainObject(v)) {
        customStepNames.add(n);
      }
    }

    for (const [name, value] of Object.entries(obj.steps as Record<string, unknown>)) {
      if (!isPlainObject(value)) {
        return {
          ok: false,
          error: {
            type: 'validation_error',
            message: `steps.${name} must be an object`,
          },
        };
      }
      const cfg = value as Record<string, unknown>;
      const knownStepKeys = new Set([
        'llm_provider',
        'model',
        'effort',
        'max_retries',
        'disable',
        'escalate',
        'skill',
        'hooks',
        'by_tier',
        'after',
        'enforcement',
        'completion_artifact',
        'when',
        'parallel',
        'tdd',
      ]);
      for (const k of Object.keys(cfg)) {
        if (!knownStepKeys.has(k)) {
          return errVal(`Unknown key in steps.${name}: "${k}"`);
        }
      }

      // Common validations
      const stepProviderSelectionErr = validateProviderSelection(
        cfg.llm_provider,
        `steps.${name}.llm_provider`,
      );
      if (stepProviderSelectionErr) {
        return { ok: false, error: stepProviderSelectionErr };
      }
      if (cfg.effort !== undefined && !VALID_EFFORTS.has(cfg.effort as EffortLevel)) {
        return errVal(`steps.${name}.effort must be low|medium|high|xhigh|max`);
      }
      if (cfg.by_tier !== undefined) {
        const byTierErr = validateByTier(cfg.by_tier, `steps.${name}.by_tier`);
        if (byTierErr) return { ok: false, error: byTierErr };
      }
      if (cfg.max_retries !== undefined && typeof cfg.max_retries !== 'number') {
        return errVal(`steps.${name}.max_retries must be a number`);
      }
      if (cfg.disable !== undefined && typeof cfg.disable !== 'boolean') {
        return errVal(`steps.${name}.disable must be a boolean`);
      }
      if (cfg.escalate !== undefined && typeof cfg.escalate !== 'boolean') {
        return errVal(`steps.${name}.escalate must be a boolean`);
      }
      if (cfg.model !== undefined && typeof cfg.model !== 'string') {
        return errVal(`steps.${name}.model must be a string`);
      }
      if (cfg.skill !== undefined && typeof cfg.skill !== 'string') {
        return errVal(`steps.${name}.skill must be a string path`);
      }
      if (cfg.tdd !== undefined) {
        if (name !== 'build') {
          return errVal(`steps.${name}.tdd is only valid for the build step`);
        }
        if (obj.llm_provider !== undefined && typeof obj.llm_provider !== 'string') {
          return errVal('steps.build.tdd requires llm_provider to be a string');
        }
        const providerKey = typeof obj.llm_provider === 'string' ? obj.llm_provider : 'claude';
        const tddErr = validateTddModelConfig(cfg.tdd, `steps.${name}.tdd`, providerKey);
        if (tddErr) return { ok: false, error: tddErr };
      }
      if (cfg.hooks !== undefined) {
        if (!isPlainObject(cfg.hooks)) {
          return errVal(`steps.${name}.hooks must be an object`);
        }
        const hooks = cfg.hooks as Record<string, unknown>;
        for (const h of ['before', 'after']) {
          if (hooks[h] !== undefined && typeof hooks[h] !== 'string') {
            return errVal(`steps.${name}.hooks.${h} must be a string path`);
          }
        }
      }

      // Validate when: syntax at config-load time (T8 / T13)
      if (cfg.when !== undefined) {
        if (typeof cfg.when !== 'string') {
          return errVal(`steps.${name}.when must be a string expression`);
        }
        const syntaxErr = validateWhenSyntax(cfg.when);
        if (syntaxErr) {
          return errVal(`steps.${name}.when: ${syntaxErr}`);
        }
      }

      // Validate parallel: structure (T13)
      if (cfg.parallel !== undefined) {
        if (!Array.isArray(cfg.parallel)) {
          return errVal(`steps.${name}.parallel must be an array`);
        }
        if (cfg.skill !== undefined) {
          return errVal(
            `steps.${name}: "skill" and "parallel" are mutually exclusive`,
          );
        }
        const branchNames = new Set<string>();
        for (let bi = 0; bi < (cfg.parallel as unknown[]).length; bi++) {
          const branch = (cfg.parallel as unknown[])[bi];
          if (!isPlainObject(branch)) {
            return errVal(`steps.${name}.parallel[${bi}] must be an object`);
          }
          const b = branch as Record<string, unknown>;
          const knownBranchKeys = new Set(['name', 'skill', 'model', 'effort', 'advisory']);
          for (const bk of Object.keys(b)) {
            if (!knownBranchKeys.has(bk)) {
              return errVal(`Unknown key in steps.${name}.parallel[${bi}]: "${bk}"`);
            }
          }
          if (typeof b.name !== 'string' || !b.name) {
            return errVal(`steps.${name}.parallel[${bi}].name must be a non-empty string`);
          }
          if (branchNames.has(b.name)) {
            return errVal(
              `steps.${name}.parallel has duplicate branch name: "${b.name}"`,
            );
          }
          branchNames.add(b.name);
          if (b.skill !== undefined && typeof b.skill !== 'string') {
            return errVal(`steps.${name}.parallel[${bi}].skill must be a string`);
          }
          if (b.model !== undefined && typeof b.model !== 'string') {
            return errVal(`steps.${name}.parallel[${bi}].model must be a string`);
          }
          if (b.effort !== undefined && !VALID_EFFORTS.has(b.effort as EffortLevel)) {
            return errVal(`steps.${name}.parallel[${bi}].effort must be low|medium|high|xhigh|max`);
          }
          if (b.advisory !== undefined && typeof b.advisory !== 'boolean') {
            return errVal(`steps.${name}.parallel[${bi}].advisory must be a boolean`);
          }
        }
      }

      const isCustom = !builtInNames.has(name as StepName);

      if (isCustom) {
        if (cfg.completion_artifact !== undefined) {
          const field = `steps.${name}.completion_artifact`;
          if (
            typeof cfg.completion_artifact !== 'string' ||
            cfg.completion_artifact.trim() === ''
          ) {
            return errVal(`${field} must be a non-empty string`);
          }
          const artifact = cfg.completion_artifact;
          if (isAbsolute(artifact)) return errVal(`${field} must be repository-relative`);
          if (!artifact.startsWith('.pipeline/')) {
            return errVal(`${field} must be under .pipeline/`);
          }
          if (artifact.split(/[\\/]/).includes('..')) {
            return errVal(`${field} must not contain traversal segments`);
          }
          if (/[*?[\]{}]/.test(artifact)) {
            return errVal(`${field} must be an exact file path without glob syntax`);
          }
          if (artifact.endsWith('/')) {
            return errVal(`${field} must name a file under .pipeline/`);
          }
          if (normalize(artifact) !== artifact) return errVal(`${field} must be normalized`);
        }

        // Custom steps need both `after` and `skill`.
        if (typeof cfg.after !== 'string') {
          return errVal(`Custom step "${name}" requires 'after: <existing-step>'`);
        }
        const afterTarget = cfg.after as string;
        const isBuiltIn = builtInNames.has(afterTarget as StepName);
        const isSiblingCustom = customStepNames.has(afterTarget) && afterTarget !== name;
        if (!isBuiltIn && !isSiblingCustom) {
          return errVal(
            `Custom step "${name}" references unknown after target: "${afterTarget}"`,
          );
        }
        if (typeof cfg.skill !== 'string') {
          return errVal(`Custom step "${name}" requires 'skill: <path-to-SKILL.md>'`);
        }
        if (cfg.enforcement !== undefined && !VALID_ENFORCEMENTS.has(cfg.enforcement as EnforcementLevel)) {
          return errVal(
            `Custom step "${name}".enforcement must be structural|advisory|gating`,
          );
        }
        if (projectRoot && typeof cfg.skill === 'string') {
          const skillPath = isAbsolute(cfg.skill)
            ? cfg.skill
            : resolvePath(projectRoot, cfg.skill);
          if (!existsSync(skillPath)) {
            return errVal(
              `Custom step "${name}" skill file not found: ${skillPath}`,
            );
          }
        }
      } else {
        // Built-in step: 'after' / 'enforcement' are not permitted — they're
        // built-in-step-only fields. Fail fast so the user sees the bad key.
        if (cfg.after !== undefined) {
          return errVal(`steps.${name}.after is not valid for built-in steps`);
        }
        if (cfg.enforcement !== undefined) {
          return errVal(`steps.${name}.enforcement is not valid for built-in steps`);
        }
        if (cfg.completion_artifact !== undefined) {
          return errVal(`steps.${name}.completion_artifact is not valid for built-in steps`);
        }

        // Disabling a gating/structural built-in is not allowed, unless the
        // step definition explicitly opts in via `configDisableAllowed`
        // (per-step, deliberate — an explicit committed config disable is not
        // the silent-skip failure mode the gating promotion guards against).
        // Structural steps can never be disabled.
        const def = stepDefs.get(name as StepName);
        if (cfg.disable === true && def) {
          if (
            def.enforcement === 'structural' ||
            (def.enforcement === 'gating' && def.configDisableAllowed !== true)
          ) {
            return errVal(
              `Cannot disable ${def.enforcement} step: "${name}". Only advisory steps may be disabled.`,
            );
          }
        }
      }
    }
  }

  // complexity
  if (obj.complexity !== undefined) {
    if (!isPlainObject(obj.complexity)) {
      return errVal('complexity must be an object');
    }
    const cx = obj.complexity as Record<string, unknown>;
    const VALID_TIERS = new Set(['S', 'M', 'L']);
    if (cx.default_tier !== undefined && !VALID_TIERS.has(cx.default_tier as string)) {
      return errVal('complexity.default_tier must be S|M|L');
    }
  }

  // conductor (user-level global state)
  if (obj.conductor !== undefined) {
    const err = validateConductorBlock(obj.conductor);
    if (err) return { ok: false, error: err };
  }

  // markdown_viewer
  if (obj.markdown_viewer !== undefined) {
    const err = validateMarkdownViewerBlock(obj.markdown_viewer);
    if (err) return { ok: false, error: err };
  }

  // mermaid_renderer
  if (obj.mermaid_renderer !== undefined) {
    const err = validateMermaidRendererBlock(obj.mermaid_renderer);
    if (err) return { ok: false, error: err };
  }

  // assess
  if (obj.assess !== undefined) {
    const err = validateAssessBlock(obj.assess);
    if (err) return { ok: false, error: err };
  }

  // daemon_verbose — controls default-off verbose skip logging in gate-writeback.
  // Absent is allowed; the default-off behavior is applied at the wiring site.
  if (obj.daemon_verbose !== undefined && typeof obj.daemon_verbose !== 'boolean') {
    return errVal('daemon_verbose must be a boolean');
  }

  // reconcile_parked_auto_cleanup — parked feature worktree cleanup policy.
  // Absent → enabled by default; malformed values are hard configuration errors.
  if (obj.reconcile_parked_auto_cleanup !== undefined) {
    if (typeof obj.reconcile_parked_auto_cleanup !== 'boolean') {
      return errVal('reconcile_parked_auto_cleanup must be a boolean');
    }
  } else if (materializeDefaults) {
    obj.reconcile_parked_auto_cleanup = true;
  }

  // mergeable_autoresolve
  if (obj.mergeable_autoresolve !== undefined) {
    const err = validateMergeableAutoresolveBlock(obj.mergeable_autoresolve);
    if (err) return { ok: false, error: err };
  }

  // acceptance_spec_globs — list of extra globs for the acceptance_specs gate.
  if (obj.acceptance_spec_globs !== undefined) {
    if (!Array.isArray(obj.acceptance_spec_globs)) {
      return errVal('acceptance_spec_globs must be an array of strings');
    }
    if (!obj.acceptance_spec_globs.every((g) => typeof g === 'string')) {
      return errVal('acceptance_spec_globs must contain only strings');
    }
  }

  // test_suite — the project-owned aggregate verification operation.
  if (obj.test_suite !== undefined) {
    const err = validateTestSuiteBlock(obj.test_suite, projectRoot);
    if (err) return { ok: false, error: err };
  }

  // spec_owner — the daemon operator identity (owner-gate, FR-1). Naming
  // boundary (ADR-1): the operator concept, never the lock holder.
  //
  // Anti-leak guard (D2 / Story 2): operator identity is MACHINE-scoped — it may
  // only live in the user config (~/.ai-conductor/config.yml). A `spec_owner`
  // committed into a shared PROJECT config would leak one operator's identity to
  // everyone who pulls (mergeConfigs gives project precedence). So on the
  // project-source path a PRESENT key — blank or not — is a hard rejection that
  // names the file and the fix. On the merged/user path spec_owner is legitimate
  // (that is exactly where identity is sourced), so only the type is checked.
  if (opts.source === 'project') {
    if ('spec_owner' in obj) {
      return errVal(
        `spec_owner must not be set in a project config (${projectConfigPath(
          projectRoot ?? '.',
        )}): it would leak your operator identity to everyone who pulls the repo. ` +
          'Move spec_owner to your user config at ~/.ai-conductor/config.yml.',
      );
    }
  } else if (obj.spec_owner !== undefined && typeof obj.spec_owner !== 'string') {
    return errVal('spec_owner must be a string');
  }

  // owner_gate_cutover — the grandfather cutover instant (owner-gate, FR-10).
  // CONTRACT: a malformed (unparseable) date is REJECTED with a clear error,
  // never silently defaulted — an un-owned spec must never be misclassified as
  // buildable/skippable because the operator fat-fingered the cutover. A MISSING
  // cutover is allowed; the documented default (no grandfather window → un-owned
  // specs are indeterminate and skipped) is applied at the daemon wiring site.
  if (obj.owner_gate_cutover !== undefined) {
    if (typeof obj.owner_gate_cutover !== 'string') {
      return errVal('owner_gate_cutover must be an ISO-8601 date string');
    }
    if (Number.isNaN(Date.parse(obj.owner_gate_cutover))) {
      return errVal(
        `owner_gate_cutover is not a parseable date: "${obj.owner_gate_cutover}". ` +
          'Use an ISO-8601 instant (e.g. 2026-06-30T00:00:00Z).',
      );
    }
  }

  // attribution_audit_sample_pct — audit sampling percentage [0, 100]
  // (Task 11). Numeric type required; out-of-range values are clamped with
  // a startup warning. Absent → defaults to 10.
  if (obj.attribution_audit_sample_pct !== undefined) {
    if (typeof obj.attribution_audit_sample_pct !== 'number') {
      return errVal('attribution_audit_sample_pct must be a number');
    }
    // Clamp to [0, 100] with warning
    if (obj.attribution_audit_sample_pct < 0 || obj.attribution_audit_sample_pct > 100) {
      const clamped = Math.max(0, Math.min(100, obj.attribution_audit_sample_pct));
      warnings.push(
        `attribution_audit_sample_pct out of range [0, 100]; clamped to ${clamped}.`,
      );
      obj.attribution_audit_sample_pct = clamped;
    }
  } else if (materializeDefaults) {
    // Absent → default to 10
    obj.attribution_audit_sample_pct = 10;
  }

  // validation_concurrency — bounds the validation-phase fan-out. Absent →
  // engine default (no override). Numeric type required.
  if (obj.validation_concurrency !== undefined) {
    if (typeof obj.validation_concurrency !== 'number') {
      return errVal('validation_concurrency must be a number');
    }
  }

  // harness_self_host — self-host guardrail activation override + per-gate
  // toggles (adr-2026-06-30-self-host-detection-seam / TR-11). Absent → safe
  // default (auto-detect, all gates on) applied by resolveSelfHostConfig.
  if (obj.harness_self_host !== undefined) {
    const err = validateSelfHostBlock(obj.harness_self_host);
    if (err) return { ok: false, error: err };
  }

  // model_fallback_ladder — ordered fallback model list (model-availability-
  // fallback-ladder). Must be an array of non-empty strings; empty array is
  // valid (means no fallback).
  if (obj.model_fallback_ladder !== undefined) {
    if (!Array.isArray(obj.model_fallback_ladder)) {
      return errVal('model_fallback_ladder must be an array of strings');
    }
    for (const entry of obj.model_fallback_ladder) {
      if (typeof entry !== 'string' || entry === '') {
        return errVal('model_fallback_ladder must contain only non-empty strings');
      }
    }
  }

  // wiring — Layer 2 (TS import-graph reachability) entry points. Must be an
  // object with an optional entry_points array of non-empty strings.
  if (obj.wiring !== undefined) {
    if (!isPlainObject(obj.wiring)) {
      return errVal('wiring must be an object');
    }
    const wiring = obj.wiring as Record<string, unknown>;
    if (wiring.entry_points !== undefined) {
      if (!Array.isArray(wiring.entry_points)) {
        return errVal('wiring.entry_points must be an array of strings');
      }
      for (const entry of wiring.entry_points) {
        if (typeof entry !== 'string' || entry === '') {
          return errVal('wiring.entry_points must contain only non-empty strings');
        }
      }
    }
  }

  // auto_restart_on_stale_engine — daemon auto-restart on stale engine.
  // Contract (total — never throws, never undefined):
  //   C1  absent / null → false (no warning)
  //   C2  true or false → that value (no warning)
  //   C3  other value → false + one warning
  if (obj.auto_restart_on_stale_engine !== undefined && obj.auto_restart_on_stale_engine !== null) {
    if (typeof obj.auto_restart_on_stale_engine === 'boolean') {
      // C2: valid boolean — accept as-is, no warning
      // obj.auto_restart_on_stale_engine is already correct
    } else {
      // C3: invalid value — log warning and resolve to false
      warnings.push(
        `auto_restart_on_stale_engine has invalid value ${JSON.stringify(obj.auto_restart_on_stale_engine)}, falling back to false.`,
      );
      obj.auto_restart_on_stale_engine = false;
    }
  } else if (obj.auto_restart_on_stale_engine === null || materializeDefaults) {
    // C1: absent or null → false without warning
    obj.auto_restart_on_stale_engine = false;
  }

  // engine_refresh_min_interval_seconds — minimum interval between engine
  // refresh (origin fetch) attempts, in seconds. Contract (total — never
  // throws, never undefined):
  //   C1  absent / null → 300 (default, no warning)
  //   C2  finite positive number → that value (no warning)
  //   C3  other value (non-numeric, non-finite, zero, or negative) → 300
  //       + one warning
  if (
    obj.engine_refresh_min_interval_seconds !== undefined &&
    obj.engine_refresh_min_interval_seconds !== null
  ) {
    if (
      typeof obj.engine_refresh_min_interval_seconds === 'number' &&
      Number.isFinite(obj.engine_refresh_min_interval_seconds) &&
      obj.engine_refresh_min_interval_seconds > 0
    ) {
      // C2: valid — accept as-is
    } else {
      // C3: invalid value — log warning and resolve to default
      warnings.push(
        `engine_refresh_min_interval_seconds has invalid value ${JSON.stringify(obj.engine_refresh_min_interval_seconds)}, falling back to 300.`,
      );
      obj.engine_refresh_min_interval_seconds = 300;
    }
  } else if (obj.engine_refresh_min_interval_seconds === null || materializeDefaults) {
    // C1: absent or null → 300 without warning
    obj.engine_refresh_min_interval_seconds = 300;
  }

  // codex_doctor_timeout_seconds — bounded readiness check timeout. Absent
  // values default to 10 seconds; supplied values must be finite and positive.
  if (obj.codex_doctor_timeout_seconds !== undefined) {
    if (
      typeof obj.codex_doctor_timeout_seconds !== 'number' ||
      !Number.isFinite(obj.codex_doctor_timeout_seconds) ||
      obj.codex_doctor_timeout_seconds <= 0 ||
      !Number.isFinite(obj.codex_doctor_timeout_seconds * 1_000)
    ) {
      return errVal('codex_doctor_timeout_seconds must be a finite positive number representable in milliseconds');
    }
  } else if (materializeDefaults) {
    obj.codex_doctor_timeout_seconds = 10;
  }

  // step_heartbeat_stall_minutes is a deprecated compatibility no-op. Retain
  // finite legacy values so older configs continue to load, but never resolve
  // this key into termination authority or provider preparation timeout.
  if (
    obj.step_heartbeat_stall_minutes !== undefined &&
    obj.step_heartbeat_stall_minutes !== null
  ) {
    if (
      typeof obj.step_heartbeat_stall_minutes !== 'number' ||
      !Number.isFinite(obj.step_heartbeat_stall_minutes)
    ) {
      warnings.push(
        `step_heartbeat_stall_minutes is a deprecated compatibility no-op; invalid value ${JSON.stringify(obj.step_heartbeat_stall_minutes)} is ignored. It grants no termination authority and is never used as provider_preparation_timeout_minutes.`,
      );
      delete obj.step_heartbeat_stall_minutes;
    } else {
      warnings.push(
        'step_heartbeat_stall_minutes is a deprecated compatibility no-op. It grants no termination authority and is never used as provider_preparation_timeout_minutes.',
      );
    }
  }

  // provider_preparation_timeout_minutes — lifecycle deadline, in minutes,
  // before a provider process is spawned. 0 and negative values deliberately
  // opt out; only non-finite or non-numeric values are invalid. Left unset
  // when absent so the resolver applies its independent five-minute default.
  if (
    obj.provider_preparation_timeout_minutes !== undefined &&
    obj.provider_preparation_timeout_minutes !== null
  ) {
    if (
      typeof obj.provider_preparation_timeout_minutes !== 'number' ||
      !Number.isFinite(obj.provider_preparation_timeout_minutes)
    ) {
      warnings.push(
        `provider_preparation_timeout_minutes has invalid value ${JSON.stringify(obj.provider_preparation_timeout_minutes)}, falling back to the default (5).`,
      );
      delete obj.provider_preparation_timeout_minutes;
    }
  }

  // mergeable_autoresolve — auto-resolve merge conflicts on open PRs.
  // Apply defaults: enabled defaults to false, cooldownMinutes defaults to 60,
  // suiteCommand remains undefined if not provided.
  if (obj.mergeable_autoresolve !== undefined && isPlainObject(obj.mergeable_autoresolve)) {
    const block = obj.mergeable_autoresolve as Record<string, unknown>;
    if (block.enabled === undefined) {
      block.enabled = false;
    }
    if (block.cooldownMinutes === undefined) {
      block.cooldownMinutes = 60;
    }
    // suiteCommand is optional and remains undefined if not provided
  }

  // build_progress — intra-step build progress event cadence knobs.
  if (obj.build_progress !== undefined) {
    const err = validateBuildProgressBlock(obj.build_progress);
    if (err) return { ok: false, error: err };
  }

  // build_review — default-on judgement gate at the build → manual_test seam
  // (replacement completion authority, #773 Task 4).
  // Contract (total — never throws, never undefined):
  //   C1  absent / null → { enabled: true } (no warning)
  //   C2  { enabled: true|false } → as given (no warning)
  //   C3  malformed values warn and are omitted; valid sibling keys are kept.
  if (obj.build_review !== undefined && obj.build_review !== null) {
    if (isPlainObject(obj.build_review)) {
      const br = normalizeKeyedBlock(
        'build_review',
        obj.build_review,
        [
          { key: 'enabled', isValid: (value) => typeof value === 'boolean' },
          { key: 'perTaskFloor', isValid: (value) => typeof value === 'boolean' },
          { key: 'scopeContainmentEnforced', isValid: (value) => typeof value === 'boolean' },
        ],
        warnings,
      );
      obj.build_review = {
        ...br,
        enabled: typeof br.enabled === 'boolean' ? br.enabled : true,
      };
    } else {
      warnings.push(
        `build_review has invalid value ${JSON.stringify(obj.build_review)}, falling back to enabled.`,
      );
      obj.build_review = { enabled: true };
    }
  } else if (obj.build_review === null || materializeDefaults) {
    obj.build_review = { enabled: true };
  }

  // ci_watch — CI watch feature (adr-2026-07-07-ship-ci-feedback-loop).
  // Contract (total — never throws, never undefined):
  //   C1  absent / null → { enabled: true } (no warning)
  //   C2  { enabled: true|false } → as given (no warning)
  //   C3  malformed values warn and are omitted; valid sibling keys are kept.
  if (obj.ci_watch !== undefined && obj.ci_watch !== null) {
    if (isPlainObject(obj.ci_watch)) {
      const cw = normalizeKeyedBlock(
        'ci_watch',
        obj.ci_watch,
        [
          { key: 'enabled', isValid: (value) => typeof value === 'boolean' },
          {
            key: 'cooldownMinutes',
            isValid: (value) =>
              typeof value === 'number' && Number.isFinite(value) && value >= 0,
          },
        ],
        warnings,
      );
      obj.ci_watch = {
        ...cw,
        enabled: typeof cw.enabled === 'boolean' ? cw.enabled : true,
      };
    } else {
      warnings.push(
        `ci_watch has invalid value ${JSON.stringify(obj.ci_watch)}, falling back to enabled.`,
      );
      obj.ci_watch = { enabled: true };
    }
  } else if (obj.ci_watch === null || materializeDefaults) {
    obj.ci_watch = { enabled: true };
  }

  // build_progress_halt — progress-aware build halt/park decision.
  {
    const resolvedMaxRetries =
      typeof (obj.defaults as Record<string, unknown> | undefined)?.max_retries === 'number'
        ? ((obj.defaults as Record<string, unknown>).max_retries as number)
        : FALLBACK_RETRIES;
    const err = validateBuildProgressHaltBlock(obj.build_progress_halt, resolvedMaxRetries);
    if (err) return { ok: false, error: err };
    if (obj.build_progress_halt !== undefined || materializeDefaults) {
      obj.build_progress_halt = resolveBuildProgressHaltBlock(obj.build_progress_halt);
    }
  }

  // kickback_escalation — kickback→build no-op escalation (D2).
  // Contract (total — never throws, never undefined):
  //   K1  absent / null → { enabled: true } (no warning)
  //   K2  { enabled: true|false } → as given (no warning)
  //   K3  malformed (non-object, unknown key, or non-boolean enabled) →
  //       { enabled: true } without warning (fail-safe)
  if (obj.kickback_escalation !== undefined && obj.kickback_escalation !== null) {
    if (isPlainObject(obj.kickback_escalation)) {
      const ke = obj.kickback_escalation as Record<string, unknown>;
      const unknownKey = Object.keys(ke).find((k) => k !== 'enabled');
      if (unknownKey !== undefined) {
        obj.kickback_escalation = { enabled: true };
      } else if (ke.enabled === undefined) {
        obj.kickback_escalation = { enabled: true };
      } else if (typeof ke.enabled === 'boolean') {
        obj.kickback_escalation = { enabled: ke.enabled };
      } else {
        obj.kickback_escalation = { enabled: true };
      }
    } else {
      obj.kickback_escalation = { enabled: true };
    }
  } else if (obj.kickback_escalation === null || materializeDefaults) {
    obj.kickback_escalation = { enabled: true };
  }

  // retry_routing — retry classify rerun-vs-route kill-switch.
  {
    const err = validateRetryRoutingBlock(obj.retry_routing);
    if (err) return { ok: false, error: err };
    if (obj.retry_routing !== undefined || materializeDefaults) {
      obj.retry_routing = resolveRetryRoutingBlock(obj.retry_routing);
    }
  }

  return { ok: true, config: obj as HarnessConfig, warnings };
}

const SELF_HOST_ACTIVATIONS = new Set(['auto', 'force_on', 'force_off']);
const SELF_HOST_GATE_KEYS = [
  'skill_relink_preflight',
  'sandbox_build_env',
  'version_approval_gate',
  'release_artifact_gate',
];

function validateSelfHostBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'harness_self_host must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['activation', 'version_freeze', 'auth_park_timeout_minutes', 'build_auth', ...SELF_HOST_GATE_KEYS]);
  for (const k of Object.keys(obj)) {
    // Reject unknown keys so a typo'd gate name surfaces instead of silently
    // leaving that gate at its (enabled) default — TR-11 negative path.
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in harness_self_host: "${k}"` };
    }
  }
  if (
    obj.version_freeze !== undefined &&
    (typeof obj.version_freeze !== 'string' || obj.version_freeze.trim() === '')
  ) {
    return {
      type: 'validation_error',
      message: 'harness_self_host.version_freeze must be a non-empty string (the frozen version)',
    };
  }
  if (obj.activation !== undefined && !SELF_HOST_ACTIVATIONS.has(obj.activation as string)) {
    return {
      type: 'validation_error',
      message: 'harness_self_host.activation must be auto | force_on | force_off',
    };
  }
  for (const k of SELF_HOST_GATE_KEYS) {
    if (obj[k] !== undefined && typeof obj[k] !== 'boolean') {
      return {
        type: 'validation_error',
        message: `harness_self_host.${k} must be a boolean`,
      };
    }
  }
  if (obj.auth_park_timeout_minutes !== undefined && typeof obj.auth_park_timeout_minutes !== 'number') {
    return {
      type: 'validation_error',
      message: 'harness_self_host.auth_park_timeout_minutes must be a number',
    };
  }
  if (obj.build_auth !== undefined) {
    const err = validateBuildAuthBlock(obj.build_auth);
    if (err) return err;
  }
  return null;
}

function validateBuildAuthBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'harness_self_host.build_auth must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['mode', 'token_path']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in harness_self_host.build_auth: "${k}"`,
      };
    }
  }
  if (obj.mode !== undefined) {
    if (typeof obj.mode !== 'string') {
      return {
        type: 'validation_error',
        message: `harness_self_host.build_auth.mode must be a string (one of: daemon-token | api-key), got ${typeof obj.mode}`,
      };
    }
    const validModes = new Set(['daemon-token', 'api-key']);
    if (obj.mode === '' || !validModes.has(obj.mode)) {
      return {
        type: 'validation_error',
        message: `harness_self_host.build_auth.mode must be one of: daemon-token | api-key, got "${obj.mode}"`,
      };
    }
  }
  if (obj.token_path !== undefined && typeof obj.token_path !== 'string') {
    return {
      type: 'validation_error',
      message: 'harness_self_host.build_auth.token_path must be a string',
    };
  }
  return null;
}

function validateConductorBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'conductor must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['update_channel', 'auto_check', 'current_version', 'last_checked_at']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in conductor: "${k}"`,
      };
    }
  }
  if (
    obj.update_channel !== undefined &&
    obj.update_channel !== 'tagged' &&
    obj.update_channel !== 'main'
  ) {
    return {
      type: 'validation_error',
      message: 'conductor.update_channel must be "tagged" or "main"',
    };
  }
  if (obj.auto_check !== undefined && typeof obj.auto_check !== 'boolean') {
    return { type: 'validation_error', message: 'conductor.auto_check must be a boolean' };
  }
  if (obj.current_version !== undefined && typeof obj.current_version !== 'string') {
    return { type: 'validation_error', message: 'conductor.current_version must be a string' };
  }
  if (obj.last_checked_at !== undefined && typeof obj.last_checked_at !== 'string') {
    return { type: 'validation_error', message: 'conductor.last_checked_at must be a string' };
  }
  return null;
}

function validateAssessBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'assess must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['stale_after_days', 'stale_after_commits']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in assess: "${k}"` };
    }
  }
  for (const k of ['stale_after_days', 'stale_after_commits']) {
    const v = obj[k];
    if (v !== undefined) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return {
          type: 'validation_error',
          message: `assess.${k} must be a non-negative number`,
        };
      }
    }
  }
  return null;
}

function validateTestSuiteBlock(raw: unknown, projectRoot?: string): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'test_suite must be an object' };
  }

  const allowed = new Set([
    'command',
    'scoped_command',
    'working_directory',
    'timeout_seconds',
    'inputs',
    'environment',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      return { type: 'validation_error', message: `Unknown key in test_suite: "${key}"` };
    }
  }

  if (raw.command === undefined && raw.scoped_command === undefined) {
    return {
      type: 'validation_error',
      message: 'test_suite.command or test_suite.scoped_command must be configured',
    };
  }

  if (raw.command !== undefined && (typeof raw.command !== 'string' || raw.command.trim() === '')) {
    return {
      type: 'validation_error',
      message: 'test_suite.command must be a non-empty string',
    };
  }

  if (raw.scoped_command !== undefined) {
    if (typeof raw.scoped_command !== 'string' || raw.scoped_command.trim() === '') {
      return {
        type: 'validation_error',
        message: 'test_suite.scoped_command must be a non-empty string',
      };
    }
    if (!raw.scoped_command.includes('{selectors}')) {
      return {
        type: 'validation_error',
        message: 'test_suite.scoped_command must contain the "{selectors}" placeholder',
      };
    }
  }

  if (raw.working_directory !== undefined) {
    if (typeof raw.working_directory !== 'string') {
      return {
        type: 'validation_error',
        message: 'test_suite.working_directory must be a relative path within the project root',
      };
    }
    const root = resolvePath(projectRoot ?? '.');
    const resolvedDirectory = resolvePath(root, raw.working_directory);
    const relativeDirectory = relative(root, resolvedDirectory);
    if (
      isAbsolute(raw.working_directory) ||
      relativeDirectory === '..' ||
      relativeDirectory.startsWith(`..${sep}`) ||
      isAbsolute(relativeDirectory) ||
      (projectRoot !== undefined &&
        existingRealPathEscapesRoot(projectRoot, resolvedDirectory))
    ) {
      return {
        type: 'validation_error',
        message: 'test_suite.working_directory must be a relative path within the project root',
      };
    }
  }

  if (
    raw.timeout_seconds !== undefined &&
    (typeof raw.timeout_seconds !== 'number' ||
      !Number.isFinite(raw.timeout_seconds) ||
      raw.timeout_seconds <= 0)
  ) {
    return {
      type: 'validation_error',
      message: 'test_suite.timeout_seconds must be a finite positive number',
    };
  }

  for (const field of ['inputs', 'environment'] as const) {
    const value = raw[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string'))
    ) {
      return {
        type: 'validation_error',
        message: `test_suite.${field} must be an array of strings`,
      };
    }
  }

  return null;
}

function existingRealPathEscapesRoot(projectRoot: string, candidate: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    return true;
  }

  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Existence is an executor/verifier concern. Other resolution failures
    // (permissions, loops, I/O) fail closed at config validation.
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }

  const relativeCandidate = relative(realRoot, realCandidate);
  return (
    relativeCandidate === '..' ||
    relativeCandidate.startsWith(`..${sep}`) ||
    isAbsolute(relativeCandidate)
  );
}

/**
 * Validate the `build_progress:` block (intra-step build progress event
 * cadence knobs). Fail-closed: nonsense values are rejected outright rather
 * than silently coerced to defaults, since these knobs control operator-
 * facing stall detection — a bad value should surface loudly at config-load
 * time, not swallow itself into a default that masks the mistake.
 */
function validateBuildProgressBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'build_progress must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['poll_seconds', 'quiet_minutes', 'heartbeat_minutes', 'enabled']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in build_progress: "${k}"` };
    }
  }
  if (obj.poll_seconds !== undefined) {
    if (typeof obj.poll_seconds !== 'number' || !Number.isFinite(obj.poll_seconds) || obj.poll_seconds <= 0) {
      return {
        type: 'validation_error',
        message: 'build_progress.poll_seconds must be a positive number',
      };
    }
  }
  if (obj.quiet_minutes !== undefined) {
    if (typeof obj.quiet_minutes !== 'number' || !Number.isFinite(obj.quiet_minutes) || obj.quiet_minutes <= 0) {
      return {
        type: 'validation_error',
        message: 'build_progress.quiet_minutes must be a positive number',
      };
    }
  }
  if (obj.heartbeat_minutes !== undefined) {
    if (
      typeof obj.heartbeat_minutes !== 'number' ||
      !Number.isFinite(obj.heartbeat_minutes) ||
      obj.heartbeat_minutes <= 0
    ) {
      return {
        type: 'validation_error',
        message: 'build_progress.heartbeat_minutes must be a positive number',
      };
    }
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    return { type: 'validation_error', message: 'build_progress.enabled must be a boolean' };
  }

  // Cross-field: the poll cadence must not exceed the quiet/stall window, or
  // a step could be declared stalled before it was ever polled once.
  if (
    typeof obj.poll_seconds === 'number' &&
    typeof obj.quiet_minutes === 'number' &&
    obj.poll_seconds > obj.quiet_minutes * 60
  ) {
    return {
      type: 'validation_error',
      message: `build_progress.poll_seconds (${obj.poll_seconds}s) must not exceed build_progress.quiet_minutes (${obj.quiet_minutes}m = ${obj.quiet_minutes * 60}s)`,
    };
  }

  return null;
}

export const BUILD_PROGRESS_HALT_DEFAULTS = {
  enabled: true,
  attempt_ceiling: 30,
  dispatch_ceiling: 20,
} as const;

/**
 * Validate the `build_progress_halt:` block (progress-aware build halt/park
 * decision knobs). `resolvedMaxRetries` is the config's effective max_retries
 * (from `defaults.max_retries`, falling back to the same `FALLBACK_RETRIES`
 * used by step resolution) — `attempt_ceiling` must never sit below it, or
 * the halt/park decision could fire before a single step exhausted its own
 * retry budget.
 */
function validateBuildProgressHaltBlock(
  raw: unknown,
  resolvedMaxRetries: number,
): ConfigError | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'build_progress_halt must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['enabled', 'attempt_ceiling', 'dispatch_ceiling']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in build_progress_halt: "${k}"` };
    }
  }

  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    return { type: 'validation_error', message: 'build_progress_halt.enabled must be a boolean' };
  }

  for (const field of ['attempt_ceiling', 'dispatch_ceiling'] as const) {
    const value = obj[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      return {
        type: 'validation_error',
        message: `build_progress_halt.${field} must be a positive integer`,
      };
    }
  }

  if (
    typeof obj.attempt_ceiling === 'number' &&
    obj.attempt_ceiling < resolvedMaxRetries
  ) {
    return {
      type: 'validation_error',
      message: `build_progress_halt.attempt_ceiling (${obj.attempt_ceiling}) must not be below the resolved max_retries (${resolvedMaxRetries})`,
    };
  }

  return null;
}

function resolveBuildProgressHaltBlock(raw: unknown): {
  enabled: boolean;
  attempt_ceiling: number;
  dispatch_ceiling: number;
} {
  const obj = isPlainObject(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : BUILD_PROGRESS_HALT_DEFAULTS.enabled,
    attempt_ceiling:
      typeof obj.attempt_ceiling === 'number'
        ? obj.attempt_ceiling
        : BUILD_PROGRESS_HALT_DEFAULTS.attempt_ceiling,
    dispatch_ceiling:
      typeof obj.dispatch_ceiling === 'number'
        ? obj.dispatch_ceiling
        : BUILD_PROGRESS_HALT_DEFAULTS.dispatch_ceiling,
  };
}

/**
 * Defaults for the `retry_routing:` kill-switch. Absent block resolves to
 * `enabled: true` (feature on by default).
 */
export const RETRY_ROUTING_DEFAULTS = {
  enabled: true,
} as const;

/**
 * Validate the `retry_routing:` block (retry classify rerun-vs-route
 * kill-switch). Object-only; `enabled` must be a boolean if present; unknown
 * keys inside the block are rejected.
 */
function validateRetryRoutingBlock(raw: unknown): ConfigError | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'retry_routing must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['enabled']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in retry_routing: "${k}"` };
    }
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    return { type: 'validation_error', message: 'retry_routing.enabled must be a boolean' };
  }
  return null;
}

function resolveRetryRoutingBlock(raw: unknown): { enabled: boolean } {
  const obj = isPlainObject(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : RETRY_ROUTING_DEFAULTS.enabled,
  };
}

function validateMergeableAutoresolveBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'mergeable_autoresolve must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['enabled', 'cooldownMinutes', 'suiteCommand']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in mergeable_autoresolve: "${k}"` };
    }
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    return {
      type: 'validation_error',
      message: 'mergeable_autoresolve.enabled must be a boolean',
    };
  }
  if (obj.cooldownMinutes !== undefined) {
    if (typeof obj.cooldownMinutes !== 'number' || !Number.isFinite(obj.cooldownMinutes)) {
      return {
        type: 'validation_error',
        message: 'mergeable_autoresolve.cooldownMinutes must be a number',
      };
    }
    if (obj.cooldownMinutes < 0) {
      return {
        type: 'validation_error',
        message: 'mergeable_autoresolve.cooldownMinutes must be non-negative',
      };
    }
  }
  if (obj.suiteCommand !== undefined && typeof obj.suiteCommand !== 'string') {
    return {
      type: 'validation_error',
      message: 'mergeable_autoresolve.suiteCommand must be a string',
    };
  }
  return null;
}

function validateMarkdownViewerBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'markdown_viewer must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['preset', 'command', 'args', 'mode']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in markdown_viewer: "${k}"`,
      };
    }
  }
  if (obj.preset !== undefined && typeof obj.preset !== 'string') {
    return { type: 'validation_error', message: 'markdown_viewer.preset must be a string' };
  }
  if (obj.command !== undefined && typeof obj.command !== 'string') {
    return { type: 'validation_error', message: 'markdown_viewer.command must be a string' };
  }
  if (obj.args !== undefined) {
    if (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== 'string')) {
      return {
        type: 'validation_error',
        message: 'markdown_viewer.args must be an array of strings',
      };
    }
    if (!obj.args.includes('{file}')) {
      return {
        type: 'validation_error',
        message: 'markdown_viewer.args must include "{file}" placeholder',
      };
    }
  }
  if (obj.mode !== undefined && !VALID_MARKDOWN_VIEWER_MODES.has(obj.mode as MarkdownViewerConfig['mode'])) {
    return {
      type: 'validation_error',
      message: 'markdown_viewer.mode must be inline|blocking|external',
    };
  }
  return null;
}

function validateMermaidRendererBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'mermaid_renderer must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['preset', 'command', 'args', 'mode']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in mermaid_renderer: "${k}"`,
      };
    }
  }
  if (obj.preset !== undefined && typeof obj.preset !== 'string') {
    return { type: 'validation_error', message: 'mermaid_renderer.preset must be a string' };
  }
  if (obj.command !== undefined && typeof obj.command !== 'string') {
    return { type: 'validation_error', message: 'mermaid_renderer.command must be a string' };
  }
  if (obj.args !== undefined) {
    if (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== 'string')) {
      return {
        type: 'validation_error',
        message: 'mermaid_renderer.args must be an array of strings',
      };
    }
    if (!obj.args.includes('{file}')) {
      return {
        type: 'validation_error',
        message: 'mermaid_renderer.args must include "{file}" placeholder',
      };
    }
  }
  if (
    obj.mode !== undefined &&
    !VALID_MERMAID_RENDERER_MODES.has(obj.mode as MermaidRendererConfig['mode'])
  ) {
    return {
      type: 'validation_error',
      message: 'mermaid_renderer.mode must be inline|blocking|external',
    };
  }
  return null;
}

function validateEffortAndModelBag(raw: unknown, path: string): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: `${path} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  // defaults/phases accept the same knobs as steps minus skill/disable/hooks/after.
  // (review is not user-configurable — it's fixed per step in resolved-config.ts)
  const allowed = new Set(['model', 'effort', 'max_retries', 'escalate', 'by_tier']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in ${path}: "${k}"`,
      };
    }
  }
  if (obj.escalate !== undefined && typeof obj.escalate !== 'boolean') {
    return { type: 'validation_error', message: `${path}.escalate must be a boolean` };
  }
  if (obj.effort !== undefined && !VALID_EFFORTS.has(obj.effort as EffortLevel)) {
    return {
      type: 'validation_error',
      message: `${path}.effort must be low|medium|high|xhigh|max`,
    };
  }
  if (obj.max_retries !== undefined && typeof obj.max_retries !== 'number') {
    return { type: 'validation_error', message: `${path}.max_retries must be a number` };
  }
  if (obj.model !== undefined && typeof obj.model !== 'string') {
    return { type: 'validation_error', message: `${path}.model must be a string` };
  }
  if (obj.by_tier !== undefined) {
    return validateByTier(obj.by_tier, `${path}.by_tier`);
  }
  return null;
}

function validateByTier(raw: unknown, path: string): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: `${path} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const VALID_TIERS = new Set(['S', 'M', 'L']);
  for (const [tier, value] of Object.entries(obj)) {
    if (!VALID_TIERS.has(tier)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier} — tier must be S, M, or L`,
      };
    }
    if (!isPlainObject(value)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier} must be an object`,
      };
    }
    const tierCfg = value as Record<string, unknown>;
    const allowed = new Set(['model', 'effort', 'max_retries']);
    for (const k of Object.keys(tierCfg)) {
      if (!allowed.has(k)) {
        return {
          type: 'validation_error',
          message: `Unknown key in ${path}.${tier}: "${k}"`,
        };
      }
    }
    if (tierCfg.effort !== undefined && !VALID_EFFORTS.has(tierCfg.effort as EffortLevel)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.effort must be low|medium|high|xhigh|max`,
      };
    }
    if (tierCfg.max_retries !== undefined && typeof tierCfg.max_retries !== 'number') {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.max_retries must be a number`,
      };
    }
    if (tierCfg.model !== undefined && typeof tierCfg.model !== 'string') {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.model must be a string`,
      };
    }
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cloneForValidation<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return cloneValidationGraph(value, new WeakMap<object, unknown>());
  }
}

function cloneValidationGraph<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    (copy as Record<string, unknown>)[key] = cloneValidationGraph(entry, seen);
  }
  return copy as T;
}

/**
 * Deep-merge project config on top of user config. Objects merge key-by-key;
 * scalars and arrays from `project` replace `user`.
 */
export function mergeConfigs(user: HarnessConfig, project: HarnessConfig): HarnessConfig {
  return deepMerge(user as Record<string, unknown>, project as Record<string, unknown>) as HarnessConfig;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k];
    if (isPlainObject(av) && isPlainObject(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}

/**
 * Load project config (.ai-conductor/config.yml), merge user config
 * (~/.ai-conductor/config.yml) underneath, validate the result. Returns the
 * merged + validated config. User-config parse errors become warnings, not
 * hard failures, so a broken user file never blocks an otherwise-healthy
 * project.
 */
export async function loadMergedConfig(
  projectRoot: string,
  harnessVersion?: string,
): Promise<ConfigResult> {
  const projectResult = await loadProjectConfig(projectRoot, harnessVersion, false);
  if (!projectResult.ok) return projectResult;

  const userResult = await readUserConfig();
  if (userResult.parseError) {
    return {
      ok: false,
      error: {
        type: 'parse_error',
        message: `user config parse error: ${userResult.parseError}`,
      },
    };
  }

  const merged = mergeConfigs(userResult.config, projectResult.config);
  // 'merged' source: the anti-leak guard already fired on the raw project file
  // inside loadProjectConfig above. Here a spec_owner can only have come from the USER
  // config, which is its legitimate home — so the guard must NOT reject it.
  const validated = validateConfig(merged, projectRoot, { source: 'merged' });
  if (!validated.ok) return validated;

  return {
    ok: true,
    config: validated.config,
    warnings: [...projectResult.warnings, ...validated.warnings],
  };
}

function errVal(message: string): ConfigResult {
  return { ok: false, error: { type: 'validation_error', message } };
}

function validateProviderSelection(value: unknown, path: string): ConfigError | null {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    return value.trim() === ''
      ? { type: 'validation_error', message: `${path} must be a non-empty provider name` }
      : null;
  }
  if (!Array.isArray(value)) {
    return {
      type: 'validation_error',
      message: `${path} must be a string or array of non-empty provider names`,
    };
  }
  if (value.length === 0) {
    return {
      type: 'validation_error',
      message: `${path} must be a non-empty array of provider names`,
    };
  }

  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const provider = value[index];
    if (typeof provider !== 'string' || provider.trim() === '') {
      return {
        type: 'validation_error',
        message: `${path}[${index}] must be a non-empty string`,
      };
    }
    if (seen.has(provider)) {
      return {
        type: 'validation_error',
        message: `${path} contains duplicate provider "${provider}"`,
      };
    }
    seen.add(provider);
  }
  return null;
}

export function satisfiesVersion(installed: string, constraint: string): boolean {
  const match = constraint.match(/^>=(\d+\.\d+\.\d+)$/);
  if (!match) return true;
  const required = match[1];
  return compareVersions(installed, required) >= 0;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy adapters — some callers still read the old-shape fields
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the list of disabled step names from the new schema.
 */
export function disabledStepNames(config: HarnessConfig): StepName[] {
  if (!config.steps) return [];
  return Object.entries(config.steps)
    .filter(([, v]) => v?.disable === true)
    .map(([k]) => k as StepName);
}

/**
 * Extract the list of custom step entries from the new schema, in the shape
 * buildStepRegistry expects.
 */
export function customStepEntries(config: HarnessConfig): Array<{
  name: string;
  after: string;
  skill: string;
  enforcement: EnforcementLevel;
}> {
  if (!config.steps) return [];
  const builtIn = new Set(ALL_STEPS.map((s) => s.name as string));
  const out: Array<{ name: string; after: string; skill: string; enforcement: EnforcementLevel }> = [];
  for (const [name, cfg] of Object.entries(config.steps)) {
    if (builtIn.has(name)) continue;
    if (!cfg?.after || !cfg?.skill) continue;
    out.push({
      name,
      after: cfg.after,
      skill: cfg.skill,
      enforcement: (cfg.enforcement ?? 'advisory') as EnforcementLevel,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory provider resolution (adr-2026-06-29-per-project-memory-provider-selection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run-scoped accumulator passed to `resolveMemoryProvider`. Warnings pushed here
 * are bounded (at most one per bad name per run — A8). Per-run de-dup state is
 * stored on the ctx object itself so the resolver remains PURE over its config
 * argument (A10: no module-level mutable state).
 */
export interface MemoryResolveCtx {
  warnings: string[];
  /** @internal populated lazily by resolveMemoryProvider for warning de-dup */
  _seenBadMemoryProviders?: Set<string>;
}

/**
 * Run-start resolver for the active memory provider (adr-2026-06-29-per-project-memory-provider-selection).
 *
 * Contract (total — never throws, never returns undefined):
 *   C1  absent / empty / non-string  →  local  (no warning)
 *   C2  valid name, installed        →  that provider  (no warning)
 *   C3  valid name, NOT installed    →  local  (one warning per bad name per run)
 *
 * The resolver is PURE over `config`: all per-run state lives on `ctx`, so two
 * separate calls with different configs do not interfere (A10).
 *
 * @param config  Project/user config object — only `memory_provider` is read.
 * @param registry  Plugin registry (may or may not be initialized — uses `tryGet`).
 * @param ctx  Optional run-scoped accumulator for warnings and de-dup state.
 */
export async function resolveMemoryProvider(
  config: Pick<HarnessConfig, 'memory_provider'>,
  registry: PluginRegistry,
  ctx: MemoryResolveCtx = { warnings: [] },
): Promise<unknown> {
  const selection = (config as Record<string, unknown>).memory_provider;

  // C1: absent, empty string, or non-string → return local without a warning.
  // Explicit branch — no catch-all else (conditions C1/C3).
  if (!selection || typeof selection !== 'string') {
    return registry.tryGet('memory_provider', 'local');
  }

  // Named and a valid string — look it up.
  const found = registry.tryGet('memory_provider', selection);

  // C2: named and installed → use it, no warning.
  if (found !== undefined) {
    return found;
  }

  // C3: named but NOT installed → warn once per run, fall back to local.
  // De-dup: initialise the seen-set on first warn (lives on ctx, not module scope).
  if (!ctx._seenBadMemoryProviders) {
    ctx._seenBadMemoryProviders = new Set<string>();
  }
  if (!ctx._seenBadMemoryProviders.has(selection)) {
    ctx._seenBadMemoryProviders.add(selection);
    ctx.warnings.push(
      `memory_provider "${selection}" is not installed; falling back to local.`,
    );
  }

  return registry.tryGet('memory_provider', 'local');
}

/**
 * Fully resolved build_progress config — all fields required. Every field
 * falls back to its documented default when absent from the source config.
 */
export type ResolvedBuildProgressConfig = Required<BuildProgressConfig>;

const BUILD_PROGRESS_DEFAULTS: ResolvedBuildProgressConfig = {
  poll_seconds: 30,
  quiet_minutes: 15,
  heartbeat_minutes: 5,
  enabled: true,
};

/**
 * Resolve the `build_progress:` block from `config`, filling in defaults for
 * any unset field. A wholly absent block resolves to all defaults
 * (poll_seconds: 30, quiet_minutes: 15, heartbeat_minutes: 5, enabled: true).
 * Never throws — unknown/malformed inputs simply fall back to defaults for
 * the affected field.
 *
 * @param config - The HarnessConfig (or partial) to read `build_progress` from.
 */
/**
 * Default validation-phase fan-out concurrency (used when
 * `validation_concurrency` is absent, zero, negative, or non-numeric).
 */
export const DEFAULT_VALIDATION_CONCURRENCY = 2;

/**
 * Resolve the validation-phase fan-out concurrency from `config`.
 *
 * Resolution rules:
 *   - undefined / absent     → DEFAULT_VALIDATION_CONCURRENCY (2)
 *   - positive integer       → use the value as-is
 *   - 0, negative, NaN, or
 *     non-numeric             → DEFAULT_VALIDATION_CONCURRENCY (2)
 */
export function resolveValidationConcurrency(config: Pick<HarnessConfig, 'validation_concurrency'>): number {
  const override = config?.validation_concurrency;
  if (
    override === undefined ||
    override === null ||
    typeof override !== 'number' ||
    !Number.isFinite(override) ||
    override <= 0
  ) {
    return DEFAULT_VALIDATION_CONCURRENCY;
  }
  return override;
}

/**
 * Resolves the `gate_code_validity` kill-switch (#817, Task 8) to a total
 * `{ enabled: boolean }`. Mirrors `resolveBuildProgressConfig`'s defensive
 * shape: absent block, absent `enabled`, or a non-boolean `enabled` all
 * resolve to `enabled: true` (feature ON by default) — never throws.
 */
export function resolveGateCodeValidityConfig(
  config: Pick<HarnessConfig, 'gate_code_validity'> | undefined,
): { enabled: boolean } {
  const block = config?.gate_code_validity;
  if (!block || typeof block.enabled !== 'boolean') {
    return { enabled: true };
  }
  return { enabled: block.enabled };
}

export function resolveBuildProgressConfig(
  config: Pick<HarnessConfig, 'build_progress'>,
): ResolvedBuildProgressConfig {
  const buildProgress = config.build_progress;

  if (!buildProgress) {
    return { ...BUILD_PROGRESS_DEFAULTS };
  }

  return {
    poll_seconds: buildProgress.poll_seconds ?? BUILD_PROGRESS_DEFAULTS.poll_seconds,
    quiet_minutes: buildProgress.quiet_minutes ?? BUILD_PROGRESS_DEFAULTS.quiet_minutes,
    heartbeat_minutes:
      buildProgress.heartbeat_minutes ?? BUILD_PROGRESS_DEFAULTS.heartbeat_minutes,
    enabled: buildProgress.enabled ?? BUILD_PROGRESS_DEFAULTS.enabled,
  };
}
