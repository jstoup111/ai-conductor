# Coherence: A committed, pushed halt record (#1809)

**Date:** 2026-08-23
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; the stories file carries the
requirement layer directly).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1809, staged at
`.pipeline/intake-outcomes.md` and carried into the spec by the `.docs/intake/` marker landed with
this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | "A record of the halt (reason, class, the findings that caused it, the step that halted) is committed on the feature branch and pushed when a remote exists." Story 1 fixes the record's fields, including the verbatim HALT body that carries the causing findings for PLAN_GAP and gate halts; Story 2 owns the push. |
| outcome | outcome-2 | story-1, story-2 | covered | "An operator can read that record from the branch alone, without access to the daemon host." Story 1's third happy-path criterion states the branch-only read explicitly; Story 2 is what puts the branch on the remote. |
| outcome | outcome-3 | story-2 | covered | "A halt that cannot push still commits locally and reports the push failure; the halt itself is never lost." Story 2's three negative paths cover no-remote, rejected push, and the record's own statement that it may be ahead of the remote. |
| outcome | outcome-4 | story-3 | covered | "Resuming a feature clears or supersedes the record so a stale halt record never blocks a later run." Story 3 chooses supersession over deletion, per the ADR's rejected-alternatives section. |
| story | story-1 | task-1, task-2, task-4, task-7, task-10 | covered | Deterministic render, the recordability predicate that excludes mechanical halts and the default branch, the path-scoped idempotent commit, the seam wiring, and the end-to-end branch-only read. |
| story | story-2 | task-3, task-5, task-6 | covered | The three spine events, the best-effort push arm with its no-remote and rejected-push negatives, and the ahead-of-remote caveat rendered into the record. |
| story | story-3 | task-8, task-9, task-10 | covered | Pure supersession preserving the halt history, its wiring to the existing halt-clear call site with the cause passed through, and the end-to-end resolved-after-fetch assertion. |
| story | story-4 | task-4, task-7, task-11 | covered | The dirty-worktree assertion, the seam's unchanged marker bytes and non-throwing failure arms, and the documentation of the record and its mechanical exclusion. |
| task | task-1 | story-1 | covered | Renders every field story-1 names and asserts byte-identical output on repeat. |
| task | task-2 | story-1 | covered | Mechanical class and default-branch roots are both not-recordable, failing closed on an unresolvable branch. |
| task | task-3 | story-2 | covered | The three additive union members and their sink-policy rows, which story-2's happy path observes. |
| task | task-4 | story-1, story-4 | covered | Exactly-one-path commit, no second commit on identical bytes, and the unrelated modified file left uncommitted. |
| task | task-5 | story-2 | covered | Record present on the bare remote; local commit survives both the no-remote and rejected-push arms without throwing. |
| task | task-6 | story-2 | covered | The ahead-of-remote caveat line, re-checked against task-1's determinism assertion. |
| task | task-7 | story-1, story-4 | covered | Record produced from the seam for needs-human, absent for mechanical, failure emitted as an event, and the marker bytes asserted unchanged. |
| task | task-8 | story-3 | covered | Status flips to resolved with cause and timestamp; the original reason survives; an already-resolved document is unchanged. |
| task | task-9 | story-3 | covered | Wired to the existing `appendHaltClearedRecord` call site; both causes pass through; no record means no file and no commit; the audit append survives a supersede throw. |
| task | task-10 | story-1, story-3 | covered | Acceptance test reads the record from a clone with no access to the origin worktree, then observes resolved after the clear and a fetch. |
| task | task-11 | story-4 | covered | Runbook pickup section, artifact reference including the mechanical exclusion, and the consumer-facing HARNESS.md rule. |
| adr | adr-2026-08-23-committed-halt-record | story-1, story-2, story-3, story-4 | covered | Every decision has an implementing story: D1 (a git-tracked `.docs/halted/<slug>.md` sibling of the shipped record) and D4 (the record's fields) by story-1; D2 (produced at the single `writeHaltMarker` seam) by story-1 and story-4; D3 (only non-mechanical classes) by story-1's first negative path; D5 (commit first, push best-effort) and D6 (nothing throws) by story-2 and story-4; D7 (supersede in place, do not delete) by story-3; D8 (durable state plus additive `ConductorEvent` members, no parallel channel) by story-2's happy path and story-4's negative paths. Checked in both directions: no story asserts behavior the ADR forbids — story-3 supersedes rather than deletes, matching the ADR's rejected alternative, and no story requires recording a `mechanical` halt. |

No `gap` rows. Every `covered` verdict was checked against the cited artifact file in this
worktree (`.docs/stories/a-halt-leaves-no-committed-pushed-record-for-the-o.md` and
`.docs/plans/a-halt-leaves-no-committed-pushed-record-for-the-o.md`).

## Assumptions surfaced

- **The HALT body carries the causing findings for the halt classes that have them** — ~85%,
  inferred. `outcome-1` names "the findings that caused it" as a field, and the design carries the
  HALT body verbatim rather than re-deriving findings from the review artifacts. Impact if wrong:
  a PLAN_GAP record names the verdict but not the individual findings, and an operator has to open
  `.pipeline/build-review/` to see them. Mitigated: the record carries the halting step, so the
  artifact directory to open is named. Confirm by reading the HALT body written at
  `conductor.ts:5953` and `conductor.ts:5968` for a `plan-gap` route.
- **`resolveRecordability`'s default-branch check is the right containment for the self-host live
  boundary** — ~90%, inferred from `.docs/conflicts/` C1 and the live-boundary rules in
  `AGENT_INSTRUCTIONS.md`. Impact if wrong: a halt raised against a root checkout that is
  legitimately on a feature branch would commit there. Mitigated: the root checkout is held on the
  default branch by standing policy, so the check and the policy agree. Confirm by running the
  self-host boundary suite after task 7.
- **No consumer repository has an existing `.docs/halted/` directory with a conflicting meaning**
  — ~95%, verified for the two registered consumer projects (`ledger-demo`, `best-stock-picker`),
  neither of which has one. Impact if wrong: a name collision in a repository not surveyed.
