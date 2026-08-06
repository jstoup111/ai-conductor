# ADR: Token-first normalization of the plan `**Stories:**` reference

**Date:** 2026-08-05
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #1330

## Context

`resolvePlanStoriesPath` captures the whole remainder of the `**Stories:**` line
(`/^\s*\*\*Stories:\*\*\s*(.*?)\s*$/im`), unwraps a fully-surrounding backtick pair, tries a
whole-string Markdown link, and then validates. Any trailing prose survives into the
validation step and fails the `.md` extension check, so the reference resolves to `null`.

Measured on this repository's default branch, 82 of 253 plans carry such a reference. The
observed shapes include:

    **Stories:** `.docs/stories/x.md` (12 stories, FR-1..FR-12)
    **Stories:** .docs/stories/x.md (11 stories)
    **Stories:** `.docs/stories/x.md` (TR-1..TR-13 — this PR closes the *wiring*
    **Stories:** .docs/stories/features/conduct/ST-001 through ST-011

The same function is the authority for the land-time gate (`land-spec.ts:260`), so whatever
it accepts is simultaneously what a spec may be authored with.

## Options Considered

### Option A: Normalize to a reference token, then validate (chosen)
Before validation, reduce the captured remainder to a single reference:
1. If it starts with a backtick, take the span up to the next backtick.
2. Else, if it starts with a Markdown link, take that link's target.
3. Else, take the first whitespace-delimited token.

The existing validation (absolute refusal, traversal refusal, `.md` requirement, relative
resolution from the plan's directory) then runs unchanged on that token.

- **Pros:** handles every observed shape and unanticipated future ones (`— 11 stories`,
  `ST-001 through ST-011`, a trailing footnote) with one rule; keeps validation as the single
  refusal point; preserves paths containing spaces when they are backticked or link-wrapped,
  which are the only forms in which such a path can be written unambiguously.
- **Cons:** a bare (unquoted, unlinked) path containing a space now resolves to its first
  segment and is refused on the `.md` check rather than being interpreted. This is accepted:
  a bare path with spaces is already ambiguous with an annotation, and the refusal is loud
  under this feature.

### Option B: Strip a trailing parenthetical before validating
- **Pros:** minimal change; fixes the two reported `reporting_app` cases.
- **Cons:** misses `ST-001 through ST-011`, em-dash annotations, and unbalanced parentheses
  (one observed plan's annotation is not closed on the line). Each future annotation style
  becomes another special case, and each one is another silent-null incident.

### Option C: Reject annotations and fix the plans
- **Pros:** no parser change; one canonical form.
- **Cons:** does not help the 82 plans already merged, and does not help other repositories
  at all; `/plan` output and hand-authored plans both produce the annotated form naturally,
  so the contract is fighting its authors.

## Decision

Option A. Normalization is a separate, tested step that precedes validation; validation keeps
its current refusals verbatim. Backtick span beats Markdown link beats first token, checked in
that order, so an inline-code path containing a space still resolves.

## Consequences

- Plans whose reference was previously `null` now resolve. In this repository that makes 82
  plans resolvable, of which all but one are already covered by processed markers or shipped
  records; the remaining one becomes eligible, which is the intended behaviour.
- Other repositories may see a larger burst, because `.daemon/processed/` markers are
  machine-local. `adr-2026-08-05-blocked-classification-after-dedup` records why this is
  bounded by the existing shipped-record dedup rather than by a new suppression mechanism.
- `landSpec` accepts the annotated form too, since it shares the resolver. This is intended:
  authoring and discovery must never disagree about what a reference means.
- Negative paths are unchanged: absolute (POSIX and Windows), traversal, non-`.md`, and
  empty references are all still refused.
