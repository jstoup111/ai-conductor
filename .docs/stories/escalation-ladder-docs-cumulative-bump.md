**Status:** Accepted

# Stories: escalation-ladder-docs-cumulative-bump

Technical track (no PRD) — acceptance criteria derive from intake
jstoup111/ai-conductor#713 and `adr-2026-07-05-retry-as-escalation-ladder.md`.
The implementation (`src/conductor/src/engine/escalation.ts`, `escalateAttempt`)
is the source of truth: attempt ≥ 3 targets `bumpModel(base, attempt − 2)` —
cumulative, monotonic, capped at `fable`. No runtime behavior changes in this
feature; documentation only.

## Story: HARNESS.md ladder prose states the cumulative model-bump formula

As a harness operator reading HARNESS.md, I want the retry-as-escalation paragraph to
state the real per-attempt model-bump formula so that I can predict the model tier (and
cost) of every retry attempt, including budgets deeper than the default 3.

### Acceptance Criteria

#### Happy Path
- Given the retry-as-escalation paragraph in `HARNESS.md` (currently ~line 191), when an
  operator reads the attempt-3+ rule, then it states the model is bumped **(attempt − 2)
  tiers up from base** — cumulative per attempt (attempt 3 = one tier, attempt 4 = two
  tiers), capped at `fable` — instead of the current "bumps the model one tier".
- Given the corrected paragraph, when an operator considers raising a step's retry budget
  beyond 3, then the paragraph explicitly warns that each attempt past 3 escalates a
  further tier, so deeper budgets authorize multi-tier (premium-model) escalation.

#### Negative Paths
- Given the corrected `HARNESS.md`, when `grep -n "bumps the model one\b" HARNESS.md` runs,
  then it returns no match (the stale one-tier phrasing is fully replaced, not duplicated
  alongside the new formula).
- Given `HARNESS.md` contains the generated model-selection-table section, when
  `test/test_harness_integrity.sh` runs after the edit, then the table-drift check (5a)
  still passes — the prose edit must not touch the generated table region.

### Done When
- [ ] `HARNESS.md` retry-ladder paragraph contains the formula "(attempt − 2)" (or the
  literal equivalent "attempt − 2 tiers") and an example naming attempt 4 as two tiers up.
- [ ] `HARNESS.md` contains an explicit cost sentence tying retry budgets > 3 to
  multi-tier escalation.
- [ ] `grep -c "bumps the model one" HARNESS.md` outputs `0`.
- [ ] `test/test_harness_integrity.sh` passes on the branch.

## Story: src/conductor/README.md ladder bullet states the cumulative formula

As a conductor developer reading `src/conductor/README.md`, I want the retry-as-escalation
bullet to match `escalateAttempt`'s actual behavior so that the engine README never
contradicts the engine.

### Acceptance Criteria

#### Happy Path
- Given the retry-as-escalation bullet in `src/conductor/README.md` (currently ~line 165),
  when a developer reads the attempt-3+ rule, then it states the model is bumped
  **(attempt − 2) tiers from base**, cumulative and capped at `fable`, matching
  `escalation.ts` and the ADR verbatim in meaning.

#### Negative Paths
- Given the corrected README, when `grep -n "bumps the model one\b" src/conductor/README.md`
  runs, then it returns no match.

### Done When
- [ ] `src/conductor/README.md` ladder bullet states the cumulative "(attempt − 2) tiers"
  rule (attempt 3 = one tier, attempt 4 = two) with the `fable` cap.
- [ ] `grep -c "bumps the model one" src/conductor/README.md` outputs `0`.

## Story: CHANGELOG records the docs fix without rewriting history

As a release consumer reading the changelog, I want the docs correction recorded under
`[Unreleased]` → Fixed, while the original #188 release entry stays byte-identical, so
that released-version history is never rewritten.

### Acceptance Criteria

#### Happy Path
- Given `CHANGELOG.md`, when the change lands, then `## [Unreleased]` contains a `### Fixed`
  entry describing the escalation-ladder docs correction (referencing issue #713).

#### Negative Paths
- Given the historical #188 entry in a released section (currently ~line 282, which also
  says "attempt 3+ bumps the model one tier"), when `git diff main -- CHANGELOG.md` is
  inspected, then no hunk touches any released `## [X.Y.Z]` section — only `[Unreleased]`
  gains lines.

### Done When
- [ ] `CHANGELOG.md` `[Unreleased]` has a Fixed entry naming the escalation-ladder docs
  mismatch (#713).
- [ ] `git diff main -- CHANGELOG.md` shows additions only inside the `[Unreleased]` block.
