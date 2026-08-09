# Coherence: operator-audited reseal of a protected DECIDE artifact (#1281)

**Plan:** `no-operator-command-to-reseal-a-protected-decide-a`
**Track:** Technical
**Tier:** M

Intake-origin specification (`jstoup111/ai-conductor#1281`) with six committed desired-outcome
bullets, so the outcome row class is required. The technical track has no PRD, so there is no FR
row class and no PRD↔stories tie-out to perform.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-4 | covered | Re-fingerprinting named artifacts without hand-editing the seal JSON is delivered by the scoped head (story-2) driven by the `conduct reseal` verb (story-4). |
| outcome | outcome-2 | story-2, story-3 | covered | story-2 confines re-fingerprinting to enumerated paths and forbids adding or removing entries; story-3 refuses the whole operation on unlisted drift, which is what makes the scoping real rather than cosmetic. |
| outcome | outcome-3 | story-4, story-6 | covered | story-4 makes a non-empty rationale mandatory; story-6 requires the audit record to carry paths, per-path prior and new fingerprints, the verbatim reason, and the from/to commits, landing in the existing worktree audit trail. |
| outcome | outcome-4 | story-7 | covered | story-7 clears the halt only on a successful reseal whose halt classification is the protected-artifact one, and leaves unrelated halts intact. |
| outcome | outcome-5 |  | gap | outcome-5. Documentation outcome with no story and no task by deliberate skill-boundary design, not oversight; delivered by the wired gating `maintain-documentation` step. Waived in `.docs/coherence-waivers/no-operator-command-to-reseal-a-protected-decide-a.md`. |
| outcome | outcome-6 | story-5, story-8 | covered | story-5 makes reseal unreachable from a pipeline step by three independent mechanisms; story-8 asserts feature-authored edits still halt and that a violating build cannot launder its own violation. |
| story | story-1 | task-1, task-2 | covered | task-1 pins current rotation behavior; task-2 extracts the shared writer and delegates rotation to it. |
| story | story-2 | task-3, task-4, task-5 | covered | task-3 the scoped head, task-4 its refusals, task-5 the baseline advance and rebaselines entry. |
| story | story-3 | task-6, task-7 | covered | task-6 delegates drift classification to the existing routine including the amended self-amendment case; task-7 the all-or-nothing refusal. |
| story | story-4 | task-8, task-9, task-10 | covered | task-8 the pure parser including the mandatory rationale, task-9 the command declaration, task-10 the pre-boot dispatch. |
| story | story-5 | task-11, task-12 | covered | task-11 the interactivity gate behind an injectable seam; task-12 verifies the inferred non-interactive-subprocess assumption or replaces the layer. |
| story | story-6 | task-13, task-14, task-15, task-16, task-17 | covered | task-13 widens the audit origin, task-14 adds the union variants and sink declarations, task-15 records a performed reseal, task-16 records every refusal branch, task-17 renders both variants. |
| story | story-7 | task-18, task-19 | covered | task-18 the gated halt retirement, task-19 the cases where clearing is not warranted. |
| story | story-8 | task-20 | covered | task-20 proves existing violation detection is unweakened, cross-path isolation holds, and an in-step invocation is refused with the violation intact. |
| task | task-1 | story-1 | covered | Characterization test establishing the pre-extraction baseline the refactor must preserve. |
| task | task-2 | story-1 | covered | The extraction itself; rotation becomes a thin caller of the shared writer. |
| task | task-3 | story-2 | covered | Scoped head happy path. |
| task | task-4 | story-2 | covered | Scoped head refusals for unknown, non-protected, dirty, deleted, and unresolvable targets. |
| task | task-5 | story-2 | covered | Baseline advance and the rebaselines audit entry. |
| task | task-6 | story-3 | covered | Guard delegates to the existing classification routine rather than re-deriving drift. |
| task | task-7 | story-3 | covered | All-or-nothing refusal on genuine unlisted drift. |
| task | task-8 | story-4 | covered | Pure argument parser with no I/O. |
| task | task-9 | story-4 | covered | Command declaration so `--help` lists the verb. |
| task | task-10 | story-4 | covered | Pre-boot dispatch wiring. |
| task | task-11 | story-5 | covered | Interactivity gate with no bypass flag or environment override. |
| task | task-12 | story-5 | covered | Discharges the architecture review's Condition 1 by verifying or replacing the gate. |
| task | task-13 | story-6 | covered | Audit-record origin widening with no sentinel step name, plus the consumer sweep. |
| task | task-14 | story-6 | covered | Event union variants and sink declarations. |
| task | task-15 | story-6 | covered | Performed reseal reaches the existing audit trail. |
| task | task-16 | story-6 | covered | Every refusal branch records, including early returns. |
| task | task-17 | story-6 | covered | Daemon rendering for both variants. |
| task | task-18 | story-7 | covered | Gated halt retirement reusing the preserve-then-remove sequence. |
| task | task-19 | story-7 | covered | Non-clearing cases and partial-removal reporting. |
| task | task-20 | story-8 | covered | Boundary regression proof. |

## Consistency pass (§4d)

Every covered row was re-read for contradiction, with cross-layer pairs (outcome↔task,
outcome↔story) checked in both directions. Same-layer story-vs-story pairs are
`/conflict-check`'s sweep and were not re-reported here; that check passed with zero blocking
conflicts on 2026-08-09.

The pair most at risk of oscillation is **outcome-1 against outcome-2** — "an operator can
re-fingerprint named artifacts" versus "never a blanket reseal everything". Tested in both
directions: fully satisfying outcome-2 (scoping to enumerated paths, refusing on unlisted drift)
leaves outcome-1 intact, because the operator can still reseal exactly the artifacts they name;
fully satisfying outcome-1 leaves outcome-2 intact, because the mechanism that delivers it is
itself path-scoped. Two "yes" answers, so no oscillation.

The second pair checked was **outcome-3 against outcome-6** — recording an audit entry versus
reseal never being invocable by a daemon step. Satisfying outcome-6 through the interactivity gate
does not weaken outcome-3, because task-16 requires the refusal branches to record as well;
satisfying outcome-3 does not weaken outcome-6, because auditing an action does not make it
reachable. No contradiction.

**outcome-6 against outcome-4** was checked because halt clearing is the one place this feature
mutates state a daemon otherwise owns: task-19 makes clearing conditional on the reseal succeeding
and on the halt's own classification, so a clear can never fire on a halt this feature did not
resolve. No contradiction.

No `fail` rows. No amendment was required by this pass; the one amendment this DECIDE cycle
produced (story-3's self-amendment note) came from `/conflict-check` and is already recorded in
`.docs/conflicts/no-operator-command-to-reseal-a-protected-decide-a.md`.

## The single gap

`outcome-5` is the sole gap and is deliberate. Both the `stories` and `plan` skills forbid
authoring stories, acceptance criteria, or tasks for ordinary project documentation, so the
runbook rewrite and the CLI-reference update that outcome-5 names cannot have a counterpart id in
either artifact without violating those boundaries. Recording it as `covered` would require citing
a counterpart that does not exist, which §5 forbids outright.

It is not undelivered. `.ai-conductor/config.yml:114-119` wires `maintain-documentation` as a
`gating` step with `after: rebase` and a `completion_artifact`, so the build cannot reach finish
without it, and CLAUDE.md's Documentation Upkeep rule binds it to this feature's own PR. The
waiver at `.docs/coherence-waivers/no-operator-command-to-reseal-a-protected-decide-a.md` cites
`outcome-5` and records that reasoning.
