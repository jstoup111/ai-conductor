# Implementation Plan: Off-tag checkout reports up to date forever (#1437)

**Date:** 2026-08-09
**Stem:** off-tag-checkout-reports-up-to-date-forever-tagged
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/off-tag-checkout-reports-up-to-date-forever-tagged.md
**Conflict check:** .docs/conflicts/off-tag-checkout-reports-up-to-date-forever-tagged.md
**Complexity:** .docs/complexity/off-tag-checkout-reports-up-to-date-forever-tagged.md
**Design:** .docs/architecture/off-tag-checkout-reports-up-to-date-forever-tagged.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-09-off-tag-checkout-1437.md
**ADR:** .docs/decisions/adr-2026-08-09-checkout-is-sole-version-identity-authority.md
**ADR:** .docs/decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md

## Summary

Replace the update check's two-branch version-identity resolution with one resolver that derives
identity from the checkout on every run, so an install that has advanced past its recorded
release can never silently report itself current. 15 tasks: 2 for the resolver, 6 for the tagged
channel, 1 for the main channel, 2 for the `bin/conduct` mirror, 1 for the installer, 2 for the
test-contract rewrite, 1 for the release waiver.

## Technical Approach

**The defect.** `check_harness_update_tagged` (`bin/update:126-180`) resolves identity as "exact
checked-out tag, else the recorded `currentVersion`". Nothing re-checks that record against the
checkout. When HEAD has advanced past the recorded tag and that tag equals the newest tag,
`semver_lt` is false and the function returns after stamping `lastCheckedAt` — printing nothing.
Reproduced: zero output, exit 0.

**The resolver.** One new bash function, `resolve_harness_identity`, in
`bin/lib/harness-common.sh` — the file both `bin/update` and `bin/conduct` already source. It
computes:

```
baseline = git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname | head -1
distance = git rev-list --count <baseline>..HEAD
```

yielding three exhaustive, mutually exclusive kinds: `release` (distance 0), `post-release`
(distance N > 0, displayed `«tag»+N`), and `undeterminable` (no baseline, or git failure).
`git describe` is deliberately **not** used — it returns the nearest ancestor tag rather than the
highest reachable one, and its default `--candidates=10` is already exceeded by the live
checkout's 22 reachable tags.

**Three rules that are load-bearing and easy to get wrong.** Each was discovered by direct
verification during DECIDE, and each silently breaks something if violated:

1. **Persist the baseline, never the display form.** `bin/migrate:330` gates `FROM_VERSION` on
   `^v?[0-9]+(\.[0-9]+)+$`. A value like `v0.3.0+1` fails that regex, falls into the
   `main@«sha»` branch, and **silently skips every migration block in between**. Persist
   `v0.3.0`.
2. **Persist through `conductor_cfg_set` only.** Never touch
   `~/.claude/ai-conductor.config.json` directly. #1400 adds an integrity check that fails
   closed on any legacy-path reference under `bin/` outside its seed.
3. **The update-available line renders the baseline.** `warn "Harness update available:
   «baseline» → «latest»"`, not `«tag»+N → «latest»`. The existing `i17-recorded-tag` assertion
   globs on `*"v0.3.0 → v0.4.0"*` and stops matching otherwise. The identity line is a
   *separate* line and carries the `+N` form.

**Sequencing.** The resolver lands first and inert (Tasks 1-2), then the tagged channel is
rewritten around it (Tasks 3-7), then the main channel (Task 8), then the `bin/conduct` mirror
plus its parity guard (Tasks 9-10), then the installer (Task 11), then the test-contract rewrite
(Tasks 12-13), then the release waiver (Task 14). Tasks 3-7.1 all edit the same function and are
strictly ordered.

**#1400 / #1412 overlap — textual, not a design problem.**
`.docs/plans/update-check-config-single-source-of-truth.md` touches all four of the same files
(`bin/update`, `bin/conduct`, `bin/lib/harness-common.sh`, `bin/install`). The conflict check
adjudicated this as a **merge overlap, not a requirements conflict**: that plan preserves the
two-argument accessor signatures this plan writes through, and this plan never *reads* the record
to decide anything, so it is indifferent to which store holds it. A mass park on 2026-08-10
cleared the daemon slot specifically to land #1400 first, so **this feature should expect to
rebase onto it**. Conflicting hunks are resolved textually; do not treat a conflict here as a
design question or kick back to architecture.

**Documentation.** This change alters user-visible output on both channels and narrows
`currentVersion` from authority to cache, so `docs/reference/cli.md` and
`docs/reference/configuration.md` are affected. Per this repository's `maintain-documentation`
custom step, documentation is delivered by that step rather than by plan tasks — no task below
writes documentation.

## Prerequisites

- Accepted stories (10, `Status: Accepted`) and a clean conflict check are present.
- Both ADRs are APPROVED; each carries a 2026-08-09 amendment that supersedes an earlier
  assertion. Read the amendments, not just the original text.
- `bash -n`, `shellcheck --severity=error` (via `test/lint_shell.sh`), and
  `test/test_harness_integrity.sh` must pass before every commit touching `bin/`.

## Tasks

### Task 1: Failing tests for the identity resolver

**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests driving `resolve_harness_identity` against temp git repos: exact-tag
   checkout yields kind `release` / baseline `v0.4.0` / distance `0`; a checkout 3 commits past
   `v0.3.0` yields `post-release` / `v0.3.0` / `3`; an orphan-branch checkout with tags elsewhere
   yields `undeterminable` with no baseline.
2. Add a case asserting the **highest reachable** tag wins over the nearest one, and a case with
   22 reachable tags asserting no candidate-count limit truncates the result.
3. Add a case asserting a `vX.Y.Z-rc1` tag is excluded by the `v*.*.*` match.
4. Verify the tests fail (RED) — the function does not exist yet.
5. Commit with message: "test(update): failing specs for checkout-derived version identity"

**Files likely touched:**
- `test/test_bin_update.sh` — new resolver test block

**Wired-into:** none (no new production surface)

**Dependencies:** none

---

### Task 2: Implement resolve_harness_identity

**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Add `resolve_harness_identity` to `bin/lib/harness-common.sh`, taking the harness directory
   and emitting kind, identity, baseline, distance, and source for the caller to consume.
2. Compute baseline with `git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname | head -1` and
   distance with `git rev-list --count «baseline»..HEAD`; treat an empty baseline or any non-zero
   git exit as `undeterminable` and return 0 without leaking a shell error.
3. Verify Task 1's tests pass (GREEN).
4. Run `bash -n` and `shellcheck --severity=error` over the changed file.
5. Commit with message: "feat(update): derive version identity from the checkout"

**Files likely touched:**
- `bin/lib/harness-common.sh` — new resolver function

**Wired-into:** none (inert until `bin/update`)

**Dependencies:** Task 1

---

### Task 3: Route the tagged check through the resolver

**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing test asserting an exact-tag checkout at `v0.3.0` with newest tag `v0.4.0`
   still offers `v0.3.0 → v0.4.0` and repairs the record to `v0.3.0`, driven through the
   resolver rather than the exact-match branch.
2. Verify it fails (RED).
3. Replace `check_harness_update_tagged`'s two-branch resolution (`bin/update:137-149`) with a
   single `resolve_harness_identity` call. Delete the `conductor_cfg_get currentVersion` read —
   the record must no longer be an input.
4. Render the update-available line from the **baseline**, not the display identity.
5. Verify GREEN, then confirm `i17-installed-tag` (`:321-339`) and `i17-recorded-tag`
   (`:357-369`) still pass unchanged.
6. Commit with message: "refactor(update): resolve tagged identity from the checkout"

**Files likely touched:**
- `bin/update` — `check_harness_update_tagged` resolution block
- `test/test_bin_update.sh` — exact-tag routing test

**Wired-into:** bin/update#dispatch_update_channel

**Dependencies:** Task 2

---

### Task 4: Report drift when no newer release exists

**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test building a checkout 2 commits past `v0.4.0` where `v0.4.0` is the newest
   tag, asserting the output is **non-empty** and names both the distance and the baseline tag.
2. Verify it fails (RED) — this is the reported defect's regression guard.
3. Add the post-release branch to `check_harness_update_tagged`: when baseline equals the latest
   tag and distance is non-zero, report "N commits past «tag», no newer release exists", stamp
   `lastCheckedAt`, and return without prompting.
4. Verify GREEN, and assert HEAD is byte-for-byte unchanged after the run.
5. Commit with message: "fix(update): report drift instead of silence past the newest tag"

**Files likely touched:**
- `bin/update` — post-release reporting branch
- `test/test_bin_update.sh` — drift regression test

**Wired-into:** same as Task 3

**Dependencies:** Task 3

---

### Task 5: Offer the update from a drifted checkout

**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test: checkout 1 commit past `v0.3.0`, newest tag `v0.4.0`, TTY present →
   the post-release identity is reported **and** `v0.3.0 → v0.4.0` is offered.
2. Verify it fails (RED).
3. Extend the post-release branch so a baseline lower than the latest tag falls through to the
   existing changelog render and y/n prompt, passing the **baseline** as the changelog range's
   lower bound.
4. Verify GREEN, and confirm the decline, migrate-failure-rollback, and no-TTY paths still behave
   as before.
5. Commit with message: "feat(update): offer newer releases to a drifted checkout"

**Files likely touched:**
- `bin/update` — post-release offer path
- `test/test_bin_update.sh` — drift-with-newer-release tests

**Wired-into:** same as Task 3

**Dependencies:** Task 4

---

### Task 6: Print the identity and its source on every tagged check

**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests asserting exactly one identity line naming the identity and its source for
   each of the five decision-matrix outcomes, including the "up to date" outcome that is silent
   today.
2. Verify they fail (RED).
3. Emit the identity line once, immediately after resolution and before any branch, so no exit
   path can skip it.
4. Verify GREEN, and assert the `autoCheck=false` and non-git-checkout paths remain silent
   because neither reaches a decision.
5. Commit with message: "feat(update): always report the identity the check acted on"

**Files likely touched:**
- `bin/update` — identity line emission
- `test/test_bin_update.sh` — identity line tests

**Wired-into:** same as Task 3

**Dependencies:** Task 5

---

### Task 7: Report an undeterminable identity and decline to guess

**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test: a checkout with no reachable `v*.*.*` tag reports unverifiable, offers
   nothing, writes no `currentVersion`, and exits 0.
2. Verify it fails (RED).
3. Handle the `undeterminable` kind: emit the identity line naming it unverifiable, skip
   comparison entirely, and persist nothing.
4. Verify GREEN, and assert the latest tag is not recorded and a pre-existing recorded value
   does not resurrect an offer.
5. Commit with message: "fix(update): decline to guess when no release tag is reachable"

**Files likely touched:**
- `bin/update` — undeterminable branch
- `test/test_bin_update.sh` — unverifiable tests

**Wired-into:** same as Task 3

**Dependencies:** Task 6

---

### Task 7.1: Demote the recorded version to a write-only cache

**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a post-release checkout persists the bare baseline `v0.3.0` —
   **not** `v0.3.0+3` — and that the resulting value matches `^v[0-9]+\.[0-9]+\.[0-9]+$` so
   `bin/migrate:330` never routes it down the `main@«sha»` branch and skips migration blocks.
2. Add tests asserting the decision is identical with the config file absent, present, and
   holding a value contradicting the checkout; and that a malformed config does not fail the run.
3. Verify they fail (RED).
4. Persist the **baseline** via `conductor_cfg_set` on determinable kinds only, never touching
   `~/.claude/ai-conductor.config.json` directly. Place the write so no alternate exit path
   (undeterminable, no-TTY, declined offer) silently skips it.
5. Verify GREEN, and confirm no remaining `conductor_cfg_get currentVersion` read exists in the
   decision path.
6. Commit with message: "refactor(update): make the recorded version a write-only cache"

**Files likely touched:**
- `bin/update` — persistence rule and record-read removal
- `test/test_bin_update.sh` — persistence and indifference-to-record tests

**Wired-into:** same as Task 3

**Dependencies:** Task 7

---

### Task 8: Report the main channel's identity

**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a main-channel checkout level with `origin/main` produces a
   non-empty identity line naming `main@«sha»`, its branch, and a behind-count of 0 — where the
   run is silent today (`bin/update:193`).
2. Verify it fails (RED).
3. Emit the identity line in `check_harness_update_main` before the level-with-remote early
   return, leaving all offer and pull behavior unchanged.
4. Verify GREEN, and confirm the existing main-channel assertions (`:469-482`), the diverged
   (non-fast-forward) path, and the fetch-timeout path are unaffected.
5. Commit with message: "feat(update): report identity on the main channel too"

**Files likely touched:**
- `bin/update` — `check_harness_update_main` identity line
- `test/test_bin_update.sh` — main-channel identity tests

**Wired-into:** bin/update#dispatch_update_channel

**Dependencies:** Task 7.1

---

### Task 9: Mirror the fix into bin/conduct's duplicate

**Story:** Story 10
**Type:** infrastructure

**Steps:**
1. Write a failing test driving the tagged check through `bin/conduct` against a checkout past
   the newest tag, asserting it reports drift rather than returning silently.
2. Verify it fails (RED) — `bin/conduct:345-374` still carries the original defect.
3. Replace that duplicate's resolution block with the same `resolve_harness_identity` call and
   the same reporting branches, so the copy delegates rather than re-implementing.
4. Verify GREEN, and run `bash -n` plus `shellcheck --severity=error` over `bin/conduct`.
5. Commit with message: "fix(conduct): mirror checkout-derived identity into the duplicate"

**Files likely touched:**
- `bin/conduct` — duplicated `check_harness_update_tagged`
- `test/test_bin_update.sh` — `bin/conduct` drift test

**Wired-into:** bin/conduct#check_harness_update

**Dependencies:** Task 8

---

### Task 10: Guard the two copies against divergence

**Story:** Story 10
**Type:** negative-path

**Steps:**
1. Write a failing check asserting `bin/update` and `bin/conduct` produce identical resolved
   identity output for the same checkout, and that neither contains its own tag-to-identity
   resolution logic outside the shared resolver.
2. Verify it fails (RED) by temporarily reverting one copy.
3. Add the check as a numbered check in `test/test_harness_integrity.sh`, naming the offending
   file and the divergence when it fails.
4. Verify GREEN and restore the reverted copy.
5. Commit with message: "test(integrity): fail closed when the update copies diverge"

**Files likely touched:**
- `test/test_harness_integrity.sh` — new numbered divergence check

**Wired-into:** none (no new production surface)

**Dependencies:** Task 9

---

### Task 11: Stop the installer guessing identity from VERSION

**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write a failing test asserting an off-tag tagged-channel install does not record a
   `VERSION`-derived value, and that an exact-tag install still records its tag.
2. Verify it fails (RED).
3. Rewrite `detect_current_version` (`bin/install:883-902`) to delegate to
   `resolve_harness_identity` and drop the `VERSION` file fallback for tagged identity. Keep the
   `main@«sha»` result for the main channel, explicitly distinguishable from a release identity.
4. Verify GREEN, and confirm update-mode runs still preserve channel, `autoCheck`, and unrelated
   fields, and that the `python3`-unavailable warning path is unchanged.
5. Commit with message: "fix(install): stop deriving release identity from VERSION"

**Files likely touched:**
- `bin/install` — `detect_current_version`
- `test/test_bin_update.sh` — installer identity tests

**Wired-into:** bin/install#configure_conductor

**Dependencies:** Task 10

---

### Task 12: Rewrite the #1005 assertions to the new contract

**Story:** Story 5
**Type:** refactor

**Steps:**
1. Rewrite `test/test_bin_update.sh:353-354`: the between-releases checkout now resolves to a
   post-release identity and **is** offered `v0.4.0`; the second assertion names the
   post-release identity and its source instead of expecting `unverifiable`.
2. Replace the `:355` emptiness assertion on that fixture with `currentVersion == v0.3.0` and
   `!= v0.4.0` — preserving the assertion's stated intent, "does not record the latest tag".
3. Add an inline comment on each rewritten assertion citing
   `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`.
4. Verify the suite passes, and confirm `i17-installed-tag` and `i17-recorded-tag` are untouched.
5. Commit with message: "test(update): retarget the #1005 identity assertions"

**Files likely touched:**
- `test/test_bin_update.sh` — `i17-unknown-identity` assertions

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

---

### Task 13: Add the no-reachable-tag fixture

**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Add a fixture whose HEAD has no reachable `v*.*.*` tag — an orphan branch in a repo that has
   tags elsewhere (verified: `git tag --merged HEAD` returns empty there).
2. Attach the emptiness assertion moved from `:355` to this fixture, where an absent record is
   the correct outcome, alongside assertions that it reports unverifiable and offers nothing.
3. Verify the fixture fails against a deliberately reverted resolver and passes against the real
   one.
4. Run the full `test/test_harness_integrity.sh`.
5. Commit with message: "test(update): cover the genuinely undeterminable checkout"

**Files likely touched:**
- `test/test_bin_update.sh` — new tagless fixture

**Wired-into:** none (no new production surface)

**Dependencies:** Task 12

---

### Task 14: Record the release waiver

**Story:** Story 10
**Type:** infrastructure

**Steps:**
1. Write `.docs/release-waivers/off-tag-checkout-reports-up-to-date-forever-tagged.md` with a
   `Waives:` line naming `bin/conduct CLI` verbatim and a non-empty `Rationale:` explaining that
   the edit changes an internal resolution helper with no consumer-visible CLI grammar, hook
   wiring, symlink target, or schema change.
2. Confirm the waiver is part of the `base...HEAD` diff — a waiver merged by a prior feature
   never satisfies this one.
3. Verify the release gate accepts the waiver and does not demand a migration block.
4. Commit with message: "chore(release): waive the bin/conduct CLI surface for #1437"

**Files likely touched:**
- `.docs/release-waivers/off-tag-checkout-reports-up-to-date-forever-tagged.md` — new waiver

**Wired-into:** none (no new production surface)

**Dependencies:** Task 13

---

## Task Dependency Graph

```
Task 1  (resolver RED)
  └─ Task 2  (resolver GREEN, inert)
       └─ Task 3  (tagged routed through resolver)
            └─ Task 4  (drift reported, no newer release)   ← the reported defect
                 └─ Task 5  (drift + newer release offered)
                      └─ Task 6  (identity line always printed)
                           └─ Task 7  (undeterminable → declines to guess)
                                └─ Task 7.1 (record demoted to write-only cache)
                                     └─ Task 8  (main channel identity)
                                          └─ Task 9  (bin/conduct mirror)
                                               └─ Task 10 (divergence guard)
                                                    └─ Task 11 (installer stops guessing)
                                                         └─ Task 12 (#1005 assertions retargeted)
                                                              └─ Task 13 (tagless fixture)
                                                                   └─ Task 14 (release waiver)
```

Strictly linear. Tasks 3-7.1 edit the same function and must not be parallelised; Tasks 9-14
depend on the resolver's final shape being settled by Task 7.1.

## Integration Points

- **After Task 3** — the tagged channel runs entirely off the resolver; the existing `#1005`
  suite is the regression signal that the old contract is preserved where it should be.
- **After Task 7.1** — the tagged channel is feature-complete: all five decision-matrix outcomes,
  the identity line, and the persistence rule are in place. The reported defect is fixed here.
- **After Task 10** — both entry points are provably consistent, and divergence is mechanically
  prevented rather than remembered.
- **After Task 13** — the full test contract reflects the new behavior, including the first real
  coverage of "declines to guess".

## Release Metadata

```
Release-Disposition: note
Release-Category: Fixed
Release-Semver: patch
Release-Note: The update check now derives the installed version from the checkout, so an install that has advanced past its release tag reports its position instead of silently claiming to be up to date.
```

The path classifier flags `bin/conduct CLI` because `bin/conduct` is edited, but no
consumer-visible CLI grammar, hook wiring, skill symlink target, or `settings.json` schema
changes — Task 14's waiver is the correct instrument, not a migration block.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] Every task carries a `**Wired-into:**` line in an accepted form
- [ ] `conduct-ts validate-wired-into` reports zero FAIL rows
- [ ] `conduct-ts plan-protected-targets` reports no violations
- [ ] Every story (Story 1-10) is named by at least one task's `**Story:**` line
- [ ] C1 discharged by Tasks 2, 3, 7.1, 9, 11 and enforced by Task 10
- [ ] C2 discharged by Tasks 9 and 10
- [ ] C3 discharged by Task 11
- [ ] C4 discharged by Tasks 12 and 13
- [ ] C5 stated in the Technical Approach
- [ ] C6 discharged by Task 14 and the Release Metadata section
- [ ] C7 discharged by Task 8
