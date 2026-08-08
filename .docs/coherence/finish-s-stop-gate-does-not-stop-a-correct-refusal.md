# Coherence Mapping: FINISH refusal reaches the operator with its reason

**Date:** 2026-08-08
**Plan stem:** finish-s-stop-gate-does-not-stop-a-correct-refusal
**Tier:** M (skill runs, session-default model — the opus pin applies to tier L only)
**Track:** technical
**Source-Ref:** jstoup111/ai-conductor#1107

Row classes present: **story** (5 rows) and **task** (15 rows). The **fr** class is omitted —
technical track, no PRD, no enumerated `FR-N` layer exists. The **outcome** class is omitted; see
"Why the outcome class is omitted" below.

Every story id below was confirmed to exist as a `## Story <id>:` heading in
`.docs/stories/finish-s-stop-gate-does-not-stop-a-correct-refusal.md`, and every task id was
confirmed to exist as a `### Task <id>:` heading in
`.docs/plans/finish-s-stop-gate-does-not-stop-a-correct-refusal.md` whose `**Story:**` line cites the
story it is mapped to. Ids were extracted from the artifact files directly, not inferred from the
plan's own coverage table.

## Mapping

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-3 | covered | Closed reason union, guard admits an optional non-empty detail, guard rejects every malformed detail shape. |
| story | story-2 | task-4, task-5 | covered | Guidance map with compile-time exhaustiveness; non-blank and mutually distinct entries. |
| story | story-3 | task-6, task-7, task-8, task-9, task-15 | covered | Render message and next action, compose the detail, fail closed on an unresolved token, confine rendering to the one arm with conductor.ts undiffed, assert the written marker end-to-end. |
| story | story-4 | task-10, task-11, task-12, task-13 | covered | Verdict accepts a detail, blank and non-string dropped, length bounded, forwarded without reclassifying the retryable verdict kinds. |
| story | story-5 | task-14 | covered | Publishes the verdict contract to the provider and pins the documented vocabulary to isPrProseJudgmentResult, including the fail-closed prose case. |
| task | task-1 | story-1 | covered | Type infrastructure; cites a real story, so the supporting-purpose exemption is not invoked. |
| task | task-2 | story-1 | covered | Guard admits kind+reason+detail while keeping the two-key branch intact. |
| task | task-3 | story-1 | covered | Negative-path task for story-1's blank, non-string, extra-key and missing-reason criteria. |
| task | task-4 | story-2 | covered | Type infrastructure; cites a real story. |
| task | task-5 | story-2 | covered | Negative-path task for story-2's blank and duplicate-message criteria. |
| task | task-6 | story-3 | covered | Renders message and next action into the halt reason. |
| task | task-7 | story-3 | covered | Composes the detail when present and stays well-formed when absent. |
| task | task-8 | story-3 | covered | Negative-path task for story-3's unresolved-token criterion. |
| task | task-9 | story-3 | covered | Negative-path task for story-3's other-arms and no-conductor-diff criteria. |
| task | task-10 | story-4 | covered | Verdict type and validator accept an optional detail. |
| task | task-11 | story-4 | covered | Negative-path task for story-4's blank and non-string criteria. |
| task | task-12 | story-4 | covered | Negative-path task for story-4's over-length criterion. |
| task | task-13 | story-4 | covered | Forwards the detail and covers story-4's retryable-kinds criterion. |
| task | task-14 | story-5 | covered | Publishes the contract and adds the docs-to-validator agreement test. |
| task | task-15 | story-3 | covered | Covers story-3's halt-marker body and HALT.class criteria. |

Twenty rows, all `covered`. Zero `gap` rows, so no `.docs/coherence-waivers/` entry is required.

## Coverage-claim cross-check

The plan's own coverage table was checked against the parsed task tree. Every task id it cites
(1 through 15) exists as a real task heading, and every story id it cites (1 through 5) exists as a
real story heading. No phantom id and no contradiction with the task tree, so there is no
`claim-<row>` gap.

## Why the outcome class is omitted

`.pipeline/intake-outcomes.md` is staged and carries `Source-Ref: jstoup111/ai-conductor#1107`, but
its `## Desired outcome` section is **empty**: issue #1107 predates the `/intake` skill's
WHAT/OUTCOMES shape and states its direction as prose under "Suggested direction" rather than as
outcome bullets. With zero staged outcome bullets the rule in the skill's row-class section applies
directly — an empty outcome layer is "not required," never a gap — so the class is omitted rather
than populated with fabricated bullets.

This is recorded rather than passed over silently, because the issue prose does contain four
identifiable desired outcomes and enumerating them as rows would have produced three misleading
`gap` verdicts:

- **(a) a deliberate refusal is distinguishable from an incomplete run** — already shipped. The
  publication coordinator returns a typed `human_required` disposition, so the absence of
  `.pipeline/finish-choice` is no longer the refusal signal in production.
- **(b) a deliberate refusal HALTs with its reason, classified needs-human, not re-kick eligible** —
  already shipped. `routeFinishPublicationDisposition` routes to
  `writeHaltMarker(..., 'needs-human')`, and `daemon-rekick.ts` skips that class.
- **(c) a genuine incomplete run still retries as today** — already shipped. `publication_retry` and
  `implementation_invalid` keep their existing retry and capped-kickback routing; story-4's final
  criterion and task-13 pin this against regression.
- **(d) the operator gets the blocker reason in structured form** — **delivered by this spec**, via
  story-2, story-3 and story-4, plus story-5's reachability fix, without which a refusal cannot be
  expressed at all.

Marking (a), (b) and (c) as gaps would misreport working machinery as missing work and would demand
a coherence waiver asserting something untrue. Omission under the documented empty-outcome-layer rule
is the accurate record.

## Assumptions surfaced

- **That #1107's outcomes (a) through (c) are satisfied by shipped code rather than merely believed
  to be.** Confidence ~95%, basis verified: `finish-publication.ts` carries the `human_required` arm
  and the halt route; `conductor.ts` writes the marker with `'needs-human'`; `daemon-rekick.ts` skips
  that class; the production coordinator is injected in both `daemon-cli.ts` and `index.ts`. Impact
  if wrong: this spec would be under-scoped and #1107's original machinery would still be needed.
  Confirmed by reading each call site during `/explore` and recorded in
  `.memory/decisions/2026-08-08-finish-human-required-halt-reasons.md`.
- **That every `covered` verdict rests on a confirmed id rather than a plausible-looking one.**
  Confidence ~99%, basis verified: task headings and their `**Story:**` lines were extracted directly
  from the plan file and story headings from the stories file, then compared.
