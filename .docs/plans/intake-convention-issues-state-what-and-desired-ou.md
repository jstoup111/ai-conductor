# Implementation Plan: Intake convention — issues state WHAT and desired OUTCOMES; DECIDE owns HOW

**Date:** 2026-07-10
**Design:** technical track — no PRD; intent captured in `.docs/track/intake-convention-issues-state-what-and-desired-ou.md`
**Stories:** `.docs/stories/intake-convention-issues-state-what-and-desired-ou.md`
**Conflict check:** skipped — Tier S (see `.docs/complexity/intake-convention-issues-state-what-and-desired-ou.md`)
**Source:** jstoup111/ai-conductor#490

## Summary

Markdown/YAML-only change in 7 tasks: a GitHub intake issue form, a deterministic
integrity check for it, the HARNESS.md WHAT/HOW convention rule, README documentation,
and hypothesis-reframing instructions in the engineer and explore skills.

## Technical Approach

Three legs, deterministic-first:

- **Deterministic scaffolding:** `.github/ISSUE_TEMPLATE/intake.yml` (GitHub *issue form*;
  the repo is public so forms are supported) with four textarea fields — Observed
  (required), Impact (optional), Desired outcome (required), Hypotheses (optional,
  captioned as the filer's guesses; DECIDE owns HOW). Blank issues stay enabled: we add
  NO `config.yml`. Because a malformed issue form silently degrades to a blank form on
  github.com, `test/test_harness_integrity.sh` gains a check that every
  `.github/ISSUE_TEMPLATE/*.yml` parses as YAML (via `python3` + pyyaml when available,
  falling back to `node` + `js-yaml` from `src/conductor/node_modules`, else warn-skip)
  and that no `config.yml` sets `blank_issues_enabled: false`.
- **Binding rule:** a new bullet in HARNESS.md `## Key Conventions` (line ~390) directly
  after **"PRDs are product-only"**, named as its intake-level twin: intake issues state
  WHAT (Observed evidence, Impact) and desired OUTCOMES (observable); solution content
  appears only as explicitly-labeled Hypotheses; the engineer's DECIDE phase owns HOW.
  The rule explicitly covers agents filing issues via `gh issue create` on the
  operator's behalf (web templates do not auto-apply there). README.md documents the
  shape in its intake section.
- **Judgment layer:** `skills/engineer/SKILL.md` step 1 (capture, line ~59) gains the
  reframing instruction — embedded solution content travels into DECIDE as the filer's
  hypothesis; a pure design-sketch with no stated problem forces deriving/confirming the
  WHAT with the operator first; step 3 threads the problem/outcome framing (not the
  sketch) into `/explore`. `skills/explore/SKILL.md` §3 (Propose Approaches, line ~57)
  gains the conditional divergence rule — an embedded design is at most one candidate,
  ≥1 genuine alternative is mandatory, and the filer's idea may still win on merits.

Sequencing: the integrity check lands before the template it validates (RED→GREEN);
doc/skill edits are independent; CHANGELOG + full validation close.

Note for SHIP: semver rule says an additive HARNESS.md rule is MINOR, but VERSION is
frozen at 0.99.19 until v1.0 — resolve any version-gate HALT by writing the CURRENT
version per standing operator policy. No canonical breaking surface is touched (no
skill add/rename, no hook wiring, no CLI/schema change) — no migration block needed.

## Prerequisites

- None (no code, no migrations; `python3` with pyyaml present on the runner is optional
  — the new check must warn-skip when no YAML parser is available, never false-fail).

## Tasks

### Task 1: Integrity check — issue-template YAML validity + blank-issues guard
**Story:** Intake issue template scaffolds the WHAT/outcomes shape — negative paths (malformed YAML silently degrades; blank issues must stay available)
**Type:** negative-path

**Steps:**
1. Write failing check: add a section to `test/test_harness_integrity.sh` that (a) for
   every file matching `.github/ISSUE_TEMPLATE/*.yml`/`*.yaml`, parses it with
   `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"` when python3+pyyaml
   is available, else `node -e "require('js-yaml').load(...)"` resolved from
   `src/conductor/node_modules`, else prints a warn-skip (never fails for a missing
   parser); (b) fails if `.github/ISSUE_TEMPLATE/config.yml` exists and contains
   `blank_issues_enabled: false`.
2. Verify RED: create a scratch `.github/ISSUE_TEMPLATE/scratch.yml` containing invalid
   YAML (e.g. `foo: [unclosed`), run the suite, confirm the new check fails; delete the
   scratch file.
3. Verify GREEN: run `test/test_harness_integrity.sh` with no template present — the new
   check passes vacuously and the whole suite stays green (`bash -n` covers the edit).
4. Commit.

**Files:**
- test/test_harness_integrity.sh — new issue-template validation section

**Dependencies:** none

### Task 2: Create the intake issue form
**Story:** Intake issue template scaffolds the WHAT/outcomes shape — happy paths
**Type:** happy-path

**Steps:**
1. Create `.github/ISSUE_TEMPLATE/intake.yml` — an issue form with
   `name: Intake idea`, a description stating "state WHAT and desired outcomes; the
   engineer (DECIDE) owns HOW", and four `textarea` fields:
   - **Observed** — evidence of the problem (`validations.required: true`)
   - **Impact** — who/what hurts, how often (optional)
   - **Desired outcome** — observable behavior that must hold afterward
     (`validations.required: true`)
   - **Hypotheses** — optional; field description states these are the filer's guesses
     about HOW, not requirements — DECIDE weighs alternatives and may discard them.
   Do NOT add `.github/ISSUE_TEMPLATE/config.yml`.
2. Run `test/test_harness_integrity.sh` — Task 1's check now exercises the real file and
   passes (GREEN).
3. Commit.

**Files:**
- .github/ISSUE_TEMPLATE/intake.yml — new intake issue form

**Dependencies:** Task 1

### Task 3: HARNESS.md Key Conventions rule — intake states WHAT+outcomes, DECIDE owns HOW
**Story:** HARNESS.md carries the intake-level WHAT/HOW convention rule — happy paths + labeled-hypotheses carve-out
**Type:** happy-path

**Steps:**
1. In `HARNESS.md` `## Key Conventions`, insert a new bullet **immediately after** the
   "PRDs are product-only" bullet: **"Intake states WHAT and outcomes — DECIDE owns
   HOW."** Body: intake issues state the problem (Observed evidence), its Impact, and
   Desired outcomes (stated observably); they must NOT prescribe the implementation.
   Solution ideas are welcome only under an explicitly-labeled **Hypotheses** section —
   the filer's guesses, which DECIDE treats as one candidate among alternatives, never
   as requirements. Name it the intake-level twin of "PRDs are product-only". Include:
   this binds *agents filing intake issues on the operator's behalf via `gh issue
   create`* (issue templates auto-apply only on web/mobile) — such agents must follow
   the Observed / Impact / Desired outcome / Hypotheses shape in the issue body.
2. Run `test/test_harness_integrity.sh` — additive prose; model-table and structural
   checks must stay green.
3. Commit.

**Files:**
- HARNESS.md — new Key Conventions bullet

**Dependencies:** none

### Task 4: README documents the intake-issue shape
**Story:** HARNESS.md carries the intake-level WHAT/HOW convention rule — Done When (docs track features)
**Type:** happy-path

**Steps:**
1. In `README.md`'s engineer-intake section (near the "engineer's intake system"
   passages, ~lines 535–600), add a short subsection documenting the intake-issue
   shape: the four sections, which are required, the WHAT/HOW division, and a pointer
   to the `Intake idea` issue form and the HARNESS.md convention.
2. Run `test/test_harness_integrity.sh`.
3. Commit.

**Files:**
- README.md — intake-issue shape documentation

**Dependencies:** Task 3 (references the rule's final wording)

### Task 5: Engineer skill — capture reframes embedded designs as hypotheses
**Story:** Engineer capture treats embedded solution content as hypothesis — happy path + pure-sketch negative path
**Type:** happy-path

**Steps:**
1. In `skills/engineer/SKILL.md` step "1. Capture the idea" (~line 59), add the
   instruction: if the claimed/received idea text embeds solution content ("Fix
   direction", "Design sketch", "Proposal", named seams/functions — template-shaped or
   not), treat it as the **filer's hypothesis**: carry it into DECIDE labeled as such,
   and frame the idea for routing and `/explore` by its problem + desired outcomes, not
   the sketch. If the idea is a *pure* design sketch with no stated problem/outcome,
   derive the WHAT and confirm it with the operator before proceeding — never spec the
   sketch verbatim as the requirement.
2. In step 3 (DECIDE), add one line threading this into the `/explore` handoff: pass
   the problem/outcome statement as primary framing and the hypothesis as context
   explicitly marked as a candidate, not the chosen approach.
3. Run `test/test_harness_integrity.sh` (frontmatter, cross-skill references intact).
4. Commit.

**Files:**
- skills/engineer/SKILL.md — capture-time hypothesis reframing + explore handoff framing

**Dependencies:** none

### Task 6: Explore skill — mandatory divergence when a design is embedded
**Story:** Explore still diverges when the idea carries an embedded design — happy path + may-still-win + no-ceremony negative paths
**Type:** happy-path

**Steps:**
1. In `skills/explore/SKILL.md` §"3. Propose Approaches" (~line 57), add a conditional
   rule: when the incoming idea carries an embedded solution design (a filer
   hypothesis), (a) it enters as **at most one** candidate approach, (b) at least one
   genuine alternative NOT derived from the filer's sketch MUST be generated and
   weighed, (c) the hypothesis may still be recommended when it wins on merits —
   the rule prevents default adoption (anchoring), not the idea itself. When the idea
   has no embedded design, behavior is unchanged (no added ceremony).
2. Run `test/test_harness_integrity.sh`.
3. Commit.

**Files:**
- skills/explore/SKILL.md — conditional embedded-design divergence rule

**Dependencies:** none

### Task 7: CHANGELOG entry + full validation
**Story:** all — Done When (harness release gate)
**Type:** infrastructure

**Steps:**
1. Add to `CHANGELOG.md` under `## [Unreleased]` / `### Added`: intake-issue
   WHAT/outcomes convention — intake issue form, HARNESS.md rule, engineer/explore
   skill divergence instructions, issue-template integrity check (refs #490).
2. Run `test/test_harness_integrity.sh` end-to-end one final time; all checks green.
3. Commit.

**Files:**
- CHANGELOG.md — Unreleased entry

**Dependencies:** Tasks 1–6

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ─────────┐
Task 3 ──▶ Task 4 ─────────┼──▶ Task 7
Task 5 ────────────────────┤
Task 6 ────────────────────┘
```

## Integration Points

- After Task 2: the template + its integrity check are verifiable locally
  (`test/test_harness_integrity.sh`); post-merge, the new-issue chooser on GitHub shows
  the "Intake idea" form (manual-test confirms it renders, i.e. did not degrade to
  blank).
- After Task 6: a claimed intake idea carrying a design sketch exercises the full
  judgment layer (engineer reframe → explore divergence) on the next `/engineer` run.

## Verification

- [ ] All happy path criteria covered: template fields/optionality (Task 2), HARNESS rule
      incl. gh-CLI agents (Task 3), README (Task 4), engineer reframing (Task 5),
      explore divergence (Task 6)
- [ ] All negative path criteria covered: blank-issues guard + malformed-YAML check
      (Task 1), labeled-hypotheses carve-out + suite-green (Task 3), pure-sketch
      fallback (Task 5), may-still-win + no-ceremony (Task 6)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
