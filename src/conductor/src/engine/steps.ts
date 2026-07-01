import type { StepDefinition, StepName, ComplexityTier, BootstrapMode, Track } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';

export const ALL_STEPS: StepDefinition[] = [
  {
    name: 'worktree',
    label: 'Worktree',
    phase: 'SETUP',
    enforcement: 'structural',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'worktree',
  },
  {
    name: 'memory',
    label: 'Memory',
    phase: 'UNDERSTAND',
    enforcement: 'advisory',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'memory',
  },
  {
    // `explore` (divergent: context, questions, approaches) — always runs,
    // advisory. Working notes are ephemeral (.pipeline/); the selected approach
    // + rejected alternatives are promoted to .memory/decisions/. It emits the
    // operator-confirmed Track (product|technical) → .docs/track/<slug>.md.
    name: 'explore',
    label: 'Explore',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'explore',
  },
  {
    name: 'complexity',
    label: 'Complexity',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['explore'],
    skippableForTiers: [],
    isCheckpoint: false,
  },
  {
    // `prd` (convergent: product-only design doc) — gating, PRODUCT track only.
    // Skipped on the technical track (no product requirements to spec). A
    // conflict rooted in contradictory FRs can re-open it (kickbackTarget).
    name: 'prd',
    label: 'PRD',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['explore'],
    skippableForTiers: [],
    skippableForTracks: ['technical'],
    isCheckpoint: false,
    skillName: 'prd',
    kickbackTarget: true,
  },
  {
    name: 'architecture_diagram',
    label: 'Architecture Diagram',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['complexity'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-diagram',
  },
  {
    // adr-2026-06-29-architecture-before-stories-convergent-kickback: architecture precedes stories so stories derive from the approved
    // design (+ PRD when product) and architecture-induced failure modes become
    // negative-path stories. Re-openable as a targeted amendment (kickbackTarget).
    name: 'architecture_review',
    label: 'Architecture Review',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['architecture_diagram'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-review',
    kickbackTarget: true,
  },
  {
    name: 'stories',
    label: 'Stories',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['architecture_review'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'stories',
    kickbackTarget: true,
  },
  {
    name: 'conflict_check',
    label: 'Conflict Check',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['stories'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'conflict-check',
  },
  {
    name: 'plan',
    label: 'Plan',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['conflict_check'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'plan',
    kickbackTarget: true,
  },
  {
    name: 'acceptance_specs',
    label: 'Acceptance Specs',
    phase: 'BUILD',
    enforcement: 'gating',
    prerequisites: ['plan'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'writing-system-tests',
  },
  {
    name: 'build',
    label: 'Build',
    phase: 'BUILD',
    enforcement: 'structural',
    prerequisites: ['plan'],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: 'pipeline',
    loopGate: true,
  },
  {
    name: 'manual_test',
    label: 'Manual Test',
    phase: 'SHIP',
    enforcement: 'advisory',
    prerequisites: ['build'],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: 'manual-test',
    loopGate: true,
  },
  {
    // SHIP-tail compliance gate: audits the shipped implementation against the
    // PRD's functional requirements (FR-N). A non-ALIGNED FR blocks the gate
    // and kicks back to BUILD (impl gap) or DECIDE (intended drift). loopGate
    // so it joins the selector-driven tail; gating so a FAIL cannot advance.
    name: 'prd_audit',
    label: 'PRD Audit',
    phase: 'SHIP',
    enforcement: 'gating',
    prerequisites: ['manual_test'],
    skippableForTiers: [],
    // No PRD on the technical track → nothing to audit (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location).
    skippableForTracks: ['technical'],
    isCheckpoint: false,
    skillName: 'prd-audit',
    loopGate: true,
  },
  {
    // SHIP-tail compliance gate: as-built drift sweep of shipped code vs the
    // APPROVED ADRs / approved architecture. A BLOCKED verdict (code violates
    // an APPROVED ADR) halts for a human — fix the code or supersede the ADR.
    // Runs the architecture-review skill in --as-built mode (one skill, one
    // model-table row); see STEP_PROMPTS in step-runners.ts.
    name: 'architecture_review_as_built',
    label: 'Architecture Review (as-built)',
    phase: 'SHIP',
    enforcement: 'gating',
    prerequisites: ['prd_audit'],
    // Mirror the DECIDE-phase architecture_review's tier skip: Small features
    // produce no ADRs, so there is nothing for the as-built sweep to audit.
    skippableForTiers: ['S'],
    // And skip on ANY skip of the review (config-disable / when: on M/L), not
    // just the tier case — no APPROVED ADRs means no as-built compliance check.
    skipWhenSkipped: 'architecture_review',
    isCheckpoint: false,
    skillName: 'architecture-review',
    loopGate: true,
  },
  {
    name: 'retro',
    label: 'Retro',
    phase: 'SHIP',
    enforcement: 'advisory',
    prerequisites: ['architecture_review_as_built'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'retro',
    loopGate: true,
  },
  {
    // Engine-native loop gate (like `complexity`, no skillName): rebase the
    // feature branch onto the discovered base before finish. Its objective
    // verdict is "branch is current with base" — the conductor runs the rebase
    // natively (see conductor.ts) rather than dispatching a Claude skill.
    name: 'rebase',
    label: 'Rebase',
    phase: 'SHIP',
    enforcement: 'structural',
    prerequisites: ['manual_test'],
    skippableForTiers: [],
    isCheckpoint: false,
    loopGate: true,
  },
  {
    name: 'finish',
    label: 'Finish',
    phase: 'SHIP',
    enforcement: 'gating',
    prerequisites: ['rebase'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'finish',
    loopGate: true,
  },
];

/**
 * Steps that are dispatchable via the runner (so they appear in the `StepName`
 * union, STEP_PROMPTS, and the DEFAULT_STEP_* config maps) but are deliberately
 * NOT part of the linear `ALL_STEPS` gate-loop sequence. The conductor invokes
 * them out-of-band — e.g. `remediate` runs only when a `prd_audit` blocks, so
 * it must never occupy an ordered slot the main loop would dispatch
 * unconditionally. They still need a `StepDefinition` so the runner can resolve
 * a label, phase, and per-step config when dispatching them. Without this entry
 * `getStepDefinition`/`phaseForStep` throw `Unknown step: remediate`, which the
 * daemon catches and turns into a `.pipeline/HALT`.
 */
export const OUT_OF_BAND_STEPS: Record<string, StepDefinition> = {
  remediate: {
    name: 'remediate',
    label: 'Remediate',
    phase: 'SHIP',
    enforcement: 'advisory',
    prerequisites: ['prd_audit'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'remediate',
  },
};

const stepMap = new Map(ALL_STEPS.map((s) => [s.name, s]));
const stepIndexMap = new Map(ALL_STEPS.map((s, i) => [s.name, i]));

export function getStepDefinition(name: StepName): StepDefinition {
  const def = stepMap.get(name) ?? OUT_OF_BAND_STEPS[name];
  if (!def) throw new Error(`Unknown step: ${name}`);
  return def;
}

export function getStepIndex(name: StepName): number {
  const idx = stepIndexMap.get(name);
  if (idx === undefined) throw new Error(`Unknown step: ${name}`);
  return idx;
}

/**
 * Like `getStepIndex` but returns `null` for steps with no position in the
 * linear sequence (out-of-band steps such as `remediate`) instead of throwing.
 * The caller decides how to present a step that has no "N/total" slot.
 */
export function tryGetStepIndex(name: StepName): number | null {
  const idx = stepIndexMap.get(name);
  return idx === undefined ? null : idx;
}

export function getStepByIndex(index: number): StepDefinition {
  if (index < 0 || index >= ALL_STEPS.length) {
    throw new Error(`Step index out of range: ${index}`);
  }
  return ALL_STEPS[index];
}

export function shouldSkipForTier(step: StepName, tier: ComplexityTier): boolean {
  const def = getStepDefinition(step);
  return def.skippableForTiers.includes(tier);
}

/**
 * True when `step` is skipped for the given work `track` (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). `prd`
 * declares `skippableForTracks: ['technical']`, so a technical-only feature
 * skips PRD authoring. A missing track defaults to `product` (back-compat), so
 * nothing is track-skipped when the track is unknown.
 */
export function shouldSkipForTrack(step: StepName, track: Track | undefined): boolean {
  const def = getStepDefinition(step);
  return (def.skippableForTracks ?? []).includes(track ?? 'product');
}

/**
 * Steps that have nothing to do when the project has no codebase yet
 * (bootstrap mode = 'new' — bootstrap is the one scaffolding it). For these
 * the conductor short-circuits with a `mode_skip` event rather than
 * dispatching the skill and letting the completion gate fail.
 *
 * Currently just `assess` — the nine-specialist review has no material in
 * a project that was an empty directory a minute ago. Add to this list
 * sparingly; most steps are still meaningful on a freshly-scaffolded
 * codebase.
 */
const STEPS_SKIPPED_WHEN_NEW: ReadonlySet<StepName> = new Set<StepName>([
  'assess',
]);

export function shouldSkipForBootstrapMode(
  step: StepName,
  mode: BootstrapMode | undefined,
): boolean {
  if (mode !== 'new') return false;
  return STEPS_SKIPPED_WHEN_NEW.has(step);
}

/**
 * True when a step declares `skipWhenSkipped` and that upstream step is
 * `skipped` in the current state — e.g. `architecture_review_as_built` skips
 * when `architecture_review` was skipped (no ADRs to audit). Covers every skip
 * reason (tier, config-disable, `when:`), not just the tier case.
 */
export function shouldSkipForUpstreamSkip(
  step: StepDefinition,
  state: import('../types/index.js').ConductState,
): boolean {
  // Takes the resolved StepDefinition (NOT a name) so it works for custom
  // config steps that aren't in the static registry — getStepDefinition would
  // throw on those.
  const dep = step.skipWhenSkipped;
  if (!dep) return false;
  return state[dep] === 'skipped';
}

export function getSkippableSteps(tier: ComplexityTier): StepName[] {
  return ALL_STEPS
    .filter((s) => s.skippableForTiers.includes(tier))
    .map((s) => s.name);
}

export function isCheckpointStep(step: StepName): boolean {
  return getStepDefinition(step).isCheckpoint;
}

export function getPrerequisites(step: StepName): StepName[] {
  return getStepDefinition(step).prerequisites;
}

export function buildStepRegistry(config: HarnessConfig): StepDefinition[] {
  const result = [...ALL_STEPS];

  // Custom steps are entries under config.steps whose name isn't in ALL_STEPS.
  // Each has `after` (insertion target — either a built-in step OR another
  // custom step earlier in the chain) and `skill` (SKILL.md path). Entries
  // that match built-in step names are treated as per-step overrides, not
  // additions, and are ignored here.
  //
  // Ordering policy (Option B in the design discussion): steps are inserted
  // in the order they appear in the config file. When two customs share the
  // same `after`, the one that appears first in the file runs first (since
  // we splice each immediately after its target, the latter gets pushed to
  // index target+1 and the earlier slides to target+2 — so we walk in
  // reverse when siblings share a target, or more simply: we insert each
  // sibling after the previous sibling so file order == execution order).
  const builtInNames = new Set(result.map((s) => s.name as string));
  type Addition = {
    name: string;
    after: string;
    skill: string;
    enforcement: import('../types/index.js').EnforcementLevel;
    gate?: boolean;
    kickbackTarget?: boolean;
  };
  const additions: Addition[] = [];
  for (const [name, cfg] of Object.entries(config.steps ?? {})) {
    if (builtInNames.has(name)) continue;
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as {
      after?: string;
      skill?: string;
      enforcement?: import('../types/index.js').EnforcementLevel;
      gate?: boolean;
      kickback_target?: boolean;
    };
    if (!c.after || !c.skill) continue;
    additions.push({
      name,
      after: c.after,
      skill: c.skill,
      enforcement: c.enforcement ?? 'advisory',
      gate: c.gate,
      kickbackTarget: c.kickback_target,
    });
  }

  // Resolve insertions iteratively. Each pass inserts every custom whose
  // `after` target is already present in `result`, then repeats. Within a
  // pass, customs are processed in config-file order; for same-target
  // siblings we track the last inserted index so each subsequent sibling
  // lands AFTER the previous one (preserving file order for execution).
  //
  // Customs whose `after` target never resolves (typo, broken chain) are
  // skipped here — the validator catches that separately and surfaces the
  // error.
  const pending = [...additions];
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    const stillPending: Addition[] = [];
    // Track, for each `after` target processed this pass, the index at which
    // the LAST sibling was inserted. The next sibling goes one slot later.
    const lastInsertByTarget = new Map<string, number>();
    for (const custom of pending) {
      const existingIdx = result.findIndex((s) => s.name === custom.after);
      if (existingIdx === -1) {
        stillPending.push(custom);
        continue;
      }
      const siblingAnchor = lastInsertByTarget.get(custom.after);
      const insertAt = (siblingAnchor !== undefined ? siblingAnchor : existingIdx) + 1;
      const targetStep = result[existingIdx];
      const newStep: StepDefinition = {
        name: custom.name as StepName,
        label: custom.name,
        phase: targetStep.phase,
        enforcement: custom.enforcement,
        prerequisites: [custom.after as StepName],
        skippableForTiers: [],
        isCheckpoint: false,
        skillName: custom.skill,
        // A custom step joins the gate loop iff it's inserted among loop steps:
        // it inherits the `after` target's loopGate (explicit config `gate`
        // overrides). kickbackTarget is opt-in only (explicit `kickback_target`).
        loopGate: custom.gate ?? targetStep.loopGate,
        kickbackTarget: custom.kickbackTarget ?? false,
      };
      result.splice(insertAt, 0, newStep);
      lastInsertByTarget.set(custom.after, insertAt);
      progress = true;
    }
    pending.length = 0;
    pending.push(...stillPending);
  }

  return result;
}
