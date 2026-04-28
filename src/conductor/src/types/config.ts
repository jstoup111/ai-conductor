import type { ComplexityTier, EnforcementLevel, StepName, Phase } from './steps.js';

/**
 * Claude's native reasoning effort levels — set per invocation via
 * `CLAUDE_CODE_EFFORT_LEVEL` env var. Controls adaptive thinking budget.
 *
 * Model support:
 *   - Opus 4.7: all five (low / medium / high / xhigh / max)
 *   - Opus 4.6, Sonnet 4.6: low / medium / high / max (no xhigh)
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Artifact-review flow per step. Fixed per step (not user-configurable) —
 * set in resolved-config.ts's DEFAULT_STEP_REVIEW table:
 *   - auto: silently record approval; no prompt
 *   - manual: always prompt the user
 *   - conditional: auto-approve unless the skill wrote
 *     `.pipeline/review-required-<step>` (signalling it found issues
 *     worth human attention)
 */
export type ReviewMode = 'auto' | 'manual' | 'conditional';

/**
 * Overrides that kick in when the feature's current complexity tier matches.
 * Every field is optional — unset falls back to the step/phase/default value.
 * Applied ON TOP of the step's base config at resolve time.
 */
export interface TierOverride {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
}

/**
 * Configuration for a single step. Every key is optional — unset values fall
 * back through phases > defaults > hardcoded baselines.
 *
 * Built-in steps (those declared in ALL_STEPS) may set any subset of keys.
 * Custom steps (not in ALL_STEPS) MUST set both `after` and `skill` so the
 * registry knows where and how to insert them.
 */
export interface StepConfig {
  /** Claude model: alias ("haiku"|"sonnet"|"opus") or full ID. */
  model?: string;

  /** Claude `/effort` level — sets CLAUDE_CODE_EFFORT_LEVEL for this step. */
  effort?: EffortLevel;

  /** Retry budget before recovery-menu escalation. */
  max_retries?: number;

  /** Skip this step entirely. Built-in gating/structural steps cannot be disabled. */
  disable?: boolean;

  /** Replace the default SKILL.md file with this path. */
  skill?: string;

  /** Shell hooks run before/after the step. Paths are project-relative. */
  hooks?: {
    before?: string;
    after?: string;
  };

  /** Tier-specific overrides applied when state.complexity_tier matches. */
  by_tier?: Partial<Record<ComplexityTier, TierOverride>>;

  // --- Custom-step-only fields -----------------------------------------------

  /** (Custom steps only) Insert after this existing step. */
  after?: StepName | string;

  /** (Custom steps only) Enforcement level. Required when adding a step. */
  enforcement?: EnforcementLevel;
}

/**
 * Phase-wide defaults. Apply to every step in the phase unless overridden.
 */
export interface PhaseConfig {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
  by_tier?: Partial<Record<ComplexityTier, TierOverride>>;
}

/**
 * Global defaults. Apply to every step unless the step or its phase overrides.
 */
export interface DefaultsConfig {
  model?: string;
  effort?: EffortLevel;
  max_retries?: number;
}

/**
 * User-level global state: harness update channel, detected version, last
 * check timestamp. Lives in ~/.ai-conductor/config.yml. Project configs
 * should not override this block — it's per-user, not per-repo.
 */
export interface ConductorConfig {
  update_channel?: 'tagged' | 'main';
  auto_check?: boolean;
  current_version?: string;
  last_checked_at?: string;
}

/**
 * Markdown viewer resolution: used by conduct artifact-review + changelog
 * rendering to invoke the user's preferred viewer. `command` + `args` are
 * the resolved form (a preset pre-fills these). `{file}` in any arg is
 * substituted with the file path at invocation time.
 */
export interface MarkdownViewerConfig {
  preset?: string;
  command: string;
  args: string[];
  mode: 'inline' | 'blocking' | 'external';
}

/**
 * Staleness thresholds for the project-level `assess` prelude step. Either
 * signal (time OR commit count) being exceeded makes an existing assessment
 * "stale"; the user is prompted before a re-run is triggered. Defaults live
 * in `project-prelude.ts` (`DEFAULT_ASSESS_STALE_*`).
 */
export interface AssessConfig {
  stale_after_days?: number;
  stale_after_commits?: number;
}

export interface HarnessConfig {
  harness_version?: string;
  defaults?: DefaultsConfig;
  phases?: Partial<Record<Phase, PhaseConfig>>;
  /**
   * Keyed by step name. Includes both built-in steps (override their knobs)
   * and custom steps (new entries with `after` + `skill`).
   */
  steps?: Record<string, StepConfig>;
  complexity?: {
    default_tier?: ComplexityTier;
  };
  /** User-level global state — loaded from ~/.ai-conductor/config.yml. */
  conductor?: ConductorConfig;
  /** Preferred markdown viewer — user-level default, project can override. */
  markdown_viewer?: MarkdownViewerConfig;
  /** Project-level assess staleness thresholds (optional). */
  assess?: AssessConfig;
  /** Plugin selection: which LLM provider to use (defaults to 'claude'). */
  llm_provider?: string;
  /** Plugin selection: which UI renderer to use (defaults to 'terminal'). */
  ui_renderer?: string;
}
