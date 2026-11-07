**Status:** Accepted

# Stories: Hand-moved closure ref with a live repairing marker (#3436)

Hotfix, technical track. The silent exit #3436 reported was removed by #3470; this story closes the
remaining gap, an undetected disagreement that drops the routed repair.

## Story 1: A host closure moved off its round's pin halts with a working recovery

**Requirement:** #3436 desired outcomes 1, 2 and 4; adr-2026-10-12-routed-whole-feature-repair (routed repair base pinned at region entry)

As an operator, I want a dispatch to stop when a routed host's closure no longer matches its open round's pin, so that a hand-moved ref is named at once and cannot silently keep the repair from the children above the host.

### Acceptance Criteria

#### Happy Path
- Given an open routed round whose marker names an admitted or repairing host and whose recorded entry pinned that host at a commit, when `refs/conductor/<slug>/closed/c<host>` resolves to a different commit and the stack preflight runs, then it halts needs-human before reconciling the round, leaves every `refs/conductor/<slug>/*` ref unchanged, and its HALT names the closure ref and value, the pinned value, the round, and the repair marker ref and blob.
- Given that halt, when the operator runs its printed `git update-ref` compare-and-swap and clears the halt, then the next stack preflight continues the round into the host with no HALT.

#### Negative Paths
- Given a repairing host whose closure equals its round's pin, when the stack preflight runs, then it dispatches as it did before this check.
- Given a built host whose closure differs from its round's pin, when the stack preflight runs, then this check does not halt it, because a restack moves the closure from `built` and journal recovery owns any crash in that window.

### Done When
- [ ] A real-Git test moves the closure, asserts the halt text and unchanged refs, executes the printed `git update-ref`, and asserts the next preflight navigates to the host.
- [ ] A real-Git test asserts the unmoved repairing host and the moved built host do not take this halt.
