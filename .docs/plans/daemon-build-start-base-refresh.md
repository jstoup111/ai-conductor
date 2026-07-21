# Implementation Plan: config-driven custom-step framework + build-start base-refresh instance

Stem: daemon-build-start-base-refresh
Track: technical
Tier: M

## Goal

Generalise the conductor into a config-driven custom-step framework: a repo declares extra
pipeline steps under `.ai-conductor/config.yml` `steps:`, each with an `after:` insertion point
and EXACTLY ONE body — `skill:` (SKILL.md), `action:` (engine-native deterministic action), or
hook-only (`hooks.before` script). The engine splices them into the sequence for that repo only
(daemon-gated, nothing global). Then wire the build-start base-refresh as one instance in THIS
repo's config (`after: plan`, `action: base-refresh`), so `git fetch origin` + rebase onto
`origin/<default>` runs before any build task — evidence anchors then sit on the already-rebased
base (removing, not re-introducing, the #535/PR-593 anchor-unreachable class). Reuse
`resolveBase`/`performRebase`/`runGatedRebaseResolution` verbatim.

## Files

- `src/conductor/src/types/config.ts` — add `action?: string` to `StepConfig`; doc skill-optional.
- `src/conductor/src/engine/config.ts` — relax custom-step validation (skill optional when
  `action`/`hooks.before` present; reject no-body and multi-body; validate `action` names against
  the registry; add `after:` cycle detection).
- `src/conductor/src/engine/steps.ts` — `buildStepRegistry`: accept skill-less customs
  (`action`/hook-only); stop requiring `skill`.
- `src/conductor/src/engine/actions.ts` (new) — engine-action registry; first entry
  `base-refresh` composing `discoverLocalBase`/`resolveBase`/`performRebase`/
  `runGatedRebaseResolution`, daemon-gated, conflict→HALT, no-origin→noop.
- `src/conductor/src/engine/conductor.ts` + `engine/hooks.ts` — wire the step-body dispatch:
  route a custom step to skill vs. action vs. hook-only, and actually call `runWithHooks`
  (currently unwired) so before/after hooks run around every step body.
- `src/conductor/test/` — framework + action + validation tests.
- `.ai-conductor/config.yml` (this repo) — declare the base-refresh custom step.
- `src/conductor/README.md` — document the `steps:` custom-step schema (skill/action/hook bodies)
  and the base-refresh instance.
- `CHANGELOG.md` — required `## [Unreleased]` entry.

## Non-goals

- **Not a bespoke build-start step.** (Explicit correction from PR #603 review: general
  framework + one wired instance.)
- **No change to the ship-time `rebase` step.** It stays (merges landing *during* the build);
  #593's patch-id translation covers that residual window.
- **No new git logic.** The `base-refresh` action composes existing tested primitives.
- **No consumer-facing default.** `steps:` is empty for consumers; interactive/test = no-op.
- **Not #598** (stale engine binary) — separate effort; cross-reference only.
- **No VERSION bump** (frozen 0.99.19). Additive config → MINOR-worthy; deferred to 1.0.
- **No generic `daemon_only` step knob** — the base-refresh ACTION self-gates on `!daemon`; a
  generic per-step daemon gate is out of scope.

## Load-bearing assumptions (surfaced)

1. **base-refresh must be an engine `action`, NOT a bash `hooks.before`.** A detached shell hook
   cannot reuse the in-process `resolveBase`/`performRebase`/`runGatedRebaseResolution` and would
   lose the gated `/rebase` resolver + CHANGELOG auto-resolve + fail-closed HALT. The generic
   hook-only body is still specced (non-git deterministic steps), but base-refresh uses the
   engine-action path. THE primary design reconciliation.
2. **The framework skeleton pre-exists** (StepConfig fields, `buildStepRegistry` insertion,
   validator, `runWithHooks`) — this is completion + relaxation, not greenfield. Reduces risk.
3. **`runWithHooks` has no callers today** — wiring hook/action dispatch into the loop is real
   net work and the primary scope risk (STEP_PROMPTS is keyed by built-in `StepName`, so
   non-skill / custom-name dispatch needs explicit routing). If deeper than expected, tier edges
   toward L.
4. **Enforcement semantics:** `advisory` failure → logged, loop continues; `gating`/`structural`
   failure → blocks/HALT. base-refresh uses `structural`; its intrinsic `conflict_halt` HALTs
   regardless of declared level (fail-closed can't be downgraded).
5. **`after:`/cycle validation:** unknown targets already rejected; add explicit cycle detection
   so cyclic sibling customs fail loudly instead of being silently dropped by the iterative pass.
6. **Phase/loop inheritance & anchor-safety:** `after: plan` → the step inherits DECIDE phase and
   runs before the first BUILD step; `gate: false` keeps it out of the tail loop. Because it runs
   before any evidence commit, the #535 anchor benefit holds.

## Tasks (2–5 min each)

1. **Add `action?: string` to `StepConfig`** (`types/config.ts`) with docs: a custom step's body
   is exactly one of `skill:` / `action:` / hook-only (`hooks.before`); `hooks` may also wrap a
   skill/action body. Compile.

2. **Define the engine-action registry** (`engine/actions.ts`, new): an exported
   `Record<string, EngineAction>` and an `EngineAction` type
   `(ctx: { git, projectRoot, daemon, config, events }) => Promise<ActionResult>`. Export the
   valid-action-name set for the validator.

3. **RED: validator tests** (`test/`) — assert: skill-less custom with `action` or `hooks.before`
   is accepted; no-body custom rejected; multi-body (skill+action) rejected; unknown `action`
   name rejected; unknown `after` rejected; `a↔b` cycle rejected with a cycle message.

4. **Relax + extend the validator** (`engine/config.ts`): replace the hard `requires 'skill:'`
   with "requires exactly one body (skill|action|hooks.before)"; validate `action` ∈ registry;
   add sibling-cycle detection (walk `after` edges among customs; a back-edge → error).

5. **RED: `buildStepRegistry` tests** — a skill-less `action`/hook-only custom is inserted at
   `after`; multi-custom + same-`after` file-order preserved; no `steps:` → stock `ALL_STEPS`.

6. **Relax `buildStepRegistry`** (`engine/steps.ts`): accept customs whose body is `action` or
   `hooks.before` (drop the `!c.skill → continue`); carry `action`/hook metadata onto the
   inserted `StepDefinition` (extend it with an optional `action?`/`bodyKind` marker as needed).

7. **RED: base-refresh action tests** — daemon+stale → performRebase onto `origin/<default>`,
   HEAD descends origin default; `conflict_halt` → `runGatedRebaseResolution` then `.pipeline/HALT`,
   no dispatch; `!daemon` and no-origin/failed-fetch → `noop`; runs once. Reuse the rebase-test
   git-runner stubs.

8. **GREEN: implement the `base-refresh` action** (`engine/actions.ts`): `discoverLocalBase` →
   `performRebase(git, projectRoot, localBase)` → `runGatedRebaseResolution`; `!daemon` →
   `noop`; `conflict_halt` unresolved → write HALT + signal block. Register under `base-refresh`.

9. **GREEN: wire step-body dispatch** (`engine/conductor.ts` + `engine/hooks.ts`): for a custom
   step, route to (a) engine-action via the registry, (b) skill via the existing skill path, or
   (c) hook-only (before-hook IS the body); wrap every body in `runWithHooks` so
   `hooks.before`/`hooks.after` finally execute. Map body exit/outcome → step verdict per
   `enforcement`.

10. **Wire the base-refresh instance** in this repo's `.ai-conductor/config.yml`:
    ```yaml
    steps:
      build-start-base-refresh:
        after: plan
        action: base-refresh
        enforcement: structural
        gate: false
    ```
    with a comment explaining daemon-only, fail-closed, and the #535 anchor benefit.

11. **Anchor-safety test** (Story 2 / #535): a daemon run where the action rebased, a later
    commit's sha-anchor is reachable from the rebased base, and the ship-time `rebase` is a
    `noop` when nothing merged in between (`isBranchCurrent`).

12. **Docs**: document the `steps:` custom-step schema (three body kinds, `after`, `enforcement`,
    `gate`, `hooks`, cycle rules) and the base-refresh instance in `src/conductor/README.md`; add
    the `## [Unreleased] → Added` CHANGELOG line.

13. **Validate**: run `test/test_harness_integrity.sh` and the conductor vitest suite
    (`cd src/conductor && rtk proxy npx vitest run`) from the correct cwd; confirm green.

## Migration

Additive: new optional `action` field + opt-in `steps:` entries; no existing behavior changes
when `steps:` is absent, and no `settings.json`/hook-wiring/CLI/symlink schema change → no
migration block required. If the self-host release gate's path classifier flags `engine/`/
`types/` as a breaking surface, attach a `.docs/release-waivers/daemon-build-start-base-refresh.md`
waiver (internal-only: additive, opt-in, no consumer-visible CLI/hook/schema change) rather than
an empty migration block.
