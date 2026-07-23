export type StepName =
  | 'bootstrap'
  | 'memory'
  | 'assess'
  | 'explore'
  | 'prd'
  | 'complexity'
  | 'stories'
  | 'conflict_check'
  | 'plan'
  | 'coherence_check'
  | 'architecture_diagram'
  | 'architecture_review'
  | 'worktree'
  | 'acceptance_specs'
  | 'build'
  | 'build_review'
  | 'wiring_check'
  | 'manual_test'
  | 'prd_audit'
  | 'architecture_review_as_built'
  | 'retro'
  | 'rebase'
  | 'finish'
  // Conditional SHIP sub-routine — dispatched by the conductor when a blocking
  // prd_audit / as-built review needs gap remediation. NOT part of the
  // sequential ALL_STEPS; it routes each gap to the right step or HALTs
  // (architectural-clarity / product-scope only).
  | 'remediate'
  // Semantic attribution verification step — out-of-band verification gate
  // (like remediate) that validates task attribution metadata in commits.
  | 'attribution_verify';

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped' | 'stale';

export type Phase = 'SETUP' | 'UNDERSTAND' | 'DECIDE' | 'BUILD' | 'SHIP';

export type ComplexityTier = 'S' | 'M' | 'L';

/** The work track decided in `explore`: a product feature vs technical-only work. */
export type Track = 'product' | 'technical';

export type EnforcementLevel = 'advisory' | 'gating' | 'structural' | 'mechanical';

export type RunMode = 'default' | 'auto' | 'interactive';

export type ViewMode = 'dashboard' | 'output';

export interface StepDefinition {
  name: StepName;
  label: string;
  phase: Phase;
  enforcement: EnforcementLevel;
  prerequisites: StepName[];
  skippableForTiers: ComplexityTier[];
  /**
   * Tracks (product/technical) for which this step is skipped. `prd` is skipped
   * on the `technical` track (no product requirements to spec). Empty/absent →
   * runs on every track. The conductor resolves the track from state and treats
   * a track-skipped step as satisfied (same as a tier-skip).
   */
  skippableForTracks?: Track[];
  isCheckpoint: boolean;
  skillName?: string;
  /**
   * This step participates in the gate-driven tail loop (build…finish): its
   * objective verdict is recomputed after it runs and the selector may route
   * to/over it. The conductor derives the loop region and the front/loop
   * boundary from this flag, so a custom config step inserted among the loop
   * steps joins the loop. Built-ins: build, manual_test, retro, finish.
   */
  loopGate?: boolean;
  /**
   * This upstream gate can be re-opened by a downstream kickback (build /
   * manual_test writing `{satisfied:false, kickback.from}`). The conductor
   * derives KICKBACK_TARGETS + the selector's region start from this flag.
   * Built-ins: stories, plan.
   */
  kickbackTarget?: boolean;
  /**
   * Skip this step whenever the named upstream step ended up `skipped`,
   * regardless of why (tier, config-disable, `when:` skip). Expresses a
   * data dependency: e.g. `architecture_review_as_built` audits shipped code
   * against APPROVED ADRs, so if `architecture_review` was skipped there are no
   * ADRs to audit and the as-built gate has nothing to do. Honored by the
   * selector and by the conductor's linear + looped-region skip passes.
   */
  skipWhenSkipped?: StepName;
  /**
   * This gating step may be disabled per-project via `steps.<name>.disable:
   * true` in config.yml. By default `validateConfig()` rejects disabling
   * gating/structural built-ins (a partial config must never silently drop a
   * guardrail); this flag is the step definition's explicit opt-in for an
   * explicit, committed, validated config disable. Structural steps ignore it
   * — they can never be disabled. Built-ins: manual_test.
   */
  configDisableAllowed?: boolean;
}

/**
 * A built-in concurrent group entry (adr-2026-07-10-validation-group-join.md,
 * Decision-1): a WRAPPER over an ordered run of contiguous `StepDefinition`s
 * already present in `ALL_STEPS`, not a replacement for them. Each member
 * keeps its own full `StepDefinition` (skill, gate config, skip rules) and
 * its own position in the linear step-index space — `tryGetStepIndex` and
 * per-step state keys are completely unaffected by a step's group
 * membership. The group is purely additive metadata consumed by the
 * (not-yet-built) concurrent dispatch/join logic; this type only describes
 * "these steps are members of group X, in this order."
 */
export interface StepGroup {
  /** Registry key for this group, e.g. 'validation'. */
  name: string;
  /**
   * Member step names in ADR-declared order. Members must be contiguous in
   * `ALL_STEPS` and immediately follow the group's anchor step (e.g.
   * `build_review`) — the registry builder verifies this positioning, it is
   * not re-derived from this list alone.
   */
  members: StepName[];
}
