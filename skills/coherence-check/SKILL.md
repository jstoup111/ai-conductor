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
intake outcome bullet, every PRD FR (product track), every non-deleted ADR file in the
current spec change set when the coherence gate engages, every story,
and every plan task to its counterpart ids with a per-row verdict. This artifact is the auditable
traceability record the operator (and the land-time coherence validator) reads instead
of trusting self-reported "everything's covered" prose in a spec PR.

**Correctness gate:** a row's verdict (`covered` / `gap` / `fail`) is a judgment call, not
a mechanical grep. Coverage and consistency are separate questions: a counterpart can
exist and still contradict what it implements (§4d). Per the `/verify-claims` protocol, ground every verdict in the actual
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
5. The ADR files in the current spec change set — each non-deleted
   `.docs/decisions/adr-*.md` file. This is the row set when the coherence gate engages;
   do not expand it to every decision that conceptually constrains the stories.

## 4. Mapping-Artifact Format

Write `.docs/coherence/<plan-stem>.md`. The plan-stem in the filename MUST match the
plan's own filename stem exactly — the land validator rejects a stem mismatch as
missing-coherence-artifact even when a coherence file exists under a different name.

The artifact is a Markdown table (or one table per row class) with these columns:

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|

### 4a. Row Classes (exactly five)

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
5. **adr** — when the coherence gate engages, one row per non-deleted
   `.docs/decisions/adr-*.md` file in the current spec change set. Cited id:
   `adr-<stem>`. Counterpart: the story id(s) that implement or are constrained by the
   decision.

### 4b. Verdict Vocabulary

Use exactly these three verdict values — this is the same vocabulary the land-time
validator parses and the same vocabulary the coherence-waiver mechanism consumes:

- **covered** — the cited id has ≥1 real counterpart id (confirmed to exist in the
  counterpart's own artifact file, not merely referenced) **and** nothing in that
  counterpart contradicts it (§4d).
- **gap** — the cited id has zero counterparts, or its only counterpart is itself
  transitively uncovered (e.g. a story maps to a task, but that task cites no story
  back, or the coverage table claims a task id that does not exist in the task tree).
- **fail** — the cited id *has* a real counterpart, but the two **contradict** each
  other (§4d). Coverage is satisfied here; consistency is not. Recording it as `gap`
  would misdescribe it and send the reader hunting for a missing artifact that is in
  fact present and wrong.

**The exact strings matter more than they look.** The land-time validator treats
`gap`, `missing`, `uncovered`, and `fail` as blocking, and **every other string as
affirmative**. An invented verdict — "partial", "contradiction", "n/a", "pending" —
therefore does not fail loudly; it *silently passes the gate*. That is why a
contradiction is recorded as `fail` rather than as a new word that reads more
precisely: `fail` is already in the blocking set and already flows into the gap list a
waiver can cite. A row that is genuinely not applicable (e.g. the FR row class on a
technical-track spec) is omitted entirely, never given a placeholder verdict.

### 4c. Gap-ID Scheme

Every **gap** row's Notes column MUST restate its gap id in one of these canonical
forms — this is the vocabulary a `.docs/coherence-waivers/<plan-stem>.md` waiver names
to be recognized (waivers are validated by a separate mechanism; this skill only needs
to emit the ids in the correct form so a later waiver can cite them):

For the `adr` row class, the cited id form and the canonical gap-id form are both
`adr-<stem>`, where `<stem>` is the ADR filename stem.

- `outcome-<n>` — unmapped or negative-verdict outcome bullet
- `fr-<N>` — FR cited by no story, or only by a story that itself maps to no task
- `story-<id>` — story cited by no task, or a story that does not tie out to the PRD
  (cites an `FR-N` the PRD never declares, or cites no FR at all — §4e)
- `task-<id>` — task with no valid story citation and no supporting-purpose exemption
- `adr-<stem>` — non-deleted ADR file in the current spec change set cited by no story,
  or only by a story that does not implement or honor the decision
- `claim-<row>` — the plan's own `## Coverage Check` table cites a phantom id or
  contradicts the parsed task tree (row number within that table)
- `duplicate:<ref>` — a second spec claiming an already-claimed `Source-Ref` (emitted
  by the land-time duplicate-claim scan, not authored here — documented for vocabulary
  completeness only)

Gap ids are opaque strings to downstream consumers (the validator, the waiver parser)
— do not paraphrase or abbreviate them; use the exact forms above so cross-checking
against the real artifact files (Section 5) is possible.

A **fail** row uses the same id form as its row class (`outcome-<n>`, `fr-<N>`,
`story-<id>`, `task-<id>`, `adr-<stem>`) — the id identifies *which* row, and the
verdict says what is wrong with it. Prefix its Notes with `CONTRADICTS:` and name the
counterpart id and the specific opposing text, so a reader can adjudicate without
re-deriving the finding.

### 4d. Consistency Pass — Contradiction and Oscillation

Coverage and consistency are different questions, and this artifact is the only place
both are visible: it is the one view holding outcomes, FRs, ADRs, stories, and tasks at once.
A row where the counterpart exists but *opposes* what it implements is **`fail`**, not
`covered` — the mapping is complete and wrong.

After establishing coverage, re-read each covered row and ask whether the counterpart
actually delivers the thing, or contradicts it. Two shapes matter:

**Static contradiction** — the two cannot both hold. An FR requires a field be
immutable after creation while a task adds an edit endpoint for it; an outcome demands
a gate fail closed while its task adds a bypass flag. Whichever is right, they cannot
both ship, and one artifact must be amended during DECIDE before BUILD begins.

**Oscillation** — the dangerous one, and the reason this pass exists. Two requirements
are individually satisfiable but mutually exclusive *in practice*, so satisfying one
re-breaks the other. Nothing looks wrong at authoring time; the damage appears later as
a gate kicking work back, the fix tripping a different gate, and that gate kicking it
back again. The loop does not terminate on its own, and each lap costs a full agent
session. Prefer catching this here, where the cost is an amended sentence.

Detection heuristic: for each pair of requirements touching the same behavior, entity,
field, or gate, ask **"if I fully satisfy A, does B still hold?"** Then ask it in the
other direction. Two "no" answers is an oscillation regardless of how reasonable each
requirement reads alone. Pairs worth checking first are the ones sharing a subject
across *different* layers — an outcome and a task, an FR and a story, an ADR and a story — because same-layer
contradictions are what `/conflict-check` already sweeps for, and cross-layer ones are
what nothing else sees.

Ground every `fail` in the specific opposing text from both artifacts, per the
verify-claims protocol in Section 5. "These feel like they might conflict" is not a
finding. If a suspected contradiction cannot be grounded in quoted text, surface it as
an assumption for the operator rather than recording a verdict either way.

When a contradiction is confirmed, amend the artifact during this DECIDE pass — do not
defer it to BUILD. Follow the accepted-artifact amendment convention the sibling DECIDE
skills use: add a dated note beside the original assertion, additively, leaving the
original text in place.

### 4e. PRD ↔ Stories Tie-Out

The `fr` and `story` row classes are the two halves of one question: **do the PRD and the
stories tie out?** Both directions must hold, and they fail differently:

- **Forward (PRD → stories).** Every enumerated `FR-N` is cited by ≥1 story's
  `**Requirement:**` line, and ≥1 of those stories is itself covered by a plan task. An FR
  nothing implements is `gap` on its `fr` row (`fr-<N>`).
- **Reverse (stories → PRD).** Every story cites ≥1 `FR-N`, and every `FR-N` it cites is one
  the PRD actually declares. A story citing `FR-9` when the PRD stops at `FR-4` is a phantom
  requirement; a story citing no FR at all is untraced — it asserts behavior the product spec
  never asked for. Either is `gap` on that story's `story` row (`story-<id>`).

Both directions are **enforced mechanically by the land-time gate** over parsed ids — it
re-derives them from the real PRD and stories files regardless of what this artifact claims,
and reports every offending id, not the first. Do not spend judgement re-deriving set
membership by hand: read the ids, record the rows, and let the gate be the authority on
coverage. Reserve judgement for the part the gate cannot compute:

- **Does the story actually deliver the FR it cites?** A correct citation is not a correct
  implementation. An `FR-N` requiring an immutable field, cited by a story whose scenario
  edits that field, is `fail` (§4d) — coverage is satisfied, consistency is not. This is the
  reverse-direction contradiction the mechanical check cannot see, and it is the reason the
  `fr` and `story` rows carry verdicts at all rather than just id lists.
- **Is the citation load-bearing or decorative?** A story citing three FRs while its scenarios
  exercise one is not covered for the other two — record those FRs as `gap` on their own `fr`
  rows and say so in Notes, rather than crediting a citation the acceptance criteria do not
  honor.

**Boundary vs `/conflict-check`.** `/conflict-check` sweeps **story against story** — two
stories that cannot both hold. This section sweeps **story against the PRD** — a story that
does not tie out to, or contradicts, the requirement it claims to implement. A story pair that
conflicts with each other but each tie out cleanly to their FRs is `/conflict-check`'s finding,
not this one; a single story that no other story disagrees with but which contradicts its own
FR is this one's, and nothing else in DECIDE sees it. Do not re-report a conflict-check finding
here, and do not assume conflict-check's clean pass says anything about PRD agreement — it
never reads the PRD's FRs as a party to the comparison.

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
  how to confirm, per the repository's correctness and assumption gate.
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
   class, a chat-origin spec's `outcome` row class, or an `adr` row class when the current
   spec change set has no non-deleted `.docs/decisions/adr-*.md` file — omission is
   correct there, not a gap.

## Verification

- [ ] Tier read from `.docs/complexity/`; skill does not run at all for tier S
- [ ] Tier L dispatch is pinned to opus; tier M inherits the session/step default
- [ ] `.docs/coherence/<plan-stem>.md` filename stem matches the plan's filename stem exactly
- [ ] All five row classes present where applicable (outcome/fr/adr omitted only when genuinely not required)
- [ ] Every verdict is exactly `covered`, `gap`, or `fail` — no invented verdict strings
      (an invented string is treated as affirmative by the validator and silently passes)
- [ ] §4d consistency pass run over every covered row; contradictions recorded as `fail`
      with `CONTRADICTS:` notes quoting the opposing text from both artifacts
- [ ] §4e PRD↔stories tie-out checked in BOTH directions — no FR without a story, and no
      story citing a phantom FR or citing no FR at all
- [ ] Every story's cited FR confirmed to be actually delivered by that story's scenarios —
      a correct citation that the acceptance criteria contradict is `fail`, not `covered`
- [ ] Story-vs-story conflicts left to `/conflict-check`; this artifact reports story-vs-PRD only
- [ ] Cross-layer pairs (outcome↔task, FR↔story, ADR↔story) checked in both directions for
      oscillation — same-layer pairs are `/conflict-check`'s sweep, cross-layer are this skill's
- [ ] Every `gap` row's Notes column restates its gap id in the canonical form (Section 4c)
- [ ] Every `covered` verdict was confirmed against the real counterpart artifact file, not inferred
- [ ] Ambiguous rows surfaced as assumptions (interactive: wait for confirmation; autonomous: mark `gap`, never silently pass)
- [ ] Output renders as a valid Markdown table in the spec PR diff
