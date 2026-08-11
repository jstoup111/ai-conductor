**Status:** Accepted

# Stories: Off-tag checkout reports up to date forever (#1437)

**Track:** technical (no PRD — these stories are the acceptance-criteria artifact)
**Tier:** M
**Source:** jstoup111/ai-conductor#1437
**Architecture:** `.docs/architecture/off-tag-checkout-reports-up-to-date-forever-tagged.md`
**ADRs:** `adr-2026-08-09-checkout-is-sole-version-identity-authority`,
`adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`

Requirement tags reference the issue's desired outcomes (**DO-1**…**DO-4**) and the
architecture review's conditions (**C1**…**C7**).

- **DO-1** — an install that has advanced past its recorded release identifies itself correctly
  or reports that it cannot; it never silently concludes it is current.
- **DO-2** — whatever the check decides, the user can tell which version identity it used and
  where that identity came from.
- **DO-3** — an install sitting exactly on a release tag resolves identity from the checkout and
  is offered newer tags exactly as it is today.
- **DO-4** — an install with no determinable identity still declines to guess.

Throughout: *baseline* is the highest reachable release tag; *distance* is the commit count from
baseline to HEAD; *identity* is what the check prints (`«tag»` at distance 0, `«tag»+N` beyond).

---

## Story 1: Version identity is resolved from the checkout

**Requirement:** DO-1, DO-2, C1

As a harness maintainer, I want one resolver that derives version identity from the checkout, so
that no caller can reach a different answer and no persisted value can contradict reality.

### Acceptance Criteria

#### Happy Path
- Given a checkout whose HEAD is exactly at `v0.4.0` and which has `v0.3.0` and `v0.4.0`
  reachable, when the resolver runs, then it reports kind `release`, identity `v0.4.0`,
  baseline `v0.4.0`, distance `0`, and source naming the checkout.
- Given a checkout 3 commits past `v0.3.0` with no newer reachable tag, when the resolver runs,
  then it reports kind `post-release`, identity `v0.3.0+3`, baseline `v0.3.0`, and distance `3`.
- Given a checkout where `v0.3.0` and `v0.4.0` are both reachable and `v0.4.0` is 2 commits back
  while `v0.3.0` is 1 commit back on a merged side branch, when the resolver runs, then baseline
  is `v0.4.0` — the highest reachable tag, not the nearest one.
- Given a config file recording `currentVersion` as a value that disagrees with the checkout,
  when the resolver runs, then the resolved identity is unaffected by that value.

#### Negative Paths
- Given a checkout on an orphan branch with `v*.*.*` tags present elsewhere in the repository,
  when the resolver runs, then it reports kind `undeterminable` and no baseline, rather than
  falling back to any tag.
- Given a repository with no `v*.*.*` tags at all, when the resolver runs, then it reports kind
  `undeterminable`.
- Given `git` exits non-zero while listing reachable tags, when the resolver runs, then it
  reports kind `undeterminable` and exits 0 without emitting a shell error to the caller.
- Given a repository containing a tag named `vX.Y.Z-rc1` that does not match the release
  pattern, when the resolver runs, then that tag is excluded from baseline selection.
- Given a repository with 22 reachable release tags, when the resolver runs, then the highest is
  still selected — the result must not depend on any candidate-count limit.

### Done When
- [ ] `resolve_harness_identity` exists in `bin/lib/harness-common.sh` and returns kind,
      identity, baseline, distance, and source for a given harness directory.
- [ ] Baseline is computed with `git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname | head -1`
      and distance with `git rev-list --count «baseline»..HEAD`.
- [ ] `grep` over `bin/update`, `bin/conduct`, and `bin/install` shows no second implementation
      of tag-to-identity resolution — every caller delegates to the resolver.
- [ ] The three kinds are exhaustive and mutually exclusive; no input yields a fourth state or
      an empty kind.

---

## Story 2: A post-release checkout with no newer release reports its drift instead of going silent

**Requirement:** DO-1

As an operator running an install that has moved past its release tag, I want the update check
to tell me so, so that I can distinguish a drifted install from a genuinely current one.

This is the reported defect: the live install is 22 commits past `v0.100.0` with `v0.100.0` as
the newest tag, and the check currently prints nothing and exits 0.

### Acceptance Criteria

#### Happy Path
- Given the tagged channel and a checkout 2 commits past `v0.4.0` where `v0.4.0` is the newest
  tag, when the update check runs, then the output states the checkout is 2 commits past
  `v0.4.0` and that no newer release exists.
- Given that same state, when the update check runs, then the exit status is 0 and the output is
  non-empty.
- Given that same state, when the update check runs, then no update prompt is shown, because
  there is no newer release to offer.
- Given that same state, when the update check runs, then `lastCheckedAt` is still stamped.

#### Negative Paths
- Given that same state, when the update check runs, then the output does NOT claim the install
  is up to date without qualification, and does not present `v0.4.0` as the installed identity.
- Given that same state and a recorded `currentVersion` of `v0.4.0`, when the update check runs,
  then the recorded value does not suppress the drift report.
- Given that same state and no TTY, when the update check runs, then the drift is still
  reported (the report is not gated on interactivity).
- Given that same state, when the update check runs, then the checkout's HEAD is unchanged
  afterwards.

### Done When
- [ ] A test builds a checkout N commits past the newest tag and asserts the output names both
      the distance and the baseline tag.
- [ ] The same test asserts the output is non-empty — the regression guard for the reported bug.
- [ ] The same test asserts HEAD is byte-for-byte unchanged after the run.

---

## Story 3: A post-release checkout with a newer release reports drift and offers the update

**Requirement:** DO-1, DO-3

As an operator on a drifted install, I want to still be offered a genuinely newer release, so
that drift does not cost me updates.

### Acceptance Criteria

#### Happy Path
- Given the tagged channel, a checkout 1 commit past `v0.3.0`, and `v0.4.0` as the newest tag,
  when the update check runs with a TTY, then the output reports the post-release identity and
  offers `v0.3.0 → v0.4.0`.
- Given that offer and an answer of `y`, when the prompt is answered, then `tags/v0.4.0` is
  checked out and `bin/migrate` runs.
- Given a successful update, when it completes, then the persisted `currentVersion` is `v0.4.0`.
- Given the offer, when it is presented, then the changelog range between baseline and target is
  rendered.

#### Negative Paths
- Given the offer and an answer of `n`, when the prompt is answered, then HEAD is unchanged and
  `currentVersion` is not advanced.
- Given the offer accepted and `bin/migrate` exiting non-zero, when the update is applied, then
  the checkout is rolled back to the prior ref and `currentVersion` is not advanced.
- Given the offer accepted and `git checkout tags/v0.4.0` failing, when the update is applied,
  then the failure is reported and the run exits without advancing `currentVersion`.
- Given no TTY, when the check runs, then no prompt is issued, the manual
  `git checkout … && bin/migrate` guidance is printed, and HEAD is unchanged.

### Done When
- [ ] Accept, decline, migrate-failure, and no-TTY paths each have a test asserting the HEAD and
      `currentVersion` outcome.
- [ ] The offer text names the baseline and the target tag.

---

## Story 4: An install sitting exactly on a release tag behaves as it does today

**Requirement:** DO-3

As an operator on a tagged install, I want nothing about my experience to change, so that this
fix carries no regression for the supported case.

### Acceptance Criteria

#### Happy Path
- Given the tagged channel, a checkout exactly at `v0.3.0`, and `v0.4.0` as the newest tag, when
  the update check runs, then `v0.3.0 → v0.4.0` is offered exactly as before this change.
- Given a checkout exactly at the newest tag, when the update check runs, then the output states
  the install is up to date and no prompt is issued.
- Given a checkout exactly at `v0.3.0` and a forward-looking recorded `currentVersion` of
  `v0.4.0`, when the update check runs, then the checkout wins and `v0.3.0 → v0.4.0` is offered.
- Given a checkout exactly at `v0.3.0`, when the update check runs, then `currentVersion` is
  repaired to `v0.3.0`.

#### Negative Paths
- Given a checkout exactly at a tag and a `VERSION` file holding a different, higher version,
  when the update check runs, then `VERSION` does not influence the resolved identity.
- Given a checkout exactly at a tag, when the update check runs, then it does not report drift
  or a post-release identity.
- Given a commit carrying two release tags, when the update check runs, then the higher tag is
  selected deterministically and the run does not error.

### Done When
- [ ] The existing `i17-installed-tag` assertions (`test/test_bin_update.sh:321-339`) pass
      unchanged.
- [ ] The existing `i17-recorded-tag` assertions (`test/test_bin_update.sh:357-369`) pass
      unchanged.
- [ ] Existing Story 3 / Story 5 / Story 6 assertions in that suite pass unchanged.

---

## Story 5: A checkout with no reachable release tag declines to guess

**Requirement:** DO-4, C4

As an operator on a shallow or tagless clone, I want the check to say it cannot identify the
install rather than invent an identity, so that it never acts on a guess.

### Acceptance Criteria

#### Happy Path
- Given a checkout whose HEAD has no reachable `v*.*.*` tag while tags exist elsewhere in the
  repository, when the update check runs, then the output reports the identity as unverifiable.
- Given that same state, when the update check runs, then no update is offered.
- Given that same state, when the update check runs, then `currentVersion` is not written.
- Given that same state, when the update check runs, then the exit status is 0.

#### Negative Paths
- Given that same state and a newest tag of `v0.4.0`, when the update check runs, then `v0.4.0`
  is not recorded as the installed version.
- Given that same state and a recorded `currentVersion` of `v0.3.0`, when the update check runs,
  then that recorded value does not resurrect an offer.
- Given a shallow clone with no tags fetched, when the update check runs, then the result is
  unverifiable rather than a shell error or a non-zero exit.

### Done When
- [ ] A new fixture constructs a checkout with no reachable `v*.*.*` tag and asserts the
      unverifiable outcome, no offer, and no recorded version.
- [ ] `test/test_bin_update.sh:353-354` are rewritten so the between-releases checkout — which
      does have a reachable ancestor tag — now resolves to a post-release identity and is
      offered `v0.4.0`.
- [ ] `test/test_bin_update.sh:355` ("does not record the latest tag") is retained unchanged.
      > **Amended 2026-08-09 by #1437 (conflict-check):** corrected — this checkbox is
      > **superseded** by the two below it. The between-releases fixture is *determinable*
      > (baseline `v0.3.0`, distance 1, verified by rebuilding it), so Story 8 requires
      > persisting `v0.3.0` and the emptiness assertion cannot hold there. The assertion's
      > intent moves, not its meaning.
- [ ] The emptiness assertion (`currentVersion` unset) is attached to the **new
      no-reachable-tag fixture**, where an absent record is the correct outcome.
- [ ] The between-releases fixture asserts `currentVersion == v0.3.0` and `!= v0.4.0` —
      preserving the original assertion's stated intent, "does not record the latest tag".
- [ ] The rewritten assertions carry an inline comment citing
      `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`.

---

## Story 6: Every check prints the identity it used and where it came from

**Requirement:** DO-2, C7

As an operator, I want every update check to state the identity it acted on and its source, so
that I can always tell what the tool believed about my install.

### Acceptance Criteria

#### Happy Path
- Given any tagged-channel check that reaches a decision, when it runs, then exactly one
  identity line is printed naming the identity and its source.
- Given a check that concludes the install is current, when it runs, then the identity line is
  still printed — a nominal result is not silent.
- Given a check invoked as `bin/update --auto`, when it runs, then the identity line appears on
  the inherited stdout the operator sees.
- Given a check invoked with no arguments, when it runs, then the identity line is printed.

#### Negative Paths
- Given `autoCheck` is `false` and the check is invoked with `--auto`, when it runs, then
  nothing is printed — the check did not run, so it reports no identity.
- Given the harness directory is not a git checkout, when `bin/update` runs, then it exits 0
  silently as it does today and prints no identity line.
- Given an undeterminable identity, when the check runs, then the identity line still appears
  and names the identity as unverifiable rather than being omitted.
- Given any check, when it runs, then no more than one identity line is emitted per invocation.

### Done When
- [ ] A test asserts the identity line is present for each of the five decision-matrix
      outcomes.
- [ ] A test asserts the `autoCheck=false` path stays silent.
- [ ] A test asserts the non-git-checkout path stays silent.

---

## Story 7: The main channel also reports its identity

**Requirement:** DO-2, C7

As an operator whose install tracks `main`, I want the same identity reporting on my channel, so
that the guarantee is not limited to the channel I do not use.

### Acceptance Criteria

#### Happy Path
- Given the main channel and a checkout level with `origin/main`, when the update check runs,
  then an identity line reports `main@«sha»` with the branch name and a behind-count of 0.
- Given the main channel and a checkout 3 commits behind `origin/main`, when the update check
  runs, then the identity line reports the behind-count and the existing update offer is
  presented unchanged.
- Given the main channel and an accepted offer, when the pull succeeds, then `currentVersion` is
  recorded as `main@«sha»` exactly as it is today.

#### Negative Paths
- Given the main channel and a checkout level with its remote, when the update check runs, then
  the run is no longer silent, and no update prompt is issued.
- Given the main channel and a checkout that has diverged from its remote (not a fast-forward),
  when the update check runs, then the identity line is printed and no pull is attempted.
- Given the main channel and an unreachable remote, when the fetch times out, then the run exits
  0 as it does today without a spurious offer.
- Given the main channel, when the update check runs, then no tagged-channel identity vocabulary
  (`«tag»+N`, unverifiable) leaks into its output.

### Done When
- [ ] A test asserts a level-with-remote main checkout produces a non-empty identity line.
- [ ] Existing main-channel assertions (`test/test_bin_update.sh:469-482`) pass unchanged.
- [ ] The diverged and fetch-failure paths each have a test asserting no pull is attempted.

---

## Story 8: The recorded version is written but never consulted

**Requirement:** DO-1, C1

As a harness maintainer, I want the persisted version to be a cache with no authority, so that a
wrong or frozen value can never change what the check decides.

### Acceptance Criteria

#### Happy Path
- Given a determinable identity, when the check runs, then the persisted `currentVersion` is the
  **baseline** release tag.
- Given a post-release checkout at `v0.3.0+3`, when the check runs, then `v0.3.0` is persisted —
  not `v0.3.0+3` — so `bin/migrate`'s `^v?[0-9]+(\.[0-9]+)+$` lower-bound parsing is unaffected.
- Given a persisted value that disagrees with the checkout, when the check runs, then it is
  overwritten with the checkout-derived baseline.
- Given any tagged-channel outcome, when the check runs, then the decision is identical whether
  the config file is present, absent, or holds a contradictory value.

#### Negative Paths
- Given an undeterminable identity, when the check runs, then nothing is persisted — an absent
  record is preferred to a guess.
- Given a config file that is unreadable or malformed, when the check runs, then the decision is
  unchanged and the run does not fail.
- Given a post-release identity, when the value is persisted, then it matches
  `^v[0-9]+\.[0-9]+\.[0-9]+$` so `bin/migrate` never routes it down the `main@«sha»` branch and
  skips migration blocks.
- Given an alternate exit path (undeterminable, no-TTY, declined offer), when the check returns,
  then the persistence rule above still holds for that path — no branch silently skips it.

### Done When
- [ ] A test asserts a post-release checkout persists the bare baseline tag, not the `+N` form.
- [ ] A test asserts the same decision is reached with the config file absent and with it
      holding a contradictory value.
- [ ] A test asserts nothing is persisted for an undeterminable identity.

---

## Story 9: The installer stops guessing identity from the VERSION file

**Requirement:** DO-4, C3

As an operator installing or updating the harness, I want the installer to record only an
identity it can establish, so that it stops seeding the wrong value the update check then reads.

`bin/install:883-902` currently falls back to the `VERSION` file when off-tag, which is the
origin of the reported wrong record and contradicts the update path's own stated rule.

### Acceptance Criteria

#### Happy Path
- Given an install run against a checkout exactly at `v0.4.0`, when the installer records the
  version, then it records `v0.4.0`.
- Given an install run against a checkout past its newest tag on the tagged channel, when the
  installer records the version, then it records the baseline tag rather than the `VERSION`
  file's contents.
- Given an install run on the main channel, when the installer records the version, then a
  `main@«sha»` identity is still recorded and is distinguishable from a release identity.

#### Negative Paths
- Given a checkout with no reachable release tag on the tagged channel, when the installer runs,
  then it records no release identity rather than deriving one from `VERSION`.
- Given a `VERSION` file holding a version higher than any tag, when the installer runs, then
  that value is not recorded as the tagged identity.
- Given `python3` is unavailable, when the installer runs, then the existing warning path is
  unchanged and the install does not fail.
- Given an existing config file, when the installer runs in update mode, then channel,
  `autoCheck`, and unrelated fields are preserved as they are today.

### Done When
- [ ] `detect_current_version` no longer reads `VERSION` for tagged-channel identity.
- [ ] The installer delegates to the shared resolver rather than implementing its own rule.
- [ ] A test asserts an off-tag tagged-channel install does not record a `VERSION`-derived value.

---

## Story 10: The bin/conduct duplicate reaches the same answer

**Requirement:** DO-1, C2

As a harness maintainer, I want `bin/conduct`'s copy of the update check to resolve identity
identically, so that the defect is not merely relocated to the other entry point.

`bin/conduct:345-374` is a byte-identical duplicate of `check_harness_update_tagged`, retained
until #226 deletes it.

### Acceptance Criteria

#### Happy Path
- Given the same checkout and config, when the tagged check runs from `bin/update` and from
  `bin/conduct`, then both produce the same resolved identity, baseline, and decision.
- Given a post-release checkout whose baseline equals the newest tag, when the check runs from
  `bin/conduct`, then it reports the drift rather than returning silently.
- Given both copies, when they are inspected, then each delegates to the shared resolver rather
  than carrying its own resolution logic.

#### Negative Paths
- Given a change to the resolver, when only one of the two copies is updated, then a check fails
  and names the divergence.
- Given an undeterminable identity, when the check runs from `bin/conduct`, then it reports
  unverifiable and offers nothing, matching `bin/update`.
- Given `bin/conduct` runs in a non-git directory, when the check is reached, then it exits 0
  silently, unchanged from today.

### Done When
- [ ] `bin/conduct`'s tagged check delegates to `resolve_harness_identity`.
- [ ] A test or integrity check asserts both entry points produce identical identity output for
      the same checkout, and fails if only one is updated.
- [ ] `bash -n` and `shellcheck --severity=error` pass for `bin/update`, `bin/conduct`,
      `bin/install`, and `bin/lib/harness-common.sh`.
