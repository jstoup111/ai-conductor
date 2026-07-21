# ADR: wiring_check gate — deterministic reachability verification with layered probe

**Date:** 2026-07-12
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session (intake jstoup111/ai-conductor#462)

## Context

Given the `Wired-into:` contract (adr-2026-07-12-wired-into-contract), the engine needs a
deterministic gate that verifies it. Constraints verified in source:

- Gate machinery is selector-driven: `ALL_STEPS` in `src/engine/steps.ts` (build_review at :145
  is the template — `gating`, `loopGate:true`, sits between build and manual_test whose
  `prerequisites` are currently `['build_review']`).
- Evidence-file gate pattern: `ACCEPTANCE_SPECS_RED_EVIDENCE` + `validateAcceptanceRedEvidence`
  (`src/engine/artifacts.ts:458-539`).
- Injectable deterministic probe: `headPushedToUpstream(runGit: GitRunner, ...)`
  (`src/engine/push-evidence.ts:38`) via `CompletionContext`.
- Feature-diff base derivation already exists: the evidence-range ladder in
  `src/engine/autoheal.ts:308-414` (recorded anchor → `merge-base --fork-point
  origin/<default>` → plain merge-base).
- `typescript@^5.5.0` is already a dependency — the compiler API is available without a new dep.
- **The engine runs in consumer projects** (Rails, etc.), not only this TS repo — the probe
  cannot assume a TypeScript import graph or hard-coded entry-point paths.

## Options Considered

### Option A: TS import-graph reachability only
- **Pros:** strongest static guarantee for TS projects (transitive reachability from entry points).
- **Cons:** useless in non-TS consumer projects; hard-coded entry points are wrong outside this
  repo; module-level reachability alone still passes an imported-but-never-called symbol.

### Option B: Grep-based non-test-reference check only
- **Pros:** language-agnostic (works in every consumer project); same mechanism as the proven
  `/pipeline` superseded-symbol check; catches the #392 dead-callback class directly (a symbol
  with zero non-test references outside its defining file is orphaned).
- **Cons:** weaker than reachability — a symbol referenced by another orphaned module passes
  (orphan islands); no entry-point rooting.

### Option C (chosen): Layered probe — universal reference layer + TS reachability layer
- **Pros:** B everywhere, A where it's checkable; each layer is independently deterministic and
  fail-explainable; degradation is explicit, not silent.
- **Cons:** two code paths to maintain; the TS layer is the repo's first import-graph tooling.

## Decision

**Option C**, as a new step + predicate + probe:

1. **Step:** `wiring_check` inserted in `ALL_STEPS` after `build_review`, before `manual_test`
   (`manual_test.prerequisites` → `['wiring_check']`). `enforcement: 'gating'`,
   `loopGate: true`, `phase: 'BUILD'`, `skippableForTiers: []` (runs on every tier — it is the
   only net for Small). Failure writes `satisfied:false` with `kickback:{from:'wiring_check',
   evidence:<named gaps>}` re-opening `build`; `MAX_KICKBACKS_PER_GATE` provides the existing
   stall escalation. Never HALT on the happy path.
2. **Scope of "new symbols":** exported symbols added in the feature diff, computed from
   `git diff <base>...HEAD` where `<base>` comes from the existing evidence-range ladder
   (autoheal.ts) — no new base-derivation machinery.
3. **Layer 1 — universal (all projects): declared-site + reference check.**
   - Each `Wired-into: <path>#<symbol>` declared site must exist and contain a non-test
     reference to the named symbol (test paths excluded by the same patterns as the
     superseded-symbol check).
   - Backstop: every new exported symbol must have ≥1 non-test reference outside its defining
     file. Zero references ⇒ named gap: `«symbol» exported but referenced by no production code`.
   - A task adding new exports with no `Wired-into:` line ⇒ named gap (undeclared surface).
4. **Layer 2 — TS/JS projects (tsconfig/package.json detected): entry-point reachability.**
   - Module-level import graph built with the TypeScript compiler API, rooted at configured
     entry points; every new export's defining module must be transitively imported from a root
     via non-test edges. Unreachable ⇒ named gap: `«symbol» exported but unreachable from any
     entry point`.
   - **Entry points are per-project config** (`wiring.entry_points` in `.ai-conductor/config.yml`),
     defaulting for this repo to `src/index.ts`, `src/daemon-cli.ts`, `src/intake-loop-cli.ts`,
     `src/engine/engineer-cli.ts` (self-host config, not engine constants). Missing config in a
     TS project ⇒ Layer 2 skips with an explicit advisory line in the verdict reason (loud
     degradation, abstain-or-loud precedent #519), Layer 1 still gates.
5. **Waiver resolution is fail-closed:** `none (inert until <ref>)` — a repo-local path ref is
   checked on disk; an issue/PR ref is checked via `gh` (must exist and be open). A `gh` failure
   ⇒ `waiver ref unverifiable` named gap (fail-closed; a waiver is a bypass, so outages must not
   widen it). Verdict evidence records which form matched.
6. **Static-but-unexercised stays out of scope:** a symbol statically reachable yet never
   invoked at runtime remains the as-built architecture-review §12 sweep's job (`UNEXERCISED`
   notes). This gate is the deterministic floor, not a replacement for the LLM sweep.

## Consequences

### Positive
- The #392/#460/#179 classes fail mechanically at build time with a named, actionable gap.
- Reuses verdict/kickback/base-ref/evidence-file machinery — no new gate concepts.
- Consumer projects get real (if weaker) protection immediately; TS projects get reachability.

### Negative
- Static analysis has known blind spots: dynamic dispatch, reflection, config-string wiring
  (hooks/settings.json), re-export chains — Layer 1 can false-negative (orphan islands) and
  Layer 2 can false-positive on dynamic-only consumption (mitigation: declared-site check
  passes it; worst case the INERT waiver with a tracked ref).
- First import-graph tooling: build cost on large diffs and maintenance of test-path exclusion
  patterns.
- A gating step added to every build increases kickback surface; wrong gaps would ping-pong
  builds (capped by MAX_KICKBACKS_PER_GATE, then existing stall-halt).

### Follow-up Actions
- [ ] `src/engine/steps.ts`: add step, repoint `manual_test.prerequisites`.
- [ ] `src/engine/artifacts.ts`: `STEP_COMPLETION_CHECKS.wiring_check` + `WiringEvidence`
      validator (AcceptanceRedEvidence template).
- [ ] `src/engine/wiring-probe.ts` (new): Layer 1 + Layer 2, injectable via `CompletionContext`.
- [ ] `src/engine/autoheal.ts`: `WIRED_INTO_LINE` parser beside `FILES_LINE`.
- [ ] Config: `wiring.entry_points` schema + self-host default; docs in README +
      src/conductor/README.md; migration entry per release gates.
