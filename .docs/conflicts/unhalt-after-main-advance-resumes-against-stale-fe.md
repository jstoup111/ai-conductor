# Conflict Check: Unhalt after main advance resumes against stale feature base

**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1245
**Stem:** `unhalt-after-main-advance-resumes-against-stale-fe`
**Corpus:** `repo_wide` (`.ai-conductor/config.yml:95`) — 450 ADRs in `.docs/decisions/`, narrowed
by subject scan to the re-kick/resume/park, seal/reseal, post-rebase-invalidation, build_review-base
and event-spine families; every `.docs/stories/` file and the adjacent `.docs/plans/` specs were
inventoried, then cross-checked against `.docs/shipped/` and against live source to separate
accepted-and-built from accepted-but-unbuilt.
**Result:** **PASS — zero blocking conflicts.** One degrading contradiction of a written assumption
was found and resolved by an additive amendment; the remaining findings are constraints accepted and
recorded below. The one open overlap (#603 `base-refresh`) was closed by operator decision on
2026-08-11 — that feature is declined and will not be built.

## Findings

| # | Party | Type | Severity | Verdict |
|---|---|---|---|---|
| 1 | `adr-2026-07-07-build-review-judgement-gate` §3 diff parenthetical | contradiction | degrading | Resolved by additive amendment; assumption was already false before this feature |
| 2 | `adr-2026-07-28-total-halt-classification-legacy-boundary` (supersedes `adr-013`) | overlap | degrading | Widens play-forward *reach*, not re-kick *eligibility* — accepted, stated explicitly |
| 3 | `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | state-conflict | degrading | Tree-keyed budget can refill on each resume-triggered rebase — bounded by operator action; test required |
| 4 | `.docs/plans|stories/daemon-build-start-base-refresh` (#603, accepted, unbuilt) | overlap | none | Closed — operator declined #603 on 2026-08-11; no reconciliation owed |
| 5 | `adr-2026-07-23-build-review-fresh-base-disposition` (stale-mirage regrade) | overlap | degrading | Complementary; the regrade path provably could not rescue this defect |
| 6 | `adr-2026-08-03-fail-closed-decide-entry` D6 | contradiction (apparent) | none | Refuted — a rebase is not a DECIDE entry; no grant is manufactured |
| 7 | `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` | sequencing | degrading | Ordering constraint on the inserted work; recorded |
| 8 | `adr-2026-07-13-park-all-dispatch-paths` D2 | sequencing | degrading | Park-to-build-start window widens by one probe; no new call site |
| 9 | `.docs/stories/re-kick-sentinel-can-strand-an-active-feature-outs` (#1232) | overlap | degrading | Complementary; one semantic interaction recorded |
| 10 | `adr-2026-08-05-provenance-based-protected-artifact-inheritance` | contradiction (apparent) | none | Refuted on framing — Story 7 is post-rebase rotation, not inheritance-drift repair |
| 11 | `adr-2026-07-11-verdict-aware-resume-entry` | sequencing | none | Compatible, and *requires* the chosen placement |
| 12 | `adr-2026-07-04-operator-park-marker`, `-08-06-honest-park-termination-boundary` | sequencing | none | Compatible; after-park placement is the only compliant one |
| 13 | Engine-origin-advance family (3 artifacts) | — | none | Orthogonal — engine checkout, not feature base |
| 14 | `adr-2026-07-26-event-sink-registry-exhaustiveness` | resource-contention | none | Compatible; sink declaration is compile-enforced, already in Story 9 |

## 1. Contradiction — the build_review diff-stability assumption (resolved)

`adr-2026-07-07-build-review-judgement-gate` describes its diff input as:

> "the diff: `git diff <merge-base(derived default branch, HEAD)>..HEAD` (full feature diff;
> stable during BUILD since the only sanctioned rebase is finish-time),"

This feature introduces a rebase during BUILD (at halt-resume), so the parenthetical is falsified.

**It was already false.** The re-kick play-forward (`resumeRebaseFirst`) rebases pre-loop on the
sentinel path and predates that ADR; `adr-2026-07-12-rebase-evidence-stamp-translation` names both
`performRebase` call sites explicitly, one of them `resumeRebaseFirst`. So the assumption describes
a world that had already changed. This feature widens the *frequency* of a sanctioned mid-BUILD
rebase, not the *class*.

**Resolution:** an additive amendment note placed beside the original assertion in that ADR, per
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`. The original text is preserved; the
note corrects the stability claim only and leaves the diff definition, rubric, and verdict predicate
untouched. Confidence 95% — verified by reading the ADR text and both `performRebase` call sites.

Nothing in this feature's design changes as a result. Recorded because a future reader relying on
"the only sanctioned rebase is finish-time" would reason incorrectly about grading.

## 2. Overlap — halt-class eligibility vs play-forward reach

`adr-013-daemon-main-advance-rekick` is **SUPERSEDED by**
`adr-2026-07-28-total-halt-classification-legacy-boundary`, which carries forward five of its
clauses unchanged, including:

> "- rebase-first play-forward before gate re-verification."

and narrows eligibility:

> "Only eligibility changes: `mechanical` and explicitly `legacy` dispositions re-kick;
> `needs-human` and `unclassified` remain halted."

The superseded ADR's §4 states this feature's exact rationale as the original reason the mechanism
exists:

> "A re-kicked feature must integrate the advanced base **before** re-running the gate it halted
> on — otherwise a gate-failure halt (e.g. prd-audit) re-runs against the stale base, never sees
> the unblocking commit […] and re-halts without playing forward."

That is the #1245 defect, described in the ADR that established the recovery mechanism. The hole is
that the later classification work removed `needs-human` from the sweep's eligibility, and the
play-forward was only ever reachable through the sweep's sentinel.

**The distinction that must not blur:** this feature widens **play-forward reach**, not **re-kick
eligibility**. It never clears a HALT marker, never classifies one, and never re-dispatches. It acts
only on a resume the operator's own clear already authorized. A `needs-human` halt still never
auto-clears. Accepted as degrading because the two read similarly and a future reviewer could
mistake one for the other; Story 5 and Story 2's negative paths pin the boundary.

## 3. State conflict — kickback budget refill on a moving tree

`adr-2026-07-26-cross-dispatch-kickback-livelock-bound` keys its budget to the tree hash:

> "**Tree hash differs, OR the resolved-task count increased → reset `count` to 1 and store the new
> hash** (genuine progress earns a fresh budget — the issue's third desired outcome)."

> "**`count > MAX_KICKBACKS_PER_GATE` → HALT** (D4)."

A resume-triggered rebase moves the tree, so it grants a fresh kickback budget. In principle a
feature could be kept below the livelock bound indefinitely by repeated rebases.

**Why this is degrading and not blocking.** The trigger is not autonomous: each cycle requires an
operator to clear a HALT, and after the first successful rebase the base is no longer advanced, so
the next resume evaluates `current` and performs no rebase. The refill is therefore bounded by
human action and self-limiting, unlike a sweep-driven loop. It is real enough to warrant explicit
coverage — Story 8's negative path already specifies the repeat-clear case; the plan must assert
that a second resume at an unchanged base performs no rebase and grants no fresh budget.

## 4. Overlap — the accepted-but-unbuilt base-refresh spec (#603)

`.docs/stories/daemon-build-start-base-refresh.md` (Status: Accepted) Story 2 states:

> "**Then** the engine runs the `base-refresh` action — `discoverLocalBase` → `resolveBase` (fetch
> origin, discover default) → `performRebase` onto `origin/<default>` — HEAD becomes a descendant
> of `origin/<default>`, and only THEN is the first build task dispatched"

Its problem statement is the same family as #1245:

> "**Problem.** The daemon builds features on stale code bases and re-fails on already-merged fixes"

**Verdict: partial overlap, disjoint trigger and disjoint mechanism.** That spec fires
unconditionally at `after: plan`, once per feature, before any build task, via a new config-driven
custom-step framework and an `actions.ts` registry. This feature fires only at halt-resume,
conditional on a detected advance, through the existing `resumeRebaseFirst`. This feature's coverage
window is a strict subset; it implements none of that spec's framework scope.

**Verified unbuilt:** no `src/conductor/src/engine/actions.ts` exists, `.ai-conductor/config.yml`
declares no base-refresh step, and PR #603 was the spec PR (merged 2026-07-21) whose implementation
never landed. `adr-2026-07-25-custom-step-completion-artifacts` postdates it and evolved the
framework along the `skill:` axis only — no `action:` body kind exists.

**Operator decision, 2026-08-11: #603 is declined — that feature is not wanted.** The overlap is
therefore closed rather than deferred. This feature is the sole pre-dispatch base-freshness
mechanism in the tree, no reconciliation is owed to a future `base-refresh` implementation, and the
double-rebase interaction described above cannot arise. The #603 artifacts were left on disk
untouched (this spec deletes no other feature's artifacts); retiring them is a separate cleanup.

## 5. Overlap — the stale-mirage regrade path

`adr-2026-07-23-build-review-fresh-base-disposition` bounds its own path:

> "A persisted per-feature-session regrade counter caps invalidation at ONE; a second stale
> detection HALTs with the sha evidence. The engine never rebases or deletes in this path — history
> mutation stays with the existing re-kick machinery."

The two mechanisms are complementary by that ADR's own delegation, and the reason matters:
**the regrade path provably could not have rescued #1245.** It re-verifies the flagged content
against a freshly-resolved base *without rebasing*. Because the merge-base does not move without a
rebase, the upstream-equivalent commit is still present under a fresh base, so the disposition
classifies it `kicked-to-build` (genuine out-of-scope work), not `invalidated`. Confidence 92% —
verified by reading `build-review-disposition.ts:55-75,180-195`.

Interaction to cover: a resume-triggered rebase removes the mirage before the disposition layer
sees it, so in the resume case the regrade counter should go unconsumed. A resume is not a fresh
feature session (`isFreshFeatureSession = !state.run_started_at`, `conductor.ts:1915`), so the
budget does not refill on resume — meaning a wrongly-consumed regrade would be durably lost. Worth
an explicit assertion in the plan.

## 6. Apparent contradiction, refuted — "clearing the HALT is not a grant"

`adr-2026-08-03-fail-closed-decide-entry` states:

> "**Independent of the HALT marker.** *Clearing the HALT is not a grant.* […] if that alone
> re-permitted entry, the routine operator action would silently become an authorization."

This feature does attach new behavior to the halt-clear gesture, which is the shape that ADR
guards. It is not a violation: the new behavior is a **rebase**, not a DECIDE entry. No grant is
created or implied, `plan` remains ungrantable, and a cleared HALT with no grant still re-halts
identically at the DECIDE seam. The ADR's own principle — "Enforcement must sit at the seam that
acts, not at the seam that initializes" — argues *for* this placement. Recorded because the
surface reading is adversarial and a reviewer will press it.

## 7. Sequencing — the atomic halt-state clear

`adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`:

> "**Ordering constraint for implementation.** The clear must run before the first task that
> consumes the retained PR, and its confirm-retry must complete rather than being fire-and-forget"

This feature inserts work — a possible full rebase, and on conflict a bounded resolution plus a
HALT — between resume entry and the first PR-consuming task. Constraint carried forward: the
resume-time halt-state clear must still complete before that first consumer, and a play-forward
that re-halts must not leave the halt state half-cleared.

## 8. Sequencing — park-to-build-start window

`adr-2026-07-13-park-all-dispatch-paths` requires the park predicate "immediately before" every
build start and enumerates `resumeRebaseFirst` as one such site, policed by a grep-derived
enumeration test. Inserting base evaluation between the park read and the play-forward widens that
window by one `ls-remote` probe. This is a cost, not a violation — the alternative (evaluating
before the park check) would violate `adr-2026-07-04-operator-park-marker`'s requirement that the
park check precede every autonomous decision about the slug, and would issue network I/O against a
parked worktree. **No new build-start call site is added** — a second entry *condition* on the
existing site leaves the enumerated set unchanged, so the enumeration test still passes.

## 9. Overlap — #1232's stranded-sentinel reporting

`.docs/stories/re-kick-sentinel-can-strand-an-active-feature-outs.md` declares:

> "Scope is reporting only (approach B). Nothing in these stories clears a sentinel, dispatches a
> feature, parks a worktree, or removes a worktree."

Complementary: #1232 reports stranded sentinels; this feature reduces how often recovery depends on
a sentinel existing at all. **One semantic interaction worth recording:** #1232's reporting model
treats sentinel presence as the signal that recovery is pending. After this feature, a play-forward
can occur with no sentinel, so sentinel *absence* no longer implies "no recovery pending". #1232's
assertions remain true as written — it reports what it finds — but its operator-facing narrative
becomes incomplete rather than wrong. No change required in either spec; flagged so whichever lands
second does not read the other's silence as a contradiction.

## 10. Apparent contradiction, refuted — automatic rotation as drift repair

`adr-2026-08-05-provenance-based-protected-artifact-inheritance` rejects an alternative:

> "**Rotate the seal automatically on this drift.** Rejected: rotation rebaselines what the seal
> considers authoritative. Inheritance is a question about one path's provenance and should not
> re-authorize every other artifact in the seal as a side effect."

This rejects rotation *as the remedy for behind-base inheritance drift on the inspection path* — not
automatic rotation generally, which the same ADR cites approvingly as prior art. Story 7 is framed
as the post-rebase rotation `adr-2026-07-26-protected-artifact-seal-rebaseline` already mandates
("after a clean rebase, rotates it to the post-rebase HEAD. This is the normal path"), triggered by
the base having advanced — not as inheritance-drift repair. The framing is load-bearing and Story 7
was amended to keep it explicit.

## Operator-only reseal is not breached

The sharpest risk this check was asked to adjudicate: does an automatic rebaseline circumvent
`adr-2026-08-09-operator-only-scoped-artifact-reseal`? **No — confirmed from that ADR's own text,**
which scopes itself to the verb and preserves the automatic path:

> "`adr-2026-07-26-protected-artifact-seal-rebaseline` — the automatic rotation this decision leaves
> untouched."

> "`rotate`'s behavior is byte-identical, so the automatic rebase path carries no regression risk."

Reseal (operator-only, TTY-gated, `--reason`-mandatory, `audit: true`) and rotation (engine-owned,
predicate-guarded, `audit: false`, lineage recorded in `rebaselines[]`) are two distinct mechanisms
named as such by the ADRs. `adr-2026-08-09-seal-rotation-authorship-predicate` independently
contemplates exactly this recovery: "Features already halted by this bug recover on their next
resumed attempt with no operator intervention, no manual JSON edit, and no reseal."

Constraints carried forward into the plan: the authorship predicate refuses feature-authored
divergence and fails closed on indeterminate provenance; the base tip must be resolvable or rotation
is refused (which aligns exactly with this feature's `undeterminable` verdict); and pre-rebase seal
verification still blocks an already-violated seal.

## Claims examined and refuted

Two claims surfaced during the sweep were checked against source and did not survive:

**"A fourth caller arms the REKICK sentinel"** (suggested by
`adr-2026-07-11-evidence-judge-cli-and-cutover`'s "HALT-clear plus REKICK sentinel drop"). Refuted:
`REKICK_SENTINEL` is written in exactly one place, `clearMarker` (`daemon-rekick.ts:325`), whose
production callers are exactly three (`daemon-cli.ts:1418`, `daemon-cli.ts:1517`,
`reseal-cli.ts:146`). That ADR describes a runbook gesture an operator performs, not a code writer.
`adr-2026-08-11-play-forward-entry-trigger`'s three-caller claim stands.

**"The re-kick site is build-pre-verify-absent, so each play-forward costs a full build dispatch"**
(from `.docs/plans/post-rebase-build-invalidation-dispatches-a-full-b.md`, #420). Refuted as stale:
`makeRekickBuildPreVerify` is the wired default on that path (`daemon-rekick.ts:344-376,537`),
shipped by #1104 (`da0495e46`). The `build` gate *is* mechanically pre-verified on the re-kick path,
so the marginal cost of an extra play-forward is materially lower than that plan document states.

## Cost of firing the play-forward more often

Not a conflict, but the constraint set that bounds the main registered risk.
`adr-2026-07-20-post-rebase-delta-aware-invalidation` makes invalidation delta-gated, so a rebase
whose delta does not touch the feature's own source **preserves** the judged tail rather than
re-running it. `build` is mechanically pre-verified (above). `build_review` re-grades on any
non-empty delta, which is correct — it grades the diff. `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`
adds that a rebase orphaning a stamped baseline forces re-run of gates whose surface the delta hits.
Net: the extra cost is real but bounded and already governed; no ADR forbids the increased
frequency.

## Amendments applied

Both are additive; the original assertions are preserved in place and nothing was rewritten or
deleted, per `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`.

1. **`.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md`** — note beside the diff
   parenthetical recording that the finish-time step is not the only sanctioned mid-BUILD rebase.
   *This edits an artifact this feature does not own; it must be committed before the land gate
   evaluates this spec's own artifacts.*
2. **`.docs/stories/unhalt-after-main-advance-resumes-against-stale-fe.md` Story 7** — reframed as
   verification of inherited behavior rather than new implementation, plus a negative path pinning
   the `noop` / `conflict_halt` exclusion.

## ADRs examined and narrowed out

Examined and found to bind nothing in this change: `adr-2026-07-04-park-unpark-cli-verbs` (CLI verb
shape), `adr-2026-07-04-durable-pause-marker` (gates pickup, not in-flight work),
`adr-2026-08-06-honest-park-termination-boundary` (termination primitive),
`adr-2026-07-22-phase-scoped-docs-write-guard` (write-surface only; does not observe a git rebase),
`adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` (pre-commit gate),
`adr-2026-07-07-audit-trail-event-sink` (fixed record vocabulary; a base decision is not an audit
record), `adr-2026-08-08-pipeline-owned-closeout-timestamps` (affirms bus-first; no third ledger
added).

Narrowed out as fully superseded and therefore non-authoritative: `adr-013-daemon-main-advance-rekick`
(by `adr-2026-07-28-total-halt-classification-legacy-boundary`, though its carried-forward clauses
are cited above), `adr-2026-07-30-mergeability-first-integration-gate` (by
`adr-2026-07-30-finish-only-mergeability-gate`), `adr-2026-07-09-mid-run-merged-pr-guard` (by
`adr-2026-07-25-fail-closed-durable-shipment-evidence`; its guard placement inside
`resumeRebaseFirst` carries forward and covers the new entry for free).

Orthogonal, confirmed by reading: `adr-2026-07-22-origin-refresh-before-engine-rebuild`,
`adr-2026-07-03-daemon-auto-restart-stale-engine`, `.docs/plans/daemon-stale-engine-origin-advance.md`
— all concern the daemon's own engine checkout, not per-feature bases. The base-refresh stories
state the separation directly: "#598 = daemon running a stale **engine binary**; this = the **code
base** the build runs against. […] **kept separate**, cross-referenced." The engine-refresh path
runs only when `inFlight.size === 0`, so it cannot race a resume-time feature rebase.

## Verdict

**PASS — zero blocking conflicts.** One contradiction resolved by amendment; nine degrading
overlaps/constraints accepted and recorded, each with the assertion it constrains. No kickback to
`architecture` or `prd` is warranted: no finding stems from an incompatible design, and the one
genuine contradiction was a stale assumption in another feature's ADR rather than a defect in this
one.
