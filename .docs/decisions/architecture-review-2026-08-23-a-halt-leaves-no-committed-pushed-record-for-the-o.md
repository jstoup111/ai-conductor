# Architecture Review: A halt leaves no committed, pushed record for the operator to pick up from

- **Status:** APPROVED
- **Approved by:** operator (James), 2026-08-23
- **Date:** 2026-08-23
- **Tier:** Medium (lightweight review)
- **Feature:** a-halt-leaves-no-committed-pushed-record-for-the-o
- **Source:** jstoup111/ai-conductor#1809
- **ADRs:** adr-2026-08-23-committed-halt-record

## Scope of review

Medium tier, so this is a lightweight review: it checks feasibility, the event-spine boundary, the
failure semantics of the seam being extended, and alignment with the existing shipped-record
precedent. It does not re-derive the halt taxonomy.

## Findings

**F1 — The seam is correct and is the only correct one.** Every halt funnels through
`writeHaltMarker` (`halt-marker.ts:70`); its ~30 call sites include paths that raise halts from
inside the finish flow, the rebase step, and self-host gates. Producing the record at any call
site guarantees a path that forgets it. Accepted as designed.

**F2 — The seam's best-effort contract is load-bearing and must be preserved.** The module comment
states it explicitly: "a failed write must not crash the finish flow." Adding fs, git and network
work behind that contract is the main risk this feature carries. Resolution: every arm of the
record path returns a result; nothing throws; each failure mode emits its own event. This is the
same discipline `shipped-record-cli.ts` already applies (warn once, exit 0).

**F3 — Dirty-worktree safety.** A halt frequently fires with uncommitted work present. A bare
`git add -A` would commit a partial build into the record commit and corrupt the branch the
operator is meant to pick up. Resolution: path-scoped `git add -- <record path>` plus the
shipped-record idempotency guard (`git diff --cached --quiet -- <path>` before committing), so a
re-halt with identical bytes creates no duplicate commit.

**F4 — No protected-artifact interaction.** `.docs/halted/` is not in
`PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts:17-25`), so the record cannot itself
trigger a `protected-artifact` halt. Confirmed by reading the constant, not inferred.

**F5 — Event-spine boundary.** The record is durable state (exception C), not an occurrence; the
occurrences it generates are additive `ConductorEvent` members. No second telemetry channel is
created and no status is stamped into an existing artifact to stand in for an event. Compliant.

**F6 — Push semantics need an explicit failure disposition.** A push can fail for reasons that are
not errors at all (no remote configured, offline daemon host) and for reasons that are
(non-fast-forward, auth). Neither may lose the halt. Resolution: the commit always precedes the
push; a push failure emits `halt_record_push_failed` naming the reason and leaves the commit in
place, and the record body itself states that it may be ahead of the remote.

**F7 — Staleness is the failure mode most likely to bite.** A record left saying "halted" on a
feature that has since resumed is worse than no record, because an operator will act on it.
Resolution: supersede at the existing halt-clear seam (the `halt_cleared` emission points in
`conductor.ts` and `daemon-deps.ts`) rather than adding a new observer, and make the record carry
a `Status:` line so a stale record is identifiable rather than merely absent.

**F8 — Deletion versus supersession.** Deleting the record on resume satisfies the issue's
"cleared" wording with less code, but discards the audit trail this repository otherwise keeps for
every halt, and makes "was this feature ever halted?" unanswerable from the branch. Supersession
in place is chosen; the file stays, its `Status:` flips to `resolved`, and the resolution cause is
appended. Recorded in the ADR as the rejected alternative.

## Verdict

**APPROVED.** The design is feasible, sits on the existing seam, introduces no parallel channel,
and its one genuine risk (F2) is contained by the same best-effort discipline the seam already
declares. Proceed to stories.
