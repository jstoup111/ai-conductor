# Conflict Check: Monitor daemon HALTs through a guided resolution queue

Date: 2026-09-20
Source: jstoup111/ai-conductor#1228
ADR corpus scope: `repo_wide` (per `.ai-conductor/config.yml` `conflict_check.adr_corpus`)
Result: **PASS** — zero blocking conflicts remain. One blocking oscillation and one degrading
ambiguity were found and resolved before this report was finalised.

## Scope examined

- 19 stories in `.docs/stories/monitor-daemon-halts-through-a-guided-resolution-q.md`, checked
  pairwise in both directions for all six conflict types.
- Existing story files in `.docs/stories/` whose subject overlaps halts, daemon state, or operator
  queues — in particular `daemon-event-driven-wake-for-parked-halted-feature.md` and
  `no-daemon-level-metrics-queue-depth-halts-and-gate.md`.
- The ADR corpus at `repo_wide` scope: **323 ADRs enumerated**, **8 excluded** as unambiguously
  fully superseded, **315 retained**, **34 narrowed in** as subject-overlapping and their
  `## Decision` sections read.

### Excluded as fully superseded (8)

`adr-2026-07-03-gated-writeback-announcements`, `adr-2026-07-21-completeness-as-build-review-rubric`,
`adr-2026-07-30-finish-only-mergeability-gate`,
`adr-2026-08-12-removal-anchored-tautology-exemption`,
`adr-2026-08-15-verify-only-anchored-tautology-exemption`,
`adr-2026-08-16-preservation-anchored-completeness-exemption`,
`adr-2026-08-29-build-review-remediate-case-adjudication`,
`adr-2026-08-29-operator-authorized-kickback-budget-recovery`.

Retained despite supersession wording, because each names only a narrow replaced clause and its
remaining decisions could still bind: `adr-2026-07-04-operator-park-marker`,
`adr-2026-07-12-wiring-check-gate`, `adr-2026-07-25-content-addressed-full-suite-proof`.

### Narrowed in (34)

`adr-005-non-autonomy-and-read-only-governor`,
`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`,
`adr-2026-06-30-self-host-detection-seam`, `adr-2026-07-01-machine-scoped-operator-identity`,
`adr-2026-07-03-priority-fetch-fail-soft`, `adr-2026-07-03-priority-from-linked-issue-labels`,
`adr-2026-07-04-durable-pause-marker`, `adr-2026-07-04-operator-park-marker`,
`adr-2026-07-04-park-unpark-cli-verbs`, `adr-2026-07-05-daemon-rate-limit-episode-coordinator`,
`adr-2026-07-08-halt-issue-closure-sweep`, `adr-2026-07-10-intake-claim-priority-banding`,
`adr-2026-07-10-park-marker-main-root-resolution`, `adr-2026-07-13-park-all-dispatch-paths`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-2026-07-27-cold-start-within-step-retries`,
`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`,
`adr-2026-07-29-operator-park-scheduling-unit-boundary`,
`adr-2026-08-01-multi-proof-park-deletion-authority`,
`adr-2026-08-05-blocked-is-a-distinct-state-from-halted`,
`adr-2026-08-06-honest-park-termination-boundary`,
`adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`,
`adr-2026-08-09-worktree-local-provider-scratch`, `adr-2026-08-11-halt-events-ride-the-persisted-spine`,
`adr-2026-08-17-structural-live-checkout-containment`,
`adr-2026-08-19-live-provider-stream-observation`, `adr-2026-08-23-committed-halt-record`,
`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`,
`adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`,
`adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot`,
`adr-2026-09-11-github-operation-ownership`, plus the two ADRs authored for this feature.

### Narrowed out (thematic)

The remaining ~280 ADRs cluster into BUILD/SHIP pipeline internals (rubrics, kickback ledgers,
coverage and test-quality gates), rebase and evidence-attribution machinery, protected-artifact
seals, intake and dependency-claim mechanics unrelated to priority ordering, release and
version-gate mechanics, memory-provider architecture, the original workflow DSL ADRs, provider
auth and readiness plumbing that does not touch session policy, and per-feature cost accounting.
None governs a foreground operator queue, halt-marker-derived membership, or an operator-launched
session.

## Conflict: Priority ordering and deferral re-offer are mutually exclusive

**Stories involved:** Story 9 (Higher-priority halts are offered first) vs Story 16 (Skipping defers
an item rather than resolving or dropping it)
**Files:** `.docs/stories/monitor-daemon-halts-through-a-guided-resolution-q.md` (both)
**Type:** oscillating
**Severity:** blocking
**Status:** RESOLVED

**Description:**
Story 9 asserted that a higher-priority halt is offered before a lower-priority one, without
qualification. Story 16 asserted that a deferred item is not offered ahead of work the operator has
not yet seen. Tested in both directions: if Story 9 is fully satisfied, a deferred critical halt
sorts ahead of an unseen low-priority one and Story 16 fails; if Story 16 is fully satisfied, that
critical halt sits behind the unseen low-priority one and Story 9 fails. Two failures, so this is an
oscillation rather than an ordinary contradiction — no implementation satisfies both, and each
"fix" re-breaks the other.

The root lives upstream of story phrasing: PRD FR-9 and FR-21 each stated a rule and neither stated
its precedence against the other.

**Resolution Options:**
1. Deferral partitions ahead of priority — unseen work first ordered by band, then deferred work
   ordered by band.
2. Priority outranks deferral — a deferred critical halt returns ahead of an unseen low one.
3. A deferral expires after a fixed number of passes and then rejoins strict band order.

**Recommendation:** Option 1, because it makes skip mean something the operator can rely on. Under
option 2 a deferred high-priority item returns immediately, which is the behavior FR-21 explicitly
ruled out ("not immediately re-offered"). Option 3 adds a tuning parameter with no evidence for a
good value.

**Applied:** Option 1. FR-9 carries an additive amendment note recording the precedence and why the
two requirements were mutually exclusive as originally written; the original FR text is preserved.
Story 9 and Story 16 had their superseded assertions replaced in place, per the story-artifact
exception. Plan task 7 implements the partition and task 15 depends on it.

## Conflict: "Offered once" read as permanence

**Stories involved:** Story 5 (A halt is never duplicated in the queue) vs Story 16 (Skipping defers
an item rather than resolving or dropping it)
**Files:** `.docs/stories/monitor-daemon-halts-through-a-guided-resolution-q.md` (both)
**Type:** contradiction
**Severity:** degrading
**Status:** RESOLVED

**Description:**
Story 5's title and narrative read "each halt is offered once", which taken literally forbids the
re-offer Story 16 requires. The acceptance criteria were already scoped correctly — to concurrent
duplicate entries, not to permanence — so this was a phrasing defect rather than a design one, and
it was resolved in the stories per §5c.

**Applied:** Story 5's title and narrative now say the halt is never duplicated, and state
explicitly that a deferred halt is deliberately offered again per Story 16.

## ADR-versus-story result

**Zero grounded conflicts.** No ADR sentence and story sentence pair met the bar of both opposing
sentences being quotable verbatim. The two ADRs authored for this feature each carry a governing
decisions and reuse check citing the same precedent ADRs the sweep independently identified, and
state that each is reused rather than contradicted.

Two apparent tensions were examined and found not to be conflicts:

- **`adr-011` decision 5 ("The harness supervises no always-on process").** That decision governs
  what the harness supervises. This monitor is a foreground process the operator starts and stops,
  with no pidfile, no supervision, no restart, and no daemon dependency on it. The existing
  follow-mode log command is the precedent for the same shape.
- **`adr-2026-07-10-event-driven-halt-clear-wake`** establishes a watch seam whose stories state the
  watch is never the authority — the marker check is. That is the same principle this feature's
  ADR applies in deriving membership from markers, so it corroborates rather than conflicts.

## Recorded assumption (not a conflict)

`adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` decision 3 describes the
*adapter's* interactive path for one provider as a bounded one-shot with a piped prompt, whereas
Story 14 needs a multi-turn session with per-action approval. This is not a grounded conflict,
because `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority` D3 bypasses the
adapter entirely, so the adapter's one-shot form is not the form the launch seam uses. What is not
yet pinned anywhere is *which* native interactive invocation form that provider's launch uses.
Confidence that a suitable form exists: moderate (~70%, inferred), and it is already covered by
architecture-review condition C2, which requires the seam to be proven against both providers before
the feature is considered delivered. Recorded here so BUILD treats it as a known unknown rather than
discovering it late.
