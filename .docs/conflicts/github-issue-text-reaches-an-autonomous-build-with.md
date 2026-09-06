# Conflict Check: Inbound intake trust boundary (#1479)

**Date:** 2026-09-06
**Inventory:** all 6 new stories pairwise; 27 existing story files sharing an intake, envelope, claim, outcome-staging, or event-sink surface read in full (the remaining story files share no surface); ADR corpus `repo_wide` — all 307 ADRs examined during architecture-review, narrowed to the 45 recorded in `architecture-review-2026-09-06-github-issue-text-reaches-an-autonomous-build-with.md` and `adr-2026-09-06-inbound-intake-trust-boundary`; superseded ADRs excluded only when unambiguously fully superseded (listed in that review).
**Result:** **PASS — zero blocking conflicts remain.** Three blocking contradictions were resolved by in-place replacement of superseded assertions in shipped stories (delivered as a companion main-based PR because the land stem gate rejects foreign-stem story edits on a spec branch), one blocking contradiction between two new stories was resolved in place, and six degrading conflicts are accepted with the compromises recorded below. No ADR-versus-story conflict was found: every ADR clause the new stories touch was amended or cited during architecture-review (adr-011 decision 2 amendment; adr-2026-09-06 decisions 5–8).

## Conflict: Envelope text is no longer the literal title + body

**Stories involved:** phase-9.3b Story 2 "Poll assigned issues across all registered repos (FR-26)" and Story 4 "Reject empty issues at capture (FR-28)" (happy path) vs Story 3 "The tracker-sourced region is delimited with provenance"
**Files:** `.docs/stories/phase-9.3b-github-intake-writeback.md` vs `.docs/stories/github-issue-text-reaches-an-autonomous-build-with.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 100% — the old stories pin `text` = `title + "\n\n" + body` (and `text` = the title when the body is empty); the new story requires `text` to begin and end with armor lines.

**Resolution Options:**
1. Replace the two superseded assertions in place: `text` is the inbound-sanitized, armored projection of `title + "\n\n" + body` (or of the title alone).
2. Move the armor lines out of `text` into a sibling field, leaving `text` verbatim.
3. Drop the armor lines and rely on the `inbound` field alone.

**Resolution:** Option 1, already decided by `adr-2026-09-06-inbound-intake-trust-boundary` decision 4 and the amendment to `adr-011-async-intake-queue-and-github-source` decision 2. Options 2 and 3 reintroduce a consumer that can receive undelimited tracker text. The replacement ships in the companion PR.

## Conflict: Staged and committed intake outcomes are "verbatim"

**Stories involved:** decide-artifact-coherence-check Story 1 "Intake outcomes travel with the spec (FR-13)" vs Story 6 "Staged and committed intake outcomes are the sanitized text and still gate correctly"
**Files:** `.docs/stories/decide-artifact-coherence-check.md` vs `.docs/stories/github-issue-text-reaches-an-autonomous-build-with.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 100% — "verbatim Desired-outcome bullets" and "byte-for-byte" versus "carries the neutralized bullet […] no raw copy of the bullet exists".

**Resolution Options:**
1. Replace "verbatim" with "exactly as carried by the claimed Envelope text" — the bullets remain byte-preserved from claim through land; only their source is the sanitized envelope.
2. Stage the raw body and sanitize only the claim output.
3. Stage both raw and sanitized copies.

**Resolution:** Option 1, per `adr-2026-09-06` decision 8. Option 2 leaves the land-gated marker carrying undelimited text into the build; option 3 retains raw text engine-side and makes `adr-2026-08-24` evidentiary mismatches possible. Ships in the companion PR.

## Conflict: Idempotency versus armor-lookalike neutralization (new vs new)

**Stories involved:** Story 1 negative path "already-sanitized text passed through again" vs Story 3 negative path "armor-lookalike"
**Files:** `.docs/stories/github-issue-text-reaches-an-autonomous-build-with.md` (both)
**Type:** contradiction
**Severity:** blocking
**Confidence:** 95% — satisfying strict lookalike neutralization on a second pass would rewrite the outer armor lines, breaking byte-identity.

**Resolution:** Resolved in place in both stories: a matching outer armor pair whose digest verifies identifies already-sanitized text and returns it unchanged; any other armor-shaped line is an inner lookalike and is neutralized.

## Accepted degrading conflicts

| Existing story | New story | Type | Compromise |
|---|---|---|---|
| phase-9.3b Story 4 negative — empty title and body skipped at `poll()` | Story 1 | sequencing | Emptiness is checked before the seam; armor lines never make an empty issue look non-empty. Folded into Story 1's negative paths. |
| phase-9.3 "Empty Envelope text is rejected, not dropped (FR-16)" | Story 1 | overlap | Port-level rejection remains and stays tested; it is simply unreachable for adapter-produced envelopes because armor lines are always present. |
| phase-9.3 "Intake port defines the Envelope contract (FR-13)" | Story 4 | overlap | The enumerated field list gains one additive optional field (`inbound`), the evolution mode adr-009 already allows. No negative path in FR-13 forbids extras. |
| loop-halt Story 6 "Non-halt event volume is unchanged (TI-6)" | Story 5 | contradiction | That pin was scoped to the loop-halt change set; `PINNED_PERSISTED_EVENT_TYPES` in `src/conductor/test/engine/event-sinks.test.ts` gains `intake_inbound_sanitized` as an explicit plan task, which is precisely the review the pin exists to force. |
| 2026-07-10 priority-banded claim — "claim JSON shape unchanged" | Story 4 | contradiction | That note was scoped to band information; `inbound` is an additive field, and `kind/text/source/sourceRef` are unchanged. |
| intake-claim-closed-issue-guard TR-4/TR-5 — malformed `sourceRef` delivered, never dropped | Story 3 | overlap | Story 3's capture-time throw is removed: the seam takes a parsed `WorkRef`, so a malformed reference is unrepresentable at capture and the claim-time fail-safe stands untouched. |

## Companion PR (foreign-stem story replacements)

To be opened from a fresh `origin/main`-based branch after the spec PR is handed off, containing only:
- `.docs/stories/phase-9.3b-github-intake-writeback.md` — Story 2 and Story 4 happy-path `text` assertions.
- `.docs/stories/decide-artifact-coherence-check.md` — Story 1 "verbatim" / "byte-for-byte" wording.
