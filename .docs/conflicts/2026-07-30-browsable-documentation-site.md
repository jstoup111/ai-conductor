# Conflict Check: Browsable Documentation Site

**Date:** 2026-07-30
**New stories:** `.docs/stories/browsable-documentation-site.md` (FR-1 through FR-9, Accepted)
**Comparison set:** all 269 story files, all 43 spec files, and all 142 prior conflict reports present in the isolated worktree
**Result:** **CLEAR — zero blocking conflicts and zero accepted degrading conflicts.**

## Inventory and Method

The full story, spec, and prior-report inventories were enumerated. Titles, requirement tags, statuses, and domain terms were scanned across the corpus; detailed interaction checks covered the new nine-story set and every existing contract sharing documentation publication, README, `docs/`, link validation, CI, integrity, default-branch, or hosted-site surfaces.

All five conflict types were evaluated: contradiction, behavioral overlap, state conflict, resource contention, and sequencing.

## New-Story Pair Analysis

- **FR-1/FR-2/FR-3/FR-4 — landing, section discovery, persistent navigation, and orphan prevention:** compatible layering (99%, verified). FR-1 establishes the root, FR-2 its top-level destinations, FR-3 navigation from each topic, and FR-4 the completeness invariant. No story assigns conflicting ownership or visibility.
- **FR-5/FR-6 — repository source and automatic publication:** compatible sequence (99%, verified). The authoritative merged Markdown is the input that FR-6 publishes; neither story permits a second source or manual release action.
- **FR-6/FR-7 — automatic publication and main-only authority:** compatible boundary (99%, verified). FR-6 triggers only after default-branch merge; FR-7 explicitly prevents pre-merge/non-default content from replacing the site.
- **FR-8 with FR-1/FR-2:** compatible entry points (98%, verified). The repository overview links to the hosted root, while the hosted root supplies the section map; retaining source links does not create a second content authority.
- **FR-9 with every other story:** compatible enforcement (99%, verified). FR-9 detects broken source/navigation before merge and exposes external deployment failure afterward; it does not redefine the success behavior of FR-1 through FR-8.

No new-story pair creates an ambiguous state, shared-writer contention, circular dependency, or mutually exclusive order.

## Existing Contract Interactions

### Issue #787 documentation relocation stories

`.docs/stories/condense-readme-relocate-docs.md` explicitly declares GitHub Pages wiring out of scope and assigns it to issue #831. The existing story keeps the README concise and preserves categorized source links; FR-8 adds one hosted-site entry while retaining those links. This is the planned follow-on, not duplicate or contradictory behavior (99%, verified from the accepted story text).

### Repository-local documentation maintenance

`.docs/stories/maintain-documentation.md` says README stays unchanged unless its landing-page contract changes. FR-8 changes that exact contract by adding the hosted documentation front door, so the exception applies. Its single-source and reader-centered taxonomy requirements reinforce FR-2, FR-4, and FR-5. The same story requires a changelog entry for a notable reader-visible implementation; the implementation plan must include that entry (99%, verified).

### Docs-only CI classification

`.docs/stories/skip-full-ci-for-docs-only-changes.md` applies only when every path is under `.docs/`. This implementation changes human-facing `docs/`, root landing content, and repository validation, so it remains a mixed/non-`.docs` change and the heavy CI path runs. Future `docs/` edits continue exercising the navigation-contract validation. No skip predicate is weakened (99%, verified against the accepted story and current workflow).

### Full-suite evidence and documentation mutations

`.docs/stories/full-suite-verification-gate-940.md` permits content-current aggregate proof reuse for documentation-only changes while independently invalidating on tests or test infrastructure. The new navigation check belongs to repository integrity, not the project's aggregate Vitest command. Its initial test/integrity implementation invalidates normally; later prose-only edits may reuse Vitest evidence while still running CI's integrity/link checks. The two authorities remain distinct (97%, verified).

### Third-party test isolation and link validation

The repository contract forbids real third-party calls in default automated tests and permits only explicitly named opt-in smoke tests. The approved ADR keeps navigation validation and internal-link checks offline; GitHub Pages status and any live URL request are post-merge smoke/manual evidence. No external uptime becomes a default test dependency (99%, verified).

### Release and changelog policy

The feature is a notable reader-visible implementation, so the repository-local changelog rule requires an `[Unreleased]` entry. It changes no breaking surface and requires no migration block or waiver. This is a planning obligation, not a conflict (98%, verified against repository instructions and the maintain-documentation story).

## Resource and Sequence Review

- **Shared files:** The root project overview, documentation tree, integrity suite, and validation reference are intentional single-branch edits. The pre-plan overlap scan found no open branch blocker. No concurrent runtime writer exists.
- **Publication ordering:** feature branch validation → operator merge → default-branch Pages deployment → live verification is acyclic and agrees with FR-6/FR-7.
- **Failure state:** a failed external deployment remains visible and must not be treated as success; offline repository validation has a separate pre-merge verdict. No impossible combined status is introduced.
- **Provider scope:** publication and validation are independent of Claude/Codex host selection; no provider resource contention exists.

## Re-check Verdict

**CLEAR.** Zero blocking conflicts remain. Zero degrading conflicts are accepted. No story amendment, PRD kickback, architecture amendment, or superseding ADR is required.

## Verify-Claims Ledger

### Claims

- [verified] All 269 story files, 43 spec files, and 142 prior reports were inventoried from the worktree.
- [verified] The only corpus files naming GitHub Pages, a hosted documentation site, remote themes, Jekyll, or site navigation are the new PRD/stories and #787's explicit deferral to #831.
- [verified] Every adjacent README, documentation-maintenance, CI, integrity, release, and test-isolation contract was reasoned through above with its exact interaction.

### Assumptions

- None pending. The clean verdict rests on accepted artifacts and observed repository configuration, not an unconfirmed behavioral assumption.

Verdict: CLEAR
