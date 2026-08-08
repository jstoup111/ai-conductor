# Conflict Check: Project teardown hook before worktree removal

**Date:** 2026-08-07
**Tier:** Medium
**Stories checked:** `.docs/stories/bin-teardown-run-a-project-supplied-teardown-hook-.md`
(Stories 1–11) against the accepted stories corpus in `.docs/stories/`, the APPROVED ADRs in
`.docs/decisions/`, `CLAUDE.md`, and current engine behavior at HEAD `1fd6a9a97`.

**Verdict: PASSED CLEAN — 0 blocking, 0 degrading.**

All five conflict types were checked. Four candidates were investigated specifically because they
looked plausible; each was examined against the actual text or code rather than dismissed by
category. Findings below record the evidence, since a pair reasoned through and cleared is a
different result from a pair never examined.

---

## Candidates investigated and cleared

### C1 — New config key vs. the v1.0 config-key teardown *(the most likely candidate; cleared)*

**Type checked:** contradiction / resource contention
**Verdict:** **not a conflict.** Confidence 93% (basis: verified — read the shipped stories).

This feature adds a new top-level config key, `teardown_timeout_seconds`, while
`v1-0-self-host-config-key-teardown` shipped on 2026-07-31 (PR #1211) as a config-key *removal*
effort. The apparent collision is superficial and resolves in two independent ways.

- **Different surface.** That work retires **obsolete self-host cutover residue** —
  `owner_gate_cutover`, `attribution_enforcement_cutover`, `attribution_judge_cutover` — inside the
  repo-local `harness_self_host` block and its siblings. It is not a freeze on the configuration
  surface, and it does not establish a policy against new keys.
- **Its own accepted criterion states the governing rule.** The shipped story keeps
  `attribution_audit_sample_pct` explicitly *because telemetry still consumes it*, and removes the
  cutover keys explicitly *because they "have no production consumers."* The operative test is
  therefore **live consumer, not key count**. `teardown_timeout_seconds` has a live consumer from
  the moment it lands (the bound applied to every teardown invocation), so it satisfies that rule
  rather than contradicting it.
- **The name collision is coincidental.** "Config-key teardown" there means *removing config keys*;
  "teardown" here means *releasing provisioned resources*. The two share a word and nothing else.
  Noted so a future reader scanning filenames does not infer a relationship that does not exist.

**Residual advisory (not a conflict):** that story's final criterion says
`harness_self_host.version_freeze` is removed by the v1.0 cutover (#226), not earlier. This feature
touches neither key and does not interact with the cutover.

### C2 — Unmerged branch overlap on the removal call sites and the setup seam

**Type checked:** resource contention (concurrent edits to the same code)
**Verdict:** **not a conflict.** Confidence 90% (basis: verified — diffed the branch).

The advisory `overlap-scan` run during architecture review returned a large set, but it does not
distinguish merged history from live work. Re-checked by testing each `origin/spec/*` branch for
ancestry in `origin/main` and diffing only the genuinely unmerged ones:

| Path | Unmerged branches touching it |
| --- | --- |
| `worktree-prepare.ts` | **none** — the setup/teardown seam is uncontested |
| `park-reconciliation.ts` | none |
| `daemon-park-cli.ts` | none |
| `mergeable-sweep.ts` | none |
| `daemon-deps.ts` | `origin/spec/daemon-self-host-guardrails` |
| `resolved-config.ts` | `origin/spec/daemon-self-host-guardrails` |

That branch's last commit is **2026-07-01** — stale relative to this work. Its `daemon-deps.ts`
changes are confined to `isHalted` and `readWorktreeOutcome`, swapping a literal `.pipeline/HALT`
for a `HALT_MARKER` constant; it does **not** touch `teardownWorktree`. Its `resolved-config.ts`
changes add the `harness_self_host` resolution block, a different region from the top-level
`*_timeout_*` resolvers this feature extends.

No semantic conflict. A textual merge may need attention in `resolved-config.ts` if both land, which
is ordinary rebase work, not a story-level contradiction.

### C3 — Teardown failure handling vs. the setup-triage machinery

**Type checked:** contradiction / state conflict
**Verdict:** **not a conflict — and the asymmetry is deliberate.** Confidence 88% (basis:
verified for the code path, inferred for intent).

`setup-before-dispatch-wedge-deterministic-setup-fa` and
`setup-triage-must-not-report-setup-failed-park-whe` both build on `bin/setup` failure being a
**thrown `SetupFailureError`** that the daemon runner catches, routes to triage, and may convert
into a park or a quarantine. A reader could reasonably expect the new sibling to inherit that
behavior.

It does not, by design. `runProjectTeardown` never throws (Story 7, and
`adr-2026-08-07-project-teardown-hook-contract-and-containment` §Decision.4), so a teardown failure
is structurally incapable of entering the triage path, producing a park, or being reported as a
setup failure. The two mechanisms cannot interact.

The asymmetry is justified by *when* each runs: setup failure means the worktree is unfit to build
in, so refusing to proceed is correct. Teardown runs when the worktree is already finished and
being deleted — there is no downstream work to protect, and blocking would only strand the
worktree. Recorded here rather than left implicit, because "setup throws, teardown does not" is the
kind of inconsistency a later reader may try to "fix" without knowing it was chosen.

### C4 — Story 4 (retained worktrees are never torn down) vs. retention semantics

**Type checked:** contradiction / state conflict / sequencing
**Verdict:** **not a conflict — mutually reinforcing.** Confidence 92% (basis: verified).

`worktree-with-no-conduct-state-is-retained-as-pr-o` (#1329) and
`park-in-flight-features-at-step-boundaries-after-p` both concern retained worktrees. Checked
whether either asserts cleanup-on-retain, which Story 4 would contradict.

Neither does. #1329's accepted stories are entirely about **classification and reporting** — which
bucket a worktree lands in on the dashboard, whether a stated reason matches reality, and whether a
slug is excluded from dispatch. No accepted story anywhere asserts that a retained worktree's
resources are released. Story 4 asserts the opposite of release (teardown must not run when
`keep === true`), which *supports* the retention model those stories depend on: a retained worktree
exists so a human can resume in it, and resuming requires its provisioned resources intact.

### C5 — Story 2 (namespace survives a missing `.pipeline/`) vs. `CLAUDE.md` operations rule 3

**Type checked:** contradiction
**Verdict:** **not a conflict — Story 2 is a direct consequence of the rule.** Confidence 95%.

`CLAUDE.md`'s Daemon Operations Safety rule 3 states the branch is the source of truth and a
worktree checkout is disposable, and warns that removing `.worktrees/<slug>` loses the
per-worktree `.pipeline/` state. Story 2 asserts teardown still derives the correct namespace with
`.pipeline/` (and `.env`) deleted.

These agree. The rule is precisely why the design refuses a marker file or ledger: any teardown
keyed on prepare-time state would silently skip exactly the recovery scenario rule 3 describes.
Deriving the namespace from the worktree path — a pure function — is what makes the feature
correct under that rule rather than in tension with it.

---

## Full conflict-type sweep

| Type | Result |
| --- | --- |
| **Contradiction** | None. Stories 1–11 are internally consistent; the only near-opposition is Story 1 (teardown runs) vs. Story 4 (teardown must not run), which are disjoint by the `keep` flag and are the two halves of one contract, asserted together in Story 4's happy path. |
| **Behavioral overlap** | Stories 1, 5, and 6 each cover a different removal path invoking the same runner. This is intended coverage of FR-5's three sites, not incompatible modification: the runner's behavior is identical and each story asserts its own path's outcome preservation. No path asserts different teardown semantics from another. |
| **State conflict** | None. The feature introduces no persisted state (Story 2), so no combined story pair can produce an ambiguous stored state. The only state transition is worktree existence, which every story drives to the same terminal value on its own path. |
| **Resource contention** | Checked at three levels: the config key (C1), concurrent branch edits (C2), and the shared `worktree-shared.removeWorktree` helper. The helper is the one genuine contention point — it serves both an in-scope caller (`daemon-park-cli`) and an operator-excluded one (`engineer/worktree-authoring`). It is resolved in `adr-2026-08-07-worktree-removal-coverage-guard` by keying enforcement on the calling module rather than the helper, and Story 11 asserts the helper's exempt entry. No unresolved contention. |
| **Sequencing** | None. Story 1 asserts teardown strictly precedes removal, Story 4 asserts it is gated behind the `keep` early return, and Story 6 asserts a single invitation before a two-branch removal. These form a total order with no cycle and no story assuming it runs first relative to another. |

## Accepted degrading conflicts

None.

## Resolutions applied

None required. No story text was amended, no ADR was superseded.

## Recurring patterns

`.docs/conflicts/` was reviewed for prior reports covering the worktree lifecycle. Nothing
recurring applies to this feature.
