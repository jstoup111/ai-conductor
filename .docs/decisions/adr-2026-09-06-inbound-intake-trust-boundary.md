# ADR: Inbound intake trust boundary — tracker text is evidence, never instruction

**Date:** 2026-09-06
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for #1479

<!-- Filename convention: adr-2026-09-06-<kebab-slug>.md (no sequential numbers). -->

## Context

Intake issue text (title + body) is joined verbatim by `buildText()` in
`intake/github-issues.ts` into `Envelope.text` (adr-011 decision 2), printed by `compose
claim`, persisted as the claim record, and staged into the worktree's
`.pipeline/intake-outcomes.md` (adr-2026-07-22-coherence-gate-placement-and-validation-split).
A host DECIDE session reads all of it as prose, in the same channel as operator instruction,
and the spec it authors is later built autonomously under elevated permissions
(adr-005-non-autonomy-and-read-only-governor keeps the engineer from spawning that build, but
does not touch what the build may do once dispatched).

`intake/sanitize.ts` is outbound-only: it redacts secrets and operator paths at the
`file-issue.ts` filing choke point. No ADR — approved, draft, or superseded — covers the
inbound direction, prompt injection, or tracker text as a trust boundary (repo-wide sweep of
307 ADRs, 2026-09-06). #355 proposes an automated filer, which would add a non-human writer to
this same path.

Constraints found by the sweep that the design must honor:

- adr-009: the `Envelope` contract is locked and evolves additively; `text` must remain
  non-empty at the port boundary.
- adr-012: dedup keys on `sourceRef`, never on `text`.
- adr-2026-07-21-intake-only-enforcement: `claimUnblocked` / `ClaimOutcome` stay byte-identical.
- adr-2026-07-26-event-sink-registry-exhaustiveness: a new `ConductorEvent` variant must declare
  its sinks or the engine does not compile.
- adr-2026-08-12-fail-closed-intake-ledger-durability (amended): the engineer directory is a
  user-global, cross-repo path with concurrent writers — not a single-writer location.
- adr-2026-08-09-hook-owned-containment-event-ledger and
  adr-2026-08-08-pipeline-owned-closeout-timestamps: an emitter-less process writes the same
  `ConductorEvent` schema to a worktree-local, single-writer sibling ledger.
- adr-2026-08-24-evidentiary-defects-are-not-waivable: an intake-outcome / criterion mismatch at
  land is unwaivable, so the staged outcome text must be defined unambiguously.
- adr-2026-07-22-canonical-tagged-source-ref: any `sourceRef` string is produced by
  `formatWorkRef`, never a local format.

## Options Considered

### Option A: Delimit at the consumption surface only (composer / engineer prose + claim JSON)
- **Pros:** No text rewriting; evidence byte-identical; smallest diff.
- **Cons:** The boundary is enforced by prompt discipline, which drifts; directive-shaped
  prose still reaches the session unchanged; no signal that it was present; a new consumer
  or a new writer (#355) bypasses it silently.

### Option B: Neutralize + delimit at the adapter's `buildText()`, record on the spine (chosen)
- **Pros:** One choke point every writer and every consumer passes through; mirrors where the
  outbound scrub sits; alterations are inert inline markers so evidence stays debuggable;
  a `ConductorEvent` makes the alteration operator-visible after the fact.
- **Cons:** The rule set is a judgement surface (novel phrasing is missed; an over-broad rule
  mangles evidence); `Envelope.text` is no longer the literal `title+body`, which amends
  adr-011 decision 2.

### Option C: B plus narrowing what a `--dangerously-skip-permissions` build may do
- **Pros:** Reduces consequence independently of input handling.
- **Cons:** Touches both provider launch surfaces and self-host containment; a different
  problem with its own ADR sweep. Excluded from this feature by the operator-confirmed scope
  boundary (`.docs/track/github-issue-text-reaches-an-autonomous-build-with.md`); to be filed as
  a separate intake.

## Decision

1. **The inbound seam is a pure module at the adapter's text-building choke point.**
   `intake/sanitize-inbound.ts` exports `sanitizeInboundText(text, sourceRef)` and is called
   from `buildText()` in `intake/github-issues.ts` for every issue the adapter emits — poll,
   re-route, and re-eligibility paths alike — so no writer to the tracker (human, automated
   filer, or a future `TrackerClient` backend per adr-2026-07-22-canonical-tracker-client-seam)
   can bypass it and no consumer can receive raw tracker text. It is the mirror image of
   `sanitizeIntakeText` in `file-issue.ts`: same shape (rules → result with categorized
   counts), opposite direction, separate implementation because the goals differ (secret
   removal vs. instruction neutralization). It is pure and idempotent.

2. **Neutralize in place with inert categorized markers; never delete, never refuse.**
   Directive-shaped prose is replaced by `[neutralized:<category>]` where it stood. Categories
   are a closed set (initially `agent-directive`, `role-tag`, `tool-call`, `system-prompt`,
   `armor-lookalike` — a body line shaped like the engine's own armor line), each
   rule high-precision on SHAPE — the same precision rule the outbound scrub states in its
   header — so a value is neutralized only when its form identifies it, never on a suspicious
   word. An issue is never refused or dropped: `text` stays non-empty (adr-009) and the
   claimable set is provably identical before and after (the adr-2026-08-05 visibility-only
   posture) — only the bytes of `text` change.

3. **Fenced and indented code, and quoted log lines, are exempt.** Segmentation into
   code/prose runs before any rule, using the same fenced-block exclusion approach the
   single ADR-approval parser uses (`adrApprovalStatus` in `engine/artifacts.ts` strips
   fenced blocks before matching). Stack traces, shell transcripts, config excerpts, and
   quoted (`>`) lines are evidence and pass byte-for-byte. Markdown structure — headings such
   as `## Desired outcome`, bullets, numbering — is preserved so `outcome-staging.ts` and the
   coherence extractor keep parsing.

4. **The tracker-sourced region is delimited by armor lines inside `text` itself.** The
   sanitized text is wrapped in a leading and trailing armor line carrying the canonical
   `sourceRef` (via `formatWorkRef`) and a sha256 digest of the sanitized content. Because the
   boundary rides in the text, every downstream surface — claim JSON, claim record, staged
   outcomes, host prompt — carries it without each consumer being told to add it. The armor
   lines are outside every Markdown section and are themselves inert under all rules
   (repeat-safe). The digest is telemetry and provenance only; it is never a dedup or claim
   key (adr-012).

5. **`Envelope` gains one additive optional field.** `inbound?: { neutralizations:
   Array<{ category, count }>, digest: string }`. `parseEnvelope` passes it through when
   present and well-formed and ignores it otherwise; required-field rejection semantics are
   unchanged (adr-009). The file queue already serializes the whole envelope, so the field
   round-trips. `claimUnblocked`, `ClaimOutcome`, `createFileQueue`, and the claim decorator
   chain are untouched (adr-2026-07-21, adr-2026-07-04, adr-2026-07-10): the CLI reads
   `inbound` off the `Envelope` it already holds.

6. **The claim surface echoes the record.** `compose claim` prints `inbound` alongside `text`,
   and `persistClaimRecord` stores it on the claim record next to `body`, so the operator sees
   what was altered at the moment the idea is claimed and can re-read it later by `sourceRef`.

7. **The occurrence rides the event spine as `intake_inbound_sanitized`, written
   worktree-locally.** A new `ConductorEvent` variant `{ type: 'intake_inbound_sanitized',
   sourceRef, neutralizations, digest }` is added to the union and declared in `EVENT_SINKS`
   as `{ render: true, persist: true, audit: false, otel: false }` (adr-2026-07-26;
   `audit: false` because intake belongs to no `StepName`, the same reasoning as
   adr-2026-08-09-reseal-audit; `persist: true` is one record per claimed intake issue —
   negligible volume under adr-2026-08-11's criterion). The engineer/compose CLI has no
   emitter and the engineer directory is not single-writer (adr-2026-08-12), so the record is
   appended by `engineer worktree --source-ref` — the first moment a worktree exists — to the
   single-writer sibling ledger `<worktree>/.pipeline/intake-events.jsonl`, in the same schema,
   exactly as adr-2026-08-09-hook-owned-containment-event-ledger and
   adr-2026-08-08-pipeline-owned-closeout-timestamps do (event-spine exceptions A and B). The
   append is best-effort and never throws into the caller; readers tolerate the file's absence.
   Chat-origin ideas carry no `inbound` and write no record.

8. **The staged and committed intake body is the sanitized projection.** Whatever
   `outcome-staging.ts` stages into `.pipeline/intake-outcomes.md`, and whatever `land` commits
   into `.docs/intake/<plan-stem>.md`, is the text the `Envelope` carries — sanitized, armored.
   The engine never retains raw tracker text; the tracker itself remains the raw record.
   Criterion rows and coverage quotes are authored from stories and plan tasks
   (adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote), never copied from
   `Envelope.text`, so the verbatim-quote chain is unaffected.

9. **Build privilege is out of scope.** `--dangerously-skip-permissions` and the
   non-autonomy invariant (adr-005) are unchanged by this decision; consequence narrowing is
   a separate intake.

## Consequences

### Positive
- Tracker text is distinguishable from operator instruction at every consumption point by
  machinery, not prompt discipline, and an issue containing directive-shaped prose produces
  the same DECIDE input as one describing the problem neutrally.
- Every writer — including #355's automated filer and any future tracker backend — gets the
  same treatment for free.
- The alteration is visible three ways: claim JSON, claim record, and the persisted spine.

### Negative
- The rule set will miss novel directive phrasing; this is a floor, not a proof. The
  `[neutralized:*]` markers make misses and false positives auditable, which is the mitigation.
- `Envelope.text` is no longer the literal `title+body` (adr-011 decision 2 amended in place).
- A ledger-appended event never reaches a live emitter, so it is invisible to OTel
  (adr-014) and to `ui_renderer` plugins until a reader tails the sibling ledger — the same
  accepted cost as the two precedent sibling ledgers.
- Issue bodies in `.docs/intake/<plan-stem>.md` now carry armor lines and may carry markers.

### Follow-up Actions
- [ ] File the privilege-narrowing intake (Option C) as a separate issue referencing #1479.
- [ ] Tail `.pipeline/intake-events.jsonl` onto the live bus when a reader for the sibling
      ledgers is consolidated (not required by this feature).
