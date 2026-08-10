# Architecture Review: One branch, one PR, one halt state (#1415)

**Date:** 2026-08-09
**Mode:** design-time, lightweight (Medium tier — Sections 2 and 4 only)
**Source issue:** jstoup111/ai-conductor#1415
**Reviewed:** `.docs/architecture/auto-opened-needs-remediation-pr-occupies-the-bran.md`,
`.docs/architecture/sequences/auto-opened-needs-remediation-pr-occupies-the-bran.md`,
`.docs/track/auto-opened-needs-remediation-pr-occupies-the-bran.md`,
`.docs/complexity/auto-opened-needs-remediation-pr-occupies-the-bran.md`
**Verdict:** APPROVED WITH CONDITIONS

Stories do not exist yet — this review runs before `/stories`, per
`adr-2026-06-29-architecture-before-stories-convergent-kickback`. Its input is the technical
intent from `/explore` plus the verified defect below.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Every mechanic already exists: `openShipDraftPr`, `findOrCreatePr`, `escalateBuildFailure`, `ensureHaltPresentation`, `cleanupHaltPresentation` (with `preserveDraft`), `makeRetainedPrPresentable`. The work is call-site placement and one new clear invocation. |
| Prerequisites | None. No schema, no config key, no migration, no external account. |
| Integration surface | One external surface — GitHub through the injected `GhRunner`/`GitRunner` seams. Crosses four engine modules (`conductor.ts`, `ship-draft-pr.ts`, `build-failure-escalation.ts`, `halt-pr-reconciliation.ts`) plus two read-only consumers (`ci-fix.ts`, `mergeable-sweep.ts`). |
| Data implications | None. `pr_url` in `conduct-state.json` is already written by the SHIP-entry path (`conductor.ts:4046`); BUILD-entry birth writes the same key earlier through the same `commitStateChanges` call. No new state field. |
| Performance risk | One extra `git rev-list --count` plus at most one `gh pr create` per feature, moved earlier rather than added. The sweep's cost is unchanged; a cleared PR drops out of its marked set, so the sweep does strictly less work than today. |
| Worktree isolation | Unaffected. All operations are per-branch and run with the feature's worktree (or `projectRoot`) as cwd; no shared port, DB, queue, or file. Two worktrees cannot contend — each owns a distinct branch, and a branch owns exactly one PR. |

**Feasible.** No blocking technical obstacle.

## Alignment

**Deterministic-where-possible (CLAUDE.md design principle).** Strongly aligned, and this is the
main reason the chosen approach beats the alternatives: the fix is entirely engine machinery. No
prompt tells an agent to adopt a placeholder; the PR simply exists in the right shape before any
agent can ask for it, and the halt state is cleared by code at a dispatch boundary. The failure
being fixed is itself an instance of the principle's warning — the retry loop was an LLM re-asking
a question that machinery should have made unnecessary.

**Event spine.** No new channel. This feature adds no watcher, no poller, no sidecar file, and no
ad-hoc log. The halt reason continues to travel on `ConductorEvent` and `.pipeline/HALT`; the PR
label and marker are GitHub *presentation* of state the spine already carries, not a second
telemetry path. `/event-spine` consultation therefore returns "already carried" — no schema change
proposed.

**State management.** This is the review's strongest alignment finding. Today the halt condition is
encoded in a PR's *identity* (its title shape and the fact of its creation) — an unrepresentable
transition, since a PR cannot stop being the PR it was created as without an out-of-band rewrite.
After this change it is encoded as a *removable attribute* (label + marker) on a stable identity.
That is the enum-over-boolean-flags shape the alignment check asks for, applied to an external
resource.

**Pattern consistency.** Every touched mechanic keeps its existing contract: advisory, never
throws, one loud log line per outcome, injected runners, no raw `execFile`. The clear reuses
`cleanupHaltPresentation`'s existing confirm-and-retry loop rather than inventing a second
retry discipline.

**Security boundaries.** No new endpoint, input, or credential path. `escalateBuildFailure` keeps
its `commitCount === 0` conservative no-op, so no GitHub artifact is created without commit
evidence.

**Production DI defaults.** No in-memory store is introduced or registered. State remains
`conduct-state.json` plus GitHub.

**Diagram accuracy.** The two diagrams authored for this feature match the code read during this
review and are accepted as the design of record.

## Resolved open question

**What escalates a HALT before the branch has any commit over base?**
Nothing, and that is already the shipped behavior — not a gap this feature must fill.
`escalateBuildFailure` returns a conservative no-op at `build-failure-escalation.ts:135` when
`commitCount === 0`, explicitly to avoid creating GitHub artifacts with no evidence. `openShipDraftPr`
applies the same precondition and returns `no-commits`. The chosen approach inherits both unchanged:
in that window the HALT is durable in `.pipeline/HALT` and on the event spine, and there is no PR
because there is nothing yet to review. **No new escalation surface is specified.**

## SHIP-phase assumptions re-checked

The concern was whether earlier PR birth breaks anything downstream that assumes a PR appears only
at SHIP.

| Consumer | Finding |
|---|---|
| `mergeable-sweep.ts` autoresolve | Safe — drafts are skipped outright (`:423`). |
| `mergeable-sweep.ts` ci-fix dispatch | Safe — drafts are skipped outright (`:509`). |
| `finish` ready-flip | Unchanged — `ensureShipReady` remains the only draft→ready transition. |
| Release-disposition snapshot / gate | Improved — `resolveRetainedShipDraftPrUrl` (`:3092`) already accepts any OPEN head/base PR and does not require draft-ness; an earlier-born PR satisfies it sooner rather than differently. |
| Daemon worktree retention | Unchanged — retention keys on `pr-open-awaiting-main` after a *verified ship* (`daemon-runner.ts:463`), and backlog dedup keys on committed `.docs/shipped/<slug>.md` records (`daemon-backlog.ts:790`), never on PR existence. An open draft PR is not a ship signal anywhere. |

**No SHIP-phase assumption is violated.** The one behavior that genuinely changes is that a draft
PR is visible for longer, which is a presentation cost, not a gate.

## Wiring Surface

> **Amended 2026-08-09 by #1415 (conflict-check resolution):** the first row originally named a
> BUILD-entry invocation of `openShipDraftPr`. PR timing is unchanged; that surface is withdrawn
> and replaced by the repair-on-resolution row below.

| New/changed production surface | Where it is called from in production |
|---|---|
| Halt-state repair inside retained-PR resolution | `resolveRetainedShipDraftPrUrl` (`conductor.ts:3092`), reached from the pre-finish snapshot (`:3141`) and the self-host release gate (`:3199`), so every consumer of the retained PR gets a repaired one |
| Resume-time halt-state clear | The same conductor dispatch boundary, before the first step that consumes the retained PR; reached on every dispatch of a feature whose PR carries the marker |
| `cleanupHaltPresentation(..., { preserveDraft: true })` | Called by the resume-time clear above; already exported from `pr-labels.ts` and already called by `halt-pr-reconciliation.ts:161` |
| `escalateBuildFailure` as decorator | Unchanged call path — `daemon-deps.ts:166` → `daemon-runner.ts:508` on an irrecoverable HALT |
| `makeRetainedPrPresentable` adoption path | Retained at `conductor.ts:4051`; this feature must not remove it, since it is what rehabilitates branches already carrying a placeholder |

Every surface is reached from an existing production entry point. This feature introduces no
new CLI subcommand, config key, hook, or event type.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Resume-time clear removes the label but leaves the body marker; `reconcileHaltPrs` re-heals the label on the next tick and the deadlock returns, daemon-driven | Technical | High if unaddressed | High | `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md` — clear both atomically via `cleanupHaltPresentation`, confirm removal, retry on `partial` |
| Resume-time clear also flips the PR out of draft, publishing an in-flight build for review before any ship gate | Technical | Medium | High | Same ADR — `preserveDraft: true`; the draft→ready flip stays finish-owned |
| Escalation adopts the implementation PR and rewrites its `feat:` title to `needs-remediation:` | Integration | Low | Medium | `findOrCreatePr` adopts an OPEN PR untouched (`pr-labels.ts:409`); the title argument is used only on create. Must be covered by an acceptance test, not assumed |
| Branches already stuck (#1395, #1412) are left behind by a fix that only prevents new occurrences | Technical | Medium | Medium | Keep `makeRetainedPrPresentable` as the adoption/rehabilitation path; the spec must cover an already-placeholdered branch as an explicit scenario |
| Earlier PR birth makes the open-PR list noisier during long builds | Knowledge | High | Low | Accepted — drafts are inert to the sweep and unmistakably labelled `feat:`; no mitigation |
| `conductor.ts` is touched by ~40 unmerged spec branches (overlap scan), so a task breakdown here can collide at rebase | Integration | High | Low | Advisory only. Keep the `conductor.ts` edit to the smallest possible dispatch-boundary insertion; put new logic in the existing engine modules |

## ADRs Created

- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` — a branch has exactly one PR; a HALT is a
  state on it, never a second PR. Decision category: cross-cutting error handling and resilience.
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md` — clearing removes the marker and
  the label together and preserves draft, because the marker is the reconciliation sweep's sole
  selector. Decision category: cross-cutting error handling and resilience.

Both were presented to the operator and carry `Status: APPROVED`. No existing ADR is superseded.

> **Amended 2026-08-09 by #1415 (conflict-check resolution):** this section originally justified
> moving PR birth to BUILD entry as "extending, not contradicting"
> `adr-2026-07-29-ship-start-draft-pr`. That was wrong — the 2026-07-29 ADR considered BUILD-start
> publishing as its **Option C and rejected it** ("a PR open for the entire build maximizes the
> window in which the branch is remotely visible but incomplete… the largest change to the
> self-host guardrail surface"). `/conflict-check` raised it as a blocking conflict and the
> operator resolved it by keeping SHIP-entry birth. PR timing is therefore unchanged by this
> feature, `adr-2026-07-29-ship-start-draft-pr` stands unmodified, and the fix is adopt-and-repair
> plus the atomic resume clear. Nothing here supersedes anything.

## Conditions

1. **Marker and label must be cleared as one confirmed operation, draft preserved.** A partial
   clear is reported as `partial` and retried; it is never reported as success. Verified by an
   acceptance test that ticks `reconcileHaltPrs` after a clear and asserts the PR is not re-healed.
2. **Escalation must not rewrite an adopted PR's title or body prose.** Verified by an acceptance
   test that escalates against an existing `feat:` draft PR and asserts the title survives while
   the label, marker, and halt comment are added.
3. **An already-placeholdered branch must be recoverable.** The spec covers a branch whose only PR
   is a `needs-remediation:` placeholder (the #1395/#1412 shape) and asserts that clearing the HALT
   plus a re-dispatch yields a usable implementation PR with no hand-editing.
4. **BUILD-entry birth keeps the existing preconditions.** No PR is created when the branch has no
   commit over base or when the push fails; both remain advisory and never throw into the loop.
5. **The `conductor.ts` change stays a minimal dispatch-boundary insertion.** New behavior lives in
   the engine modules, to limit rebase collision against the many unmerged branches touching that
   file.

Conditions are tracked into `/plan` and checked at code review; unmet conditions at `/finish` are
blocking.
