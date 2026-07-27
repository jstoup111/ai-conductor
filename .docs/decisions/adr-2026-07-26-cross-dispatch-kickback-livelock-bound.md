# ADR: The kickback bound is durable across dispatches and keyed on the tree, not the commit

**Date:** 2026-07-26
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #984), operator-confirmed
**Relates to:** `adr-2026-07-13-kickback-build-no-op-escalation.md` (#647 — makes its D2 guard
durable and fixes its progress witness), `adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`
(#817 — deliberately uses a *different* key; see Alternatives), `adr-2026-07-23-trailer-union-build-step-routing.md`
(#497-class worktree-loss precedent)
**Supersedes:** nothing. **Does not change:** `MAX_KICKBACKS_PER_GATE`'s value, any gate's PASS/FAIL
judgment, or completion derivation.

## Context

Issue #984. A feature looped `build → build_review → wiring_check → build` indefinitely on
2026-07-26, reaching an identical `wiring_check` failure each lap
(`formatDaemonActivityLine exported but referenced by no production code`) until an operator killed
the daemon by hand.

A bound for exactly this exists and did not engage. **Verified in the current tree (post-#983,
post-#986):**

1. **The cap is run-local.** `const kickbackCounts = new Map<StepName, number>()` is declared inside
   `Conductor.run()` (`conductor.ts:2319`). The daemon constructs a new `Conductor` for every
   dispatch — the only two production construction sites are `daemon-cli.ts:922` and `index.ts:1115`,
   reached per-feature via `daemon-runner.ts:366` inside the poll loop at `daemon.ts:1021`. `ConductState`
   carries no kickback field, so nothing rehydrates the map. The cap is enforced *within* one
   dispatch and resets across dispatches — precisely the boundary the loop crosses.

2. **The #647 D2 escalation has the identical defect.** `kickbackToBuildContext`
   (`conductor.ts:2359`) — D2's pre-kickback baseline — is also run-local. The guard that was built
   to catch no-op kickback cycles cannot see across the boundary where they actually occur.

3. **The progress witness is falsifiable by an empty commit.** `classifyBuildProgress`
   (`kickback-escalation.ts:35-41`) returns `'did-work'` when `headAfter !== headBefore`, sourced
   from `currentCommitSha` = `git rev-parse HEAD` (`project-prelude.ts:415`). An empty commit
   advances HEAD with a byte-identical tree, so it is scored as progress and *suppresses* the halt.
   The filer measured 284 empty commits across 4,624 non-merge commits (6.1%) in this repo, 65 of
   them arguing a check is wrong — one (`0c4515db`) minted during this very loop.

4. **`wiring_check` bypasses D2 entirely.** `checkKickbackToBuildEscalation` is called for
   `manual_test` (`:2444`), the validation-group gaps (`:3264`), `build_review` (`:4969`),
   `prd_audit` (`:5252`), and the generic tail (`:5411`). The `wiring_check` self-heal block
   (`:5069-5155`) increments `kickbackCounts` but neither captures nor checks, and `continue`s at
   `:5134` before the generic site can see it. The gate in the incident is the one gate D2 never
   guarded.

**Verified non-facts** (corrections that shaped this decision):
- There is **no** existing use of `git rev-parse HEAD^{tree}` or `git write-tree` anywhere in
  `src/`, `bin/`, or `hooks/`. This ADR introduces the first.
- `isZeroWorkStall` and `livelock` do not exist in the codebase; `detectZeroWorkProduct` is
  hard-disabled (`attribution-enforcement.ts:183-190`, `return false`).

## Decision

**Persist the kickback bound and D2's baseline into a per-feature `.pipeline/` ledger, key the
progress witness on the HEAD tree hash instead of the commit sha, and wire `wiring_check` into the
D2 capture/check pair like every other kickback gate.**

### D1 — Durable ledger (`.pipeline/kickback-ledger.json`)

A new module `engine/kickback-ledger.ts` owns:

```jsonc
{
  "version": 1,
  "gates": {
    "wiring_check": {
      "count": 2,                 // kickbacks consumed against `treeHash`
      "treeHash": "<40-hex>",     // HEAD^{tree} when this count was last incremented
      "lastReason": "…",          // diagnostics only — NEVER a comparison key (see D3)
      "priorVerdict": false,      // D2 baseline, migrated off the run-local map
      "resolvedBefore": 7
    }
  }
}
```

Conventions are taken verbatim from the two existing precedents:
- **Atomic write** — unique temp file in the same directory then `rename(2)`, per
  `task-evidence.ts:130-164`.
- **Tolerant read** — missing file → empty ledger; corrupt JSON → `console.warn` + empty;
  `version !== 1` → treated as absent. Never throws, per `task-evidence.ts:76-111`.
- **Lifecycle** — durable across dispatches, cleared only on a genuinely fresh feature session,
  mirroring `.pipeline/build-review-regrade.json` (`build-review-disposition.ts:107`) which is reset
  at `conductor.ts:2176-2180` under `isFreshFeatureSession = !state.run_started_at`
  (`conductor.ts:2166`).

`kickbackCounts` and `kickbackToBuildContext` are replaced by reads/writes against this ledger.
The four other run-local counters (`stuckGate`, `prdAuditSelfHeals`, `remediationRounds`,
`manualTestSelfHeals`) are explicitly **out of scope** — see Non-goals.

### D2 — Tree-hash progress witness

`classifyBuildProgress` compares tree hashes (`git rev-parse HEAD^{tree}`) rather than commit shas.
`resolvedBefore/resolvedAfter` comparison is retained unchanged as the second progress signal.
The existing null-handling stance is preserved: an unobservable tree folds into the conservative
`'no-work'` branch, exactly as the current code documents for a null head
(`kickback-escalation.ts:27-33`).

Consequence: an empty commit no longer masks a no-op cycle. A commit that changes real files still
scores `'did-work'` and grants a fresh budget.

### D3 — The bound is keyed on the tree ALONE, never on reason text

The issue's phrasing is "fails twice with the same reason". **That is not implementable as stated,
and implementing it literally would leave the bug unfixed.** Verified reason-stability:

| Gate | Reason source | Deterministic? |
|---|---|---|
| `wiring_check` | engine-computed gap messages from `wiring-evidence.json` | **Yes** |
| `build_review` | `buildReviewFailureDetails` → LLM grader prose (`artifacts.ts:1115-1124`) | No |
| `manual_test` | `readManualTestFailRows` → agent-authored markdown (`artifacts.ts:715-740`) | No |
| `test_suite` | sanitized raw runner output; embeds durations, temp paths, ordering | No |

Three of the four gates would never produce two byte-equal reasons, so a reason-keyed counter would
reset every lap and the livelock would survive the fix. Therefore:

- **Tree hash unchanged from the ledger entry AND the resolved-task count has not increased →
  increment `count`.**
- **Tree hash differs, OR the resolved-task count increased → reset `count` to 1 and store the new
  hash** (genuine progress earns a fresh budget — the issue's third desired outcome).

  The resolved-count clause is required for consistency with two neighbours that already treat a
  resolved-count increase as progress: `classifyBuildProgress` itself
  (`kickback-escalation.ts:39`) and the daemon's cross-dispatch re-kick eligibility
  (`daemon-cli.ts:472-479`, `isProgressReKickEligible`). Without it, a lap that resolves a task
  without moving the tree would be re-kicked as progress by the daemon while being counted as a
  no-op by this ledger — the two mechanisms would disagree about the same lap. Tree movement
  remains the *primary* witness; resolved-count is the secondary one, exactly as in the existing
  classifier.
- **`count > MAX_KICKBACKS_PER_GATE` → HALT** (D4).
- `lastReason` is recorded for the operator-facing HALT text only.

This also satisfies the negative path: a legitimately nondeterministic step still receives the full
`MAX_KICKBACKS_PER_GATE` laps over an unchanged tree, and any real tree movement restores a full
budget. The limit never collapses to zero.

### D4 — The cap HALT is classified and names gate + reason

The `build_review` (`conductor.ts:5029-5036`) and `wiring_check` (`:5137-5144`) cap HALTs currently
hand-roll `mkdir` + `writeFile` to `LOOP_HALT_MARKER`, skipping `writeHaltMarker` and writing no
`.pipeline/HALT.class` sidecar — so `readHaltClass` reports `'unclassified'`. Both move to
`writeHaltMarker(projectRoot, reason, 'needs-human')`, with `reason` naming the repeated gate, the
lap count, and `lastReason`.

This is load-bearing, not cosmetic. `daemon-rekick.ts:184-192` skips a `needs-human` halt on
**every** sweep, while `mechanical` and `unclassified` halts are cleared on base advance and
re-dispatched. So today's unclassified cap HALT is a fourth, independent mechanism sustaining the
observed loop: even once the cap trips, the sweep recycles it.

**Accepted trade-off.** Classifying `needs-human` deliberately gives up automatic recovery on base
advance for this one halt class. The alternative — keep `mechanical` and rely on the tree-keyed
ledger to grant a fresh budget after the rebase changes the tree — is also bounded (two laps per
distinct tree) and was seriously considered. It was rejected because the issue's primary outcome is
that the feature *stops* rather than being routed back, and because a gate that has already
exhausted its budget over an unchanged tree has demonstrated it cannot self-heal. The cost is that
a feature whose gate would have passed after an unrelated base advance now waits for an operator.
This is revisitable without reopening the rest of the design: it is a single argument to
`writeHaltMarker`.

### D5 — `wiring_check` joins the D2 pair

`captureKickbackToBuildContext('wiring_check')` before the `navigateBack` at `conductor.ts:5125`,
and `checkKickbackToBuildEscalation('wiring_check')` before the counter is consulted at `:5104` —
matching the ordering `build_review` already uses (`:4969` before `:4989`).

### D6 — Kill-switch

The existing `kickback_escalation.enabled` flag (`types/config.ts:301-311`, default `true`) also
gates D2's new tree-hash witness. Ledger persistence (D1) and the HALT classification (D4) are
fail-closed correctness and are **not** gated — matching #647's stance that D1 was ungated while D2
was toggleable.

## Alternatives considered

- **Reason-text equality as the bound key** (the issue's literal wording). Rejected on measured
  evidence — see D3. It would no-op for `build_review`, `manual_test`, and `test_suite`.
- **Reuse `GATE_SURFACE` + `partitionDelta` from ADR-2026-07-22 (#817).** Rejected: that mechanism
  answers "does this delta touch the gate's surface, so must the verdict be re-derived?" This ADR
  answers "did *anything* change, so has any progress occurred?" A build that touches only `.docs/`
  is not progress toward closing a wiring gap, but a surface-scoped delta would wrongly grant it a
  fresh budget. Different questions, correctly different keys. ADR-2026-07-22 rejected raw
  tree-hash equality for *its* question for the symmetric reason — coarseness discards benefit when
  *preserving* a verdict, and is the safe direction when *granting* a budget.
- **A process-global or daemon-scoped kickback cache.** Rejected: needs LRU/TTL eviction and can
  false-positive across unrelated features. The `.pipeline/` ledger is bounded by one feature's
  distinct gates and dies with the feature — no eviction policy at all. (Corroborates the filer's
  first hypothesis.)
- **A full progress-witness redesign replacing all six run-local counters** (the filer's third
  hypothesis, and approach B at explore time). Rejected as the wrong size for this defect: it
  redesigns a settled anti-ping-pong seam shared by every gate, with regression risk across all of
  them, when the filed outcomes are reachable by making already-reviewed machinery durable and
  tree-keyed. Recorded as possible future consolidation.
- **Committing the ledger to git so it survives worktree deletion.** Rejected: `.pipeline/` is
  gitignored by design (`.gitignore:4`) and a committed bound would mutate the feature branch on
  every lap, itself perturbing the tree hash the bound depends on.
- **Differentiating policy by `isEngineComputedStep`** (the filer's fourth hypothesis). Rejected as
  unnecessary here: #983 already gives those steps a retry budget of one *within* a dispatch, and
  the tree-hash key makes the cross-dispatch rule correct for deterministic and nondeterministic
  steps alike without branching on step kind.

## Consequences

- **Positive.** The incident class terminates within two laps instead of running until an operator
  kills the daemon. The bound survives re-dispatch, an empty commit can no longer launder a no-op
  lap as progress, `wiring_check` gains the D2 guard every peer gate already had, and the resulting
  HALT names the gate and its recurring reason. Detection stays fully mechanical — no LLM in the
  decision path, per the repo's Deterministic-where-possible principle.
- **Preserved invariants.** `MAX_KICKBACKS_PER_GATE` keeps its value; no gate's PASS/FAIL judgment
  changes; completion derivation is untouched; #983's within-dispatch retry budget is untouched;
  a genuine tree change always earns a fresh budget (fail-open).
- **Negative / watch.** Adds one `git rev-parse HEAD^{tree}` per kickback decision (cheap, and the
  path already shells out for `rev-parse HEAD`). Introduces the first tree-hash use in the
  codebase. A tree-identical-but-genuinely-different situation (e.g. an environment-only change)
  now consumes budget where an empty commit previously reset it — intended, and bounded by the
  fail-open reset on any real tree movement.
- **Known limitation (#497 class), accepted.** The ledger lives in gitignored `.pipeline/`, so
  deleting `.worktrees/<slug>` resets the bound. This fails *open* — a fresh budget, never a
  spurious halt — which is the correct direction for a guard whose bad outcome is halting real
  work. The durable alternative (branch-derived evidence, as the trailer union did for #497) is
  disproportionate here and is noted as follow-up.

## Non-goals (explicit)

- **No migration of `stuckGate`, `prdAuditSelfHeals`, `remediationRounds`, `manualTestSelfHeals`.**
  All four share the run-local defect (`conductor.ts:2330-2342`) but none is on the observed
  incident path. Migrating them together would turn a bounded fix into a rewrite of the tail's
  control flow. Recorded here so the remaining exposure is documented, not silently dropped.
- **No change to `MAX_KICKBACKS_PER_GATE`'s value, and it does not become configurable.**
- **No change to any gate's PASS/FAIL judgment**, to completion derivation (`autoheal.ts`,
  `artifacts.ts`), or to #983's `isEngineComputedStep` retry budget.
- **No generic `.pipeline/` backfill-on-worktree-recreate** — that is the #497 class and belongs to
  its own intake.
- **No blocking of empty commits.** This ADR stops an empty commit from *counting as progress*; it
  does not police whether one may be made.
