# Conflict Check: Off-tag checkout reports up to date forever (#1437)

**Date:** 2026-08-09
**Stories checked:** `.docs/stories/off-tag-checkout-reports-up-to-date-forever-tagged.md` (10)
**Also scanned:** every file in `.docs/stories/`, with focused adjudication against
`update-check-config-single-source-of-truth` (#1400) — the only other spec touching these files
**Result:** PASSED — 1 blocking conflict found, resolved by operator selection and amended into
the accepted artifacts; 0 blocking conflicts remain; 0 degrading conflicts accepted

Every pair sharing a behavior, file, gate, or field was tested in **both** directions ("if A is
fully satisfied, does B still hold?"). Claims below are labelled `verified` (executed or read
directly) or `inferred`, per the `verify-claims` protocol.

---

## Conflict 1: The recorded version cannot be both absent and repaired for the same checkout

**Stories involved:** Story 5 (a checkout with no reachable release tag declines to guess) vs
Story 8 (the recorded version is written but never consulted)
**Files:** both in `.docs/stories/off-tag-checkout-reports-up-to-date-forever-tagged.md`
**Type:** contradiction
**Severity:** blocking
**Status:** RESOLVED

### Description

Story 5's "Done When" required `test/test_bin_update.sh:355` to be retained unchanged. That
assertion is:

```bash
assert "unknown tagged identity does not record the latest tag" \
  "$([ -z "$(cfg_get "$HOME_DIR" currentVersion)" ] && echo 0 || echo 1)"
```

It demands an **empty** `currentVersion` for the `i17-unknown-identity` fixture. Story 8 requires
that any **determinable** identity persists its baseline.

The two collide because that fixture is determinable under the new rule. **Verified by
rebuilding the fixture and executing the resolution commands** (100% confidence): `make_repo`
tags the first commit `v0.3.0`, then a "between releases" commit is added, then `v0.4.0` is
tagged on a descendant, then HEAD is detached at the between-releases commit. At that HEAD:

```
git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname | head -1   ->  v0.3.0
git rev-list --count v0.3.0..HEAD                               ->  1
```

Baseline `v0.3.0`, distance 1 — kind `post-release`, which Story 8 says must persist `v0.3.0`.
`currentVersion` is then non-empty and `:355` fails.

Direction check, both ways: fully satisfying Story 8 makes `:355` fail, so Story 5's "Done When"
does not hold. Fully satisfying Story 5's "Done When" requires skipping persistence on
post-release checkouts, so Story 8's first happy-path criterion does not hold. Two "no" answers
— but this is classified **contradiction** rather than oscillation, because the incompatibility
is a single stale assertion attached to the wrong fixture, not a pair of requirements with no
common implementation.

### Resolution Options

1. **Move the emptiness assertion to the new no-reachable-tag fixture**, and assert on the
   between-releases fixture that `currentVersion == v0.3.0` and `!= v0.4.0`.
2. **Persist only on exact-tag checkouts**, leaving `:355` literally untouched.
3. **Stop persisting entirely**, making the record vestigial.

### Recommendation and selection

**Option 1**, selected by the operator.

Option 1 preserves the assertion's stated intent exactly — its own name is "does not record the
latest tag", and asserting `!= v0.4.0` tests that directly, where the emptiness check only tested
it incidentally through the old resolution order. The emptiness assertion is not lost; it moves
to the fixture where an absent record is genuinely correct, which is also the fixture that gives
desired outcome 4 its first real test.

Option 2 was rejected because it surrenders one of the two reasons the record is written at all:
a drifted install would stop refreshing its record, so #1400's legacy-to-block seed could still
make a wrong value permanent — the exact failure
`adr-2026-08-09-checkout-is-sole-version-identity-authority` exists to prevent. Option 3 was
rejected because `bin/migrate:98,330` consumes `currentVersion` as its `FROM_VERSION` lower
bound; emptying it permanently would change migration ranges.

### Amendments applied (additive, originals preserved)

| Artifact | Amendment |
| --- | --- |
| `.docs/decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` | Note beside the test-change table correcting the `:355` row and recording the empirical evidence |
| `.docs/stories/…-tagged.md` Story 5 "Done When" | Note superseding the "retained unchanged" checkbox, plus two replacement checkboxes |

No ADR was superseded — the correction is consistent with both ADRs' decisions and changes only
which fixture carries an assertion.

---

## Adjudicated and cleared

### #1400 / #1412 — same four files, no requirements conflict

**Type considered:** resource contention · **Verdict:** overlap only, not a conflict

`.docs/plans/update-check-config-single-source-of-truth.md` touches `bin/update`, `bin/conduct`,
`bin/lib/harness-common.sh`, and `bin/install` — all four of ours. Three checks were run rather
than assumed:

- **Accessor signatures.** That plan states `conductor_cfg_get`/`conductor_cfg_set` "keep their
  existing two-argument signatures — so none of the ten call sites in `bin/update` and
  `bin/conduct` change" (verified by reading the plan). Our stories only ever *write* through
  `conductor_cfg_set`, so the preserved signature covers our usage completely.
- **The new integrity check.** It fails closed on "any reference to the legacy path under `bin/`
  outside the seed" (verified, plan `:49-50`, `:314-322`). Nothing in our ten stories requires
  referencing `~/.claude/ai-conductor.config.json` directly — persistence goes through the
  accessor. **No conflict, with a caveat carried to the plan:** an implementation that hardcoded
  the legacy path would trip that check, so the plan must specify accessor-only persistence.
- **Semantic independence.** Our design never *reads* the record to decide anything, so it is
  indifferent to which store holds it. Satisfying #1400 fully leaves every one of our stories
  satisfiable, and vice versa — both directions clear.

What remains is a **textual merge overlap**: whoever merges second resolves conflicting hunks in
the same four files. That is a sequencing cost, not a requirements contradiction. Recorded as
condition C5 in the architecture review so `/plan` states it rather than discovering it.

> Operational note: a mass park on 2026-08-10 cleared the daemon slot specifically to land the
> update-check-config feature, so #1400 is very likely to merge **first**. This spec should
> expect to be the one rebasing.

### #1005 — contract rewrite is recorded, not an unrecorded oscillation

**Type considered:** oscillating · **Verdict:** not an oscillation

Story 5 does change behavior established by shipped work (#1005). It is not an oscillation
because the change is **recorded in an APPROVED ADR**
(`adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`) that states the old trigger, the new
trigger, the falsifying evidence, and the exact assertions affected. An oscillation is a pair of
live requirements with no common implementation; here the old requirement is explicitly retired
by a decision record, so exactly one requirement is live. Desired outcome 4 remains satisfied —
the refusal to guess is preserved and gains its first genuine test.

### #226 — ordering dependency, not a conflict

**Type considered:** sequencing · **Verdict:** neither a conflict nor a dependency that blocks

Story 10 requires updating `bin/conduct`'s duplicate, which #226 will eventually delete.
Working on soon-to-be-deleted code is not a contradiction: until #226 lands, that duplicate is a
live entry point carrying the same defect, and leaving it stale would relocate the bug rather
than fix it. Story 10's requirement that both copies delegate to the shared resolver actively
*reduces* #226's future work, from deleting logic that must be re-verified to deleting a call
site. No ordering constraint is created in either direction.

### Internal coherence — Stories 2, 6, 7, 8

**Type considered:** contradiction, state conflict · **Verdict:** clean, all directions checked

- **Story 6 (always print) vs its own carve-outs.** No contradiction: Story 6 scopes its
  requirement to invocations that *reach a decision*. `autoCheck=false` and a non-git directory
  both return before any decision, so nothing is printed because nothing was decided. The
  criteria are consistent as written.
- **Story 6 vs Story 5.** An undeterminable identity still prints an identity line naming itself
  unverifiable, so "always print" holds on the one path that produces no version. Verified
  consistent with Story 5's happy path.
- **Story 6 vs Story 7.** Both require exactly one identity line; they are mutually exclusive by
  channel, since `dispatch_update_channel` (`bin/update:236-243`) routes to exactly one of the
  two functions per invocation. No path emits both.
- **Story 2 vs Story 8.** Story 2 requires `lastCheckedAt` still stamped on the drift path;
  Story 8 governs `currentVersion`. Different fields, no contention.
- **Story 2 vs Story 6.** Story 2's "output is non-empty" is satisfied by, and stricter than,
  Story 6's identity line. Compatible.
- **Story 8's alternate-branch criterion** explicitly covers the invariant-side-effect risk
  (a branch returning early and skipping persistence), so no path is left unspecified.

### Story 4 vs Story 1 — verified empirically, no conflict

**Type considered:** contradiction · **Verdict:** clean (this was the highest-risk pair)

Story 4 promises the existing `#1005` assertions pass unchanged; Story 1 defines baseline as the
**highest reachable** tag. Rather than reasoning from story text, both fixtures were rebuilt and
the resolution commands executed (100% confidence):

| Fixture | Reconstructed HEAD | baseline | distance | Resulting decision | Assertion |
| --- | --- | --- | --- | --- | --- |
| `i17-installed-tag` (`:321-339`) | detached at the `v0.3.0` commit, `v0.4.0` a descendant | `v0.3.0` | 0 | release, offer `v0.3.0 → v0.4.0`, persist `v0.3.0` | passes unchanged |
| `i17-recorded-tag` (`:357-369`) | detached between releases | `v0.3.0` | 1 | post-release, offer `v0.3.0 → v0.4.0` | passes unchanged |

`v0.4.0` is a *descendant* in both fixtures, so `--merged HEAD` correctly excludes it and the
highest-reachable rule returns the same tag the old exact-match/record path did.

**One constraint this makes load-bearing, carried to the plan:** the update-available line must
render the **baseline** (`v0.3.0 → v0.4.0`), not the display identity (`v0.3.0+1 → v0.4.0`), or
the `i17-recorded-tag` assertion's `*"v0.3.0 → v0.4.0"*` glob stops matching. Story 3's "Done
When" already requires the offer text to name the baseline, so the stories are consistent — but
the plan must not let an implementer substitute the display form here.

### Story 8 vs bin/migrate — verified, no conflict

**Type considered:** resource contention · **Verdict:** clean

Every consumer of `currentVersion` was read rather than assumed:

| Site | Use | Effect of persisting the baseline |
| --- | --- | --- |
| `bin/migrate:98` | `FROM_VERSION=$(read_from_version)` | unchanged — a bare `vX.Y.Z` is what it expects |
| `bin/migrate:330` | regex `^v?[0-9]+(\.[0-9]+)+$` gates the first-run baseline | **passes** with `v0.3.0`; would **fail** with `v0.3.0+1` and silently fall through to the `main@«sha»` branch, using `TO_VERSION` as its own baseline and skipping intervening migration blocks |
| `bin/migrate:101,552-576` | display only | unchanged |
| `bin/migrate:453` | applied-ledger reachability | unchanged — keyed on block identity, not on `currentVersion` |
| `bin/install:936,957` | writes the detected version | Story 9 routes this through the same resolver, so both writers agree |

This confirms the baseline-not-display rule is not merely preferable but **required**: the
display form would silently change migration behavior. Story 8 already encodes it as an explicit
negative-path criterion.

---

## Summary

| Check | Result |
| --- | --- |
| Contradiction | 1 found (Story 5 vs Story 8), resolved |
| Behavioral overlap | none |
| State conflict | none |
| Resource contention | none — `bin/migrate` and #1400 both cleared by direct reading |
| Sequencing | none — #226 is neither blocking nor blocked |
| Oscillating | none — the #1005 change is retired by an APPROVED ADR, leaving one live requirement |

**Blocking conflicts remaining: 0.** Cleared to proceed to `/plan`.

Two constraints are carried forward for the plan to state explicitly, both discovered here:

1. Persistence must go through `conductor_cfg_set`, never the legacy path directly, or #1400's
   new integrity check fails.
2. The update-available line must render the baseline, not the `«tag»+N` display identity.
