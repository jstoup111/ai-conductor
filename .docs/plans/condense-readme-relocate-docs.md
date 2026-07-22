# Implementation Plan: Condense README to a front-door; relocate reference into `docs/`

**Date:** 2026-07-22
**Stories:** `.docs/stories/condense-readme-relocate-docs.md`
**Complexity:** Small (`.docs/complexity/condense-readme-relocate-docs.md`)
**Track:** technical (`.docs/track/condense-readme-relocate-docs.md`)
**Source-Ref:** `jstoup111/ai-conductor#787`
**Conflict check:** Skipped (Small tier — no inter-story state/resource contention)

## Summary
Relocate the deep-reference content out of the 2139-line root `README.md` into seven
in-repo `docs/` topic guides (beside `docs/runbooks/`), condense the README into a
front-door + Documentation index, update the "Docs track features" pointers, and prove
zero content loss / zero broken links via three verification checks. 13 tasks.

## Technical Approach
This is a **content relocation**, not a code change — no production surface is added, so
every task's `Wired-into:` is `none (no new production surface)` (the verification checks
are test infrastructure). The work proceeds in three arcs:

1. **Relocate (Tasks 1–7):** one task per topic guide. Each task *creates* `docs/<guide>.md`
   with the mapped sections (headings + prose preserved verbatim, lightly re-headed for the
   guide's top matter) and *removes* those sections from `README.md`. Because every relocation
   edits `README.md`, the seven tasks are chained (each depends on the previous) to serialize
   README edits and avoid clobbering. `src/conductor/README.md` and `docs/runbooks/` are never
   touched by these tasks.
2. **Front-door (Tasks 8–10):** condense the residual README (goal paragraph + minimal Quick
   Start linking to `docs/getting-started.md`), add the `## Documentation` index that links
   every guide, and update the doc-upkeep convention pointers in `CLAUDE.md` / `HARNESS.md`.
3. **Verify (Tasks 11–13):** the negative-path stories become explicit check tasks — a link
   integrity check (Story 4), a README length + heading-shape check (Story 1), and a
   distinctive-string zero-loss check (Story 3). These are the acceptance specs
   `/writing-system-tests` will realize as the RED phase; they are scripted, deterministic,
   and re-runnable in CI.

The target taxonomy is fixed by the stories' target-structure table; the guide *boundaries*
below transcribe it. Every source section must land in exactly one guide and stay reachable
from the README index.

## Prerequisites
- `docs/` already exists (holds `runbooks/`); no scaffolding needed.
- Capture the pre-change `README.md` (e.g. `git show HEAD:README.md`) as the zero-loss baseline
  the Task 13 check diffs against.

## Tasks

### Task 1: Relocate "Choosing a Conductor" → `docs/choosing-a-conductor.md`
**Story:** Story 3 (zero-loss relocation) — `Choosing a Conductor`, `Command syntax and unknown-command guard`
**Type:** infrastructure

**Steps:**
1. Write failing check: assert `docs/choosing-a-conductor.md` exists and contains the
   "Choosing a Conductor" and "Command syntax and unknown-command guard" content, and that
   `README.md` no longer contains those section bodies.
2. Verify it fails (RED).
3. Create `docs/choosing-a-conductor.md` with the relocated sections (headings preserved);
   remove them from `README.md`, leaving the residual README's later cross-links to be fixed
   in Task 9/11.
4. Verify the check passes (GREEN).
5. Commit: "docs: relocate Choosing a Conductor to docs/choosing-a-conductor.md".

**Files likely touched:**
- `docs/choosing-a-conductor.md` — new guide (relocated content)
- `README.md` — remove `## Choosing a Conductor` + `### Command syntax` bodies

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: Relocate getting-started depth → `docs/getting-started.md`
**Story:** Story 3 — fuller install / `How the Pieces Fit Together` detail / `What Your Project Gets` / `Adding Tech-Context for New Stacks`
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/getting-started.md` exists and holds the fuller install detail,
   the `What Your Project Gets` and `Adding Tech-Context for New Stacks` sections; README keeps
   only a condensed install + a short "How the Pieces Fit Together".
2. Verify RED.
3. Create `docs/getting-started.md`; move the depth out of `README.md` (keep a condensed
   install + short orientation inline).
4. Verify GREEN.
5. Commit: "docs: relocate getting-started depth to docs/getting-started.md".

**Files likely touched:**
- `docs/getting-started.md` — new guide
- `README.md` — trim Install; move `What Your Project Gets`, `Adding Tech-Context`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: Relocate configuration reference → `docs/configuration.md`
**Story:** Story 3 — `Configuration` (`Full reference`, `Model fallback ladder`, `Operator identity & owner gate`, `Harness self-host guardrails`, `Plugins`)
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/configuration.md` exists and contains the full config-key
   reference + model ladder + owner gate + self-host guardrails + plugins; README's
   `## Configuration` body is gone (a one-line pointer may remain).
2. Verify RED.
3. Create `docs/configuration.md` with the relocated `## Configuration` subtree; remove it
   from `README.md`.
4. Verify GREEN.
5. Commit: "docs: relocate configuration reference to docs/configuration.md".

**Files likely touched:**
- `docs/configuration.md` — new guide
- `README.md` — remove `## Configuration` subtree

**Wired-into:** none (no new production surface)
**Dependencies:** Task 2

### Task 4: Relocate daemon operations → `docs/daemon-operations.md`
**Story:** Story 3 — `halt-issues sweep`, `overlap-scan`, `Priority scheduling`, `Rate-Limit Episode Coordination`, `Halt-PR presentation reliability`, `Claim-time delivery guard and recovery`, `Brain Loop Supervision`, `Sandbox auth-expiry park-and-poll`, `Daemon build-auth`
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/daemon-operations.md` exists and contains all nine daemon-ops
   subsections (currently mis-nested under `## Quick Start`); those bodies are gone from
   `README.md`.
2. Verify RED.
3. Create `docs/daemon-operations.md`; remove the daemon-ops subsections from `README.md`
   (this is the bulk of the 926-line "Quick Start" bleed).
4. Verify GREEN.
5. Commit: "docs: relocate daemon operations to docs/daemon-operations.md".

**Files likely touched:**
- `docs/daemon-operations.md` — new guide
- `README.md` — remove daemon-ops subsections nested under Quick Start

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 5: Relocate observability → `docs/observability.md`
**Story:** Story 3 — `Attribution enforcement`, `Task-stamp telemetry and attribution spot-audit`, `OpenTelemetry observability`, `Intra-step build progress & stall events`
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/observability.md` exists and contains the attribution +
   telemetry + OpenTelemetry + build-progress/stall-event sections; gone from `README.md`.
2. Verify RED.
3. Create `docs/observability.md`; remove those sections from `README.md`.
4. Verify GREEN.
5. Commit: "docs: relocate observability/telemetry to docs/observability.md".

**Files likely touched:**
- `docs/observability.md` — new guide
- `README.md` — remove attribution/telemetry/OTel/build-progress sections

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 6: Relocate intake reference → `docs/intake.md`
**Story:** Story 3 — `Intake-Issue Shape: WHAT vs. HOW`, `Intake-Only Criteria Enforcement`
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/intake.md` exists and contains the intake-shape and
   intake-criteria-enforcement sections; gone from `README.md`.
2. Verify RED.
3. Create `docs/intake.md`; remove those sections from `README.md`.
4. Verify GREEN.
5. Commit: "docs: relocate intake reference to docs/intake.md".

**Files likely touched:**
- `docs/intake.md` — new guide
- `README.md` — remove intake-shape + criteria-enforcement sections

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

### Task 7: Relocate architecture → `docs/architecture.md`
**Story:** Story 3 — `How It Works` (SDLC Flow, Skills, Agent Personas, Enforcement Levels, Tech-Context), `TypeScript Conductor (src/conductor/)`, `Project Structure`
**Type:** infrastructure

**Steps:**
1. Write failing check: `docs/architecture.md` exists and contains `How It Works`,
   `TypeScript Conductor`, and `Project Structure`; gone from `README.md`.
2. Verify RED.
3. Create `docs/architecture.md`; remove those sections from `README.md`.
4. Verify GREEN.
5. Commit: "docs: relocate architecture overview to docs/architecture.md".

**Files likely touched:**
- `docs/architecture.md` — new guide
- `README.md` — remove `How It Works`, `TypeScript Conductor`, `Project Structure`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 8: Condense the residual README into a front-door
**Story:** Story 1 (README is a short front-door)
**Type:** happy-path

**Steps:**
1. Write failing check: `README.md` top-level headings are exactly {goal/intro (no heading or
   a short lead), `Requirements`, `Install`, `How the Pieces Fit Together`, `Quick Start`,
   `Documentation`, `Key Design Principles`}; `## Quick Start` links to
   `docs/getting-started.md` and is a minimal end-to-end example.
2. Verify RED.
3. Add/keep a one-paragraph goal/what-it-does lead; trim `## Quick Start` to a minimal
   end-to-end path with a link to `docs/getting-started.md`; ensure no relocated section
   bodies remain.
4. Verify GREEN.
5. Commit: "docs: condense README into a front-door".

**Files likely touched:**
- `README.md` — add goal lead; minimize Quick Start; final front-door trim

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 9: Add the `## Documentation` index
**Story:** Story 2 (Documentation index links every guide)
**Type:** happy-path

**Steps:**
1. Write failing check: `README.md` has a `## Documentation` section linking each `docs/*.md`
   topic guide, `docs/runbooks/`, and `src/conductor/README.md`, each with a one-line
   description; every link target exists.
2. Verify RED.
3. Author the `## Documentation` index.
4. Verify GREEN.
5. Commit: "docs: add Documentation index to README".

**Files likely touched:**
- `README.md` — add `## Documentation` index

**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 10: Update "Docs track features" pointers
**Story:** Story 5 (doc-upkeep pointers name the new locations)
**Type:** happy-path

**Steps:**
1. Write failing check: `CLAUDE.md`'s Documentation Upkeep block names the relevant `docs/`
   guides (e.g. config → `docs/configuration.md`, daemon options → `docs/daemon-operations.md`)
   rather than only `README.md`; `HARNESS.md`'s "Docs track features" line is reconciled; any
   `src/conductor/README.md` link to a moved root-README section resolves to the new location.
2. Verify RED.
3. Update `CLAUDE.md` (lines ~111-124), `HARNESS.md` (~460), and reconcile `src/conductor/README.md`.
4. Verify GREEN.
5. Commit: "docs: point Docs-track-features upkeep at the new docs/ guides".

**Files likely touched:**
- `CLAUDE.md` — Documentation Upkeep pointers
- `HARNESS.md` — "Docs track features" convention line
- `src/conductor/README.md` — reconcile any links to moved root-README sections

**Wired-into:** none (no new production surface)
**Dependencies:** Task 9

### Task 11: Link-integrity check (no dangling links)
**Story:** Story 4 (cross-references intact) — negative path
**Type:** negative-path

**Steps:**
1. Write failing check: a script/test that resolves every relative Markdown link and intra-repo
   anchor across `README.md` + `docs/*.md` and fails on any broken target; run it against an
   intentionally-broken fixture to see it fail (RED).
2. Verify RED.
3. Implement the check (a `test/` script or reuse an existing markdown-link-check tool); fix any
   real broken links it surfaces in `README.md`/`docs/`.
4. Verify GREEN (zero broken links).
5. Commit: "test: link-integrity check over README + docs/".

**Files likely touched:**
- `test/docs-link-check.sh` — new link-integrity check (test infra)
- `README.md`, `docs/*.md` — fix any broken links surfaced

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

### Task 12: README length + heading-shape check
**Story:** Story 1 (README is a short front-door) — negative path
**Type:** negative-path

**Steps:**
1. Write failing check: assert `wc -l README.md` ≤ 300 AND the top-level heading set equals the
   front-door set (no relocated headings present as inline bodies).
2. Verify RED (against the pre-condense README, which is > 300 lines).
3. Implement the check as a `test/` assertion; if README exceeds budget, push more depth into
   `docs/getting-started.md` until it passes.
4. Verify GREEN.
5. Commit: "test: README length + front-door heading-shape check".

**Files likely touched:**
- `test/readme-shape-check.sh` — new check (test infra)
- `README.md` — trim to satisfy the ≤ 300-line budget if needed

**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

### Task 13: Zero-loss distinctive-string check
**Story:** Story 3 (zero-loss relocation) — negative path
**Type:** negative-path

**Steps:**
1. Write failing check: for a curated list of ≥ 1 distinctive string per relocated section
   (a config key, a subcommand name, an event/field name — drawn from the Prerequisites
   baseline of the pre-change README), assert each string is present somewhere under `docs/`.
2. Verify RED (against a stage where a section was not yet relocated).
3. Implement the check as a `test/` script fed by the curated string list.
4. Verify GREEN (every baseline string still findable under `docs/`).
5. Commit: "test: zero-loss distinctive-string check for relocated docs".

**Files likely touched:**
- `test/docs-content-preservation-check.sh` — new check (test infra)
- `docs/*.md` — restore any string the check reports missing

**Wired-into:** none (no new production surface)
**Dependencies:** Task 12

## Task Dependency Graph
```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7   (relocate guides; serialize README edits)
                                                          ↓
                                        Task 8 (condense front-door)
                                                          ↓
                                        Task 9 (Documentation index)
                                                          ↓
                                        Task 10 (upkeep pointers)
                                                          ↓
              Task 11 (link check) → Task 12 (length/shape) → Task 13 (zero-loss)
```

## Integration Points
- After Task 9: the README front-door + Documentation index is navigable end-to-end — a reader
  can reach every relocated guide from the README.
- After Task 13: all three acceptance checks (link integrity, README shape, zero content loss)
  pass together — the feature is verifiable in CI.

## Verification
- [ ] All happy-path criteria covered: Story 1 (Tasks 8, 12), Story 2 (Task 9), Story 5 (Task 10)
- [ ] All negative-path criteria covered: Story 1 NP (Task 12), Story 2 NP (Task 9 check),
      Story 3 NP (Task 13), Story 4 NP (Task 11), Story 5 NP (Task 10 check)
- [ ] Every relocated source section (Story 3) has a create+remove task (Tasks 1–7)
- [ ] Dependencies are explicit and acyclic (linear chain)
- [ ] Every task carries a `**Wired-into:**` line (`none (no new production surface)` — docs/test only)
