# ADR: Finding-identity references are content-anchored; a closed class-level reference schema for all four rubrics

**Date:** 2026-08-18
**Status:** APPROVED
**Approved:** Operator-approved 2026-08-18
**Deciders:** James Stoup (operator) and architecture review amendment pass for #1611 / intake #1695
**Depends on:** `adr-2026-08-13-stable-build-review-finding-dispositions` (Option C typed identity — this ADR fills its "every rubric needs a carefully designed identity schema" obligation class-level)
**Reuses:** `adr-2026-08-16-closed-build-review-finding-vocabularies` (closed classification sets; this ADR is the closed *reference* counterpart)

## Context

`adr-2026-08-13` chose versioned typed finding identities (rubric + concernKind + anchor
references, hashed) but deliberately left each rubric's reference schema to be "carefully
designed." In practice that design happened incrementally in BUILD: successive
`build_review` laps of feature #1611 found each not-yet-canonical anchor field, and the
remediation planner authored a new reference grammar per lap — plan-task id grammar,
tautology test selectors (`rem-rootcause-7`), and finally a line-coordinate rootCause
hunk locus `path@oldStart,oldCount:newStart,newCount` (`rem-rootcause-9/10`, commit
`d8fa79150`) — 21 appended tasks against an 18-task plan, with no operator checkpoint
(intake #1695). The operator rejected and reverted the line-coordinate locus.

Forces:

- **Identity must survive wording drift** (the #1611 defect) — references, never prose.
- **Identity must survive rebases.** The sibling feature
  `rubric-cache-identity-is-sha-anchored-so-a-rebase-` (plan 2026-08-15) already ruled
  the same way for the rubric cache: content-only identity, because SHA- and
  coordinate-anchored identity breaks on every rebase that leaves content unchanged.
  Line-coordinate loci re-import exactly that fragility into finding identity: a clean
  rebase renumbers hunks, drifting every open finding's id and detaching accepted
  dispositions — recreating #1611 through the mechanism built to fix it.
- **The schema must be closed class-level.** A field-by-field schema invites the
  observed failure: each unspecified field becomes a future finding and an unapproved
  grammar. The vocabulary ADR (`adr-2026-08-16`) already established the pattern:
  closed, corpus-validated sets, bound by an integrity check.
- **Dispositions suppress findings**, so identity must not over-match: an identity that
  survives a *content* change would let an accepted disposition silently swallow a
  materially different defect at the same location.

## Options Considered

### Option A: Enumerated per-field canonical grammars (status-quo trajectory)

Each anchor field gets a bespoke validated string grammar (path refs, task-id grammar,
test-selector strings, coordinate loci), added as rubrics discover them.

- **Pros:** Fully mechanical; each grammar is precise; incremental delivery.
- **Cons:** The schema is open-ended by construction — the lap-by-lap enumeration and
  unapproved grammar authoring already observed; coordinate-bearing grammars are
  rebase-fragile; every new grammar is an identity-semantics change that invalidates
  existing dispositions.

### Option B: Content-anchored references (closed three-kind schema)

Every anchor reference is exactly one of three canonical kinds, uniform across rubrics;
no other reference kind may be introduced without superseding this ADR.

- **Pros:** Class-level and closed — no future field can demand a new grammar without an
  operator-approved supersession; rebase-stable (content survives a clean rebase;
  coordinates do not); content change ⇒ new identity, which is the correct fail-closed
  narrowness for dispositions; symmetric with the cache's approved content-only identity.
- **Cons:** Content hashes are opaque in reports (mitigated: the canonical payload
  retains the human-readable display string alongside the hash); a conflict-resolved
  rebase that edits hunk content yields a new identity (accepted: edited content is a
  new judgement subject).

### Option C: Judged equivalence at match time

Keep coarse references (rubric + concernKind + path) and let a schema-constrained LLM
judgement decide "same finding?" when matching dispositions.

- **Pros:** No grammar maintenance ever; matches the judgement-shaped nature of
  equivalence.
- **Cons:** A non-deterministic matcher guards a suppression gate — an over-matching
  judge silently swallows new defects, the exact narrowness violation
  `adr-2026-08-13` rejected in its Option A/B analysis; per-lap judge cost on the
  daemon critical path. (Deferred, not forbidden: a judged *near-miss advisory* — same
  rubric/concernKind/file, different content hash — may later flag "possibly the same
  concern" to the operator without auto-matching; that belongs to the #1630 arbitration
  design and is out of scope here.)

## Decision

Choose **Option B**. The canonical reference schema for all four rubrics is the closed
set of exactly three reference kinds:

1. **`path`** — a repository-relative file path (existing
   `parseBuildReviewCanonicalPathReference` grammar).
2. **`plan-task`** — a plan task id (existing shared `TASK_ID_PATTERN` grammar).
3. **`content-region`** — `{ path, contentHash, display }` where `contentHash` is
   `sha256` of the referenced region's **normalized content** (the changed test's full
   title text for tautology `changedTest`; the projected hunk's added+removed line
   content, whitespace-normalized, for rootCause `locus`), and `display` is the
   human-readable form carried for reports but **excluded from the identity hash**.

Rubric anchor bindings: tautology `changedTest` → content-region (test-title content);
scope `path` → path; rootCause `locus` → content-region (hunk content); completeness
`planTask` → plan-task, `missingSurface` → path. Coordinate encodings (line numbers,
hunk offsets, byte ranges) are forbidden in any reference kind. Any future anchor field
must bind to one of these three kinds; introducing a fourth kind requires superseding
this ADR with operator approval — it is never a BUILD-time or remediation-lap decision.

Why: it is the only option that is simultaneously closed (ends the per-lap grammar
enumeration), rebase-stable (per the cache precedent), and fail-closed narrow for
dispositions (content change ⇒ new identity), while staying inside
`adr-2026-08-13`'s Option C typed-identity architecture rather than superseding it.

## Consequences

- `rem-rootcause-9/10` are reimplemented against this schema (content-hashed hunk
  regions), not the reverted coordinate loci; the revert `8977ba7c7` stands.
- Existing v1/v2 identities parsed under `allowLegacyV1` remain readable; new findings
  bind to this schema under the next contract version. Changing a binding later is an
  intentional identity-semantics change per `adr-2026-08-13`.
- An integrity test must pin the three-kind set and the per-rubric bindings (the same
  binding pattern `adr-2026-08-16` Condition D5 uses for vocabularies), so a new
  reference kind cannot land silently.
- Verified claims: current per-rubric anchor shapes and locus parsing read from
  `build-review-finding-identity.ts` / `build-review-domain.ts` at HEAD (verified);
  coordinate fragility under rebase and content stability under clean rebase —
  inferred from git rebase semantics, 95%, corroborated by the approved content-only
  cache-identity plan (2026-08-15). No unconfirmed load-bearing assumptions remain.

> **Amended 2026-08-18 at `architecture_review` (remediation `rem-rootcause-11`, from
> `build_review` lap `58c87dce4`):** the authoritative `rootCause.locus` contract is
> stated here and nowhere else. `locus` binds to **`content-region`** —
> `{ path, contentHash, display }` where `contentHash` is `sha256` of the projected
> hunk's added+removed line content, whitespace-normalized, and `display` is excluded
> from the identity hash. Two same-class `rootCause` findings in distinct hunks of one
> changed file therefore canonicalize to distinct identities, while a pure rewording of
> either finding's prose changes neither. No other locus encoding is authoritative.
>
> **Plan tasks `rem-rootcause-9` and `rem-rootcause-10` are retired, not deferred.**
> Their steps prescribe the line-coordinate selector
> `path@oldStart,oldCount:newStart,newCount` that the operator rejected and `8977ba7c7`
> reverted; the Decision above forbids coordinate encodings in every reference kind, so
> those steps are unimplementable as written and no later step may carry them forward or
> reintroduce the mechanism. What survives them is their *outcome* — a `rootCause` locus
> identity that distinguishes different hunks of the same changed file — which `/plan`
> re-authors as RED/GREEN tasks bound to `content-region` above. Until those replacement
> tasks exist, no distinct-hunk implementation is authorized: the earlier absence of this
> ruling is what let a remediation lap invent an unapproved grammar in the first place.

> **Amended 2026-08-18 (operator, resolving stall:changed-test-title):** the authoritative
> source of tautology `changedTest` title content is the changed test's **full declared
> title chain** — the concatenated `describe`/`it` (or framework-equivalent) titles as
> written in the test source at the graded head — extracted at **snapshot time** and
> carried in the frozen build-review projection as a `changedTestTitles` entry
> `{ selector, titleText }` alongside the existing `changedTestSelectors`. The
> content-region reference for `changedTest` is then
> `{ path: selector, contentHash: sha256(whitespace-normalized titleText), display: titleText }`.
> Graders never re-derive titles from the working tree; the projection is the only source,
> preserving snapshot immutability. A changed test whose titles cannot be statically
> extracted falls back to hashing the selector path and is flagged in the projection so
> the grader may treat identity as coarse for that entry (fail-open on identity precision,
> never on execution).

> **Amended 2026-08-18 (operator, superseding approval for equal-content disambiguation):**
> a `content-region` reference MAY carry an optional `occurrence` field — the 0-based
> ordinal of this region among regions of the SAME path (rootCause) or the same full
> title chain (tautology `changedTest`) whose normalized content hashes are equal,
> ordered by frozen-projection order. `occurrence` participates in the identity hash;
> occurrence 0 hashes identically to an omitted field, so unique regions keep their
> existing identities. This is a content-stable disambiguator assigned within
> equal-content groups — NOT a coordinate encoding (no line numbers, offsets, or byte
> ranges), and NOT a fourth reference kind. Selector renames with unchanged titles
> retain identity when the title chain is unique; among genuine duplicates, identity
> follows projection order, which is the accepted precision limit. This amendment is
> the operator approval the base ADR requires for identity-semantics changes.

