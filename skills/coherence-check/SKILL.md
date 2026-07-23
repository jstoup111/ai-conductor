---
name: coherence-check
description: "Use at the end of DECIDE (after /plan), for Medium and Large tier specs only, to author the committed traceability mapping — outcomes → FRs → stories → tasks with per-row verdicts — that the land-time coherence gate validates. Not used for S tier."
enforcement: gating
phase: decide
standalone: true
requires: [verify-claims]
---

## Purpose

Authors `.docs/coherence/<plan-stem>.md`: a single committed artifact mapping every
intake outcome bullet, every PRD FR (product track), every story, and every plan task
to its counterpart ids with a per-row verdict. This artifact is the auditable
traceability record the operator (and the land-time coherence validator) reads instead
of trusting self-reported "everything's covered" prose in a spec PR.

**Correctness gate:** a row's verdict ("covered" vs "gap") is a judgment call, not a
mechanical grep. Per the `/verify-claims` protocol, ground every verdict in the actual
cited text — do not mark a row covered on the assumption that a plausible-looking
counterpart id exists; confirm it against the real artifact file.

## 1. Tier Rule (M/L only)

Read the spec's tier from `.docs/complexity/`.

- **Tier S:** this skill does NOT run. Skip it entirely — same treatment as
  architecture-diagram/architecture-review/conflict-check for S tier. No
  `.docs/coherence/` artifact is authored, and the land-time validator does not engage
  for S-tier specs (Story 13). Do not author a stub file "to be safe" — its mere
  presence is not required and produces work the S-tier exemption exists to avoid.
- **Tier M:** this skill runs, using the session's default model (no override).
- **Tier L:** this skill runs, pinned to opus for the dispatch (see Section 2).

## 2. Model Rule (M = session default, L = pinned opus)

This skill is tier-varying, the same pattern as `conflict-check` and `plan`:

- **M tier:** inherit whatever model the invoking session/step is already running —
  no pin.
- **L tier:** pin to **opus** for this dispatch. Large-tier specs have the widest
  fan-out of outcomes/FRs/stories/tasks and the highest cost of a missed transitive
  gap, so the semantic-judging pass needs the deepest reasoning tier.

The autonomous/daemon path resolves this via `DEFAULT_STEP_TIER_OVERRIDES.coherence_check.L`
in `resolved-config.ts` (wired in a later task); this SKILL.md documents the same rule
for interactive/phone-driven runs, where the operator's active session may not be opus
and must be told to escalate.

## 3. Inputs

Load, in order:

1. Staged/committed intake outcomes — `.pipeline/` staged outcomes file if present, or
   the committed `.docs/intake/<plan-stem>.md` marker if land has already run once.
   If neither exists (chat-origin idea), the outcome row class is not required.
2. The approved PRD (product track only) — `.docs/specs/<plan-stem>.md`, for its
   enumerated `FR-N` requirements.
3. The stories file — `.docs/stories/<plan-stem>.md`, for `**Requirement:**` and story
   ids.
4. The plan — `.docs/plans/<plan-stem>.md`, for `**Story:**` lines, task ids, and the
   plan's own `## Coverage Check` table if present.

## 4. Mapping-Artifact Format

Write `.docs/coherence/<plan-stem>.md`. The plan-stem in the filename MUST match the
plan's own filename stem exactly — the land validator rejects a stem mismatch as
missing-coherence-artifact even when a coherence file exists under a different name.

The artifact is a Markdown table (or one table per row class) with these columns:

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|

### 4a. Row Classes (exactly four)

1. **outcome** — one row per intake Desired-outcome bullet (skip this class entirely
   if no outcomes were staged/committed — an empty outcome layer is "not required,"
   never a gap). Cited id: `outcome-<n>` (1-based, in bullet order). Counterpart:
   the story id(s) that cover the bullet.
2. **fr** — one row per enumerated PRD `FR-N` (product track only; skip this class on
   the technical track). Cited id: `fr-<N>`. Counterpart: the story id(s) whose
   `**Requirement:**` line cites that FR.
3. **story** — one row per story id declared in the stories file. Cited id:
   `story-<id>`. Counterpart: the task id(s) whose `**Story:**` line cites that story.
4. **task** — one row per task in the plan's task tree. Cited id: `task-<id>`.
   Counterpart: the story id it serves, OR — for `infrastructure`/`refactor`-typed
   tasks — a non-empty supporting-purpose statement from the task's `**Story:**` line
   in place of a story id.

### 4b. Verdict Vocabulary

Use exactly these two verdict values — this is the same vocabulary the land-time
validator parses and the same vocabulary the coherence-waiver mechanism consumes:

- **covered** — the cited id has ≥1 real counterpart id (confirmed to exist in the
  counterpart's own artifact file, not merely referenced).
- **gap** — the cited id has zero counterparts, or its only counterpart is itself
  transitively uncovered (e.g. a story maps to a task, but that task cites no story
  back, or the coverage table claims a task id that does not exist in the task tree).

Do not invent additional verdict strings (e.g. "partial", "n/a", "pending"). A row
that is genuinely not applicable (e.g. the FR row class on a technical-track spec) is
simply omitted, not marked with a placeholder verdict.

### 4c. Gap-ID Scheme

Every **gap** row's Notes column MUST restate its gap id in one of these canonical
forms — this is the vocabulary a `.docs/coherence-waivers/<plan-stem>.md` waiver names
to be recognized (waivers are validated by a separate mechanism; this skill only needs
to emit the ids in the correct form so a later waiver can cite them):

- `outcome-<n>` — unmapped or negative-verdict outcome bullet
- `fr-<N>` — FR cited by no story, or only by a story that itself maps to no task
- `story-<id>` — story cited by no task
- `task-<id>` — task with no valid story citation and no supporting-purpose exemption
- `claim-<row>` — the plan's own `## Coverage Check` table cites a phantom id or
  contradicts the parsed task tree (row number within that table)
- `duplicate:<ref>` — a second spec claiming an already-claimed `Source-Ref` (emitted
  by the land-time duplicate-claim scan, not authored here — documented for vocabulary
  completeness only)

Gap ids are opaque strings to downstream consumers (the validator, the waiver parser)
— do not paraphrase or abbreviate them; use the exact forms above so cross-checking
against the real artifact files (Section 5) is possible.

## 5. Semantic-Judging Instructions (verify-claims protocol)

Per `/verify-claims`, this skill is a **verifier/judge** role: it renders a verdict
per row and must never assert "covered" that it has not actually confirmed.

- **Calibrate claims.** Before marking a row covered, `Read`/`grep` the counterpart
  artifact file and confirm the cited id is real and the coverage is genuine (not just
  a plausible-sounding phrase match). Prefer the cheap read over an inferred guess
  every time it would settle the question.
- **Surface every assumption.** If a row's coverage is ambiguous (e.g. a story vaguely
  gestures at an outcome without an explicit citation), do not silently resolve it in
  either direction — surface it as an assumption with confidence, impact-if-wrong, and
  how to confirm, per the Correctness & Assumption Gate (HARNESS.md).
- **Hard-block on unconfirmed load-bearing assumptions.** A verdict on this artifact is
  load-bearing — it gates land. Never mark a row "covered" on an unconfirmed
  assumption about what a story or task "probably" means. Interactive runs: present
  the ambiguous row and wait for operator confirmation before finalizing the artifact.
  Autonomous/daemon runs: mark the row `gap` and let the fail-closed land gate surface
  it — never silently resolve ambiguity as a pass.
- **Fabricated citations are never coverage.** A cited counterpart id that does not
  exist in its source file is not "covered with a typo" — it is a gap, and the
  land-time validator independently cross-checks every cited id against the real
  artifact files regardless of what this skill wrote.

## 6. Output

1. Write `.docs/coherence/<plan-stem>.md` with the table(s) described in Section 4.
2. Ensure the file renders as valid Markdown (a real table, not fenced prose) — it
   must be readable directly in the spec PR diff (Story 2).
3. Do not stage or commit a coherence artifact for a technical-track spec's `fr` row
   class, or for a chat-origin spec's `outcome` row class — omission is correct there,
   not a gap.

## Verification

- [ ] Tier read from `.docs/complexity/`; skill does not run at all for tier S
- [ ] Tier L dispatch is pinned to opus; tier M inherits the session/step default
- [ ] `.docs/coherence/<plan-stem>.md` filename stem matches the plan's filename stem exactly
- [ ] All four row classes present where applicable (outcome/fr omitted only when genuinely not required)
- [ ] Every verdict is exactly `covered` or `gap` — no invented verdict strings
- [ ] Every `gap` row's Notes column restates its gap id in the canonical form (Section 4c)
- [ ] Every `covered` verdict was confirmed against the real counterpart artifact file, not inferred
- [ ] Ambiguous rows surfaced as assumptions (interactive: wait for confirmation; autonomous: mark `gap`, never silently pass)
- [ ] Output renders as a valid Markdown table in the spec PR diff
