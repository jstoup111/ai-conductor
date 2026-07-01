**Status:** Accepted

# Stories: Daemon Owner-Gating for Autonomous Spec Builds

Source PRD: `.docs/specs/2026-06-30-daemon-owner-gate.md` (Tier: Medium).
Every story below traces to one or more `FR-N`. "Owner stamp" = the owner identity recorded on a
spec's committed artifacts. "Daemon owner" = the identity the daemon resolves for itself.

---

## Story: Configure a daemon's owner identity

**Requirement:** FR-1

As an operator, I want to declare the owner identity my daemon builds for, so that it only acts on
work that is mine.

### Acceptance Criteria

#### Happy Path
- Given a daemon with a configured owner identity `alice`, when the daemon resolves its owner, then
  the resolved owner is `alice`.
- Given both a configured owner `alice` and an available gh login `bob`, when the daemon resolves
  its owner, then the configured `alice` wins (configured always takes precedence over gh).

#### Negative Paths
- Given a configured owner set to an empty or whitespace-only string, when the daemon resolves its
  owner, then the empty value is treated as "not configured" (it does not become a real owner) and
  resolution falls through to the gh fallback (FR-2).
- Given a configured owner containing surrounding whitespace or mixed case, when it is later
  compared to a spec stamp, then comparison uses the normalized form (see FR-12) — a cosmetic
  difference never changes the resolved identity's meaning.

### Done When
- [ ] A configured owner identity is read and returned as the daemon owner.
- [ ] A configured owner is chosen over an available gh login (deterministic precedence).
- [ ] An empty/whitespace configured value is treated as unset, not as an owner.

---

## Story: Resolve owner from gh login when unconfigured

**Requirement:** FR-2

As an operator who hasn't set an explicit owner, I want the daemon to fall back to my
authenticated GitHub user, so that a zero-config setup still gates correctly.

### Acceptance Criteria

#### Happy Path
- Given no configured owner and a gh session authenticated as `bob`, when the daemon resolves its
  owner, then the resolved owner is `bob`.

#### Negative Paths
- Given no configured owner and gh returns a non-zero exit / error, when the daemon resolves its
  owner, then resolution yields "unresolved" (not a crash, not an empty-string owner) and the
  gate-inactive path (FR-3) is taken.
- Given no configured owner and gh is not installed / not on PATH, when the daemon resolves its
  owner, then resolution yields "unresolved" and the daemon logs that gh-based resolution was
  unavailable.
- Given no configured owner and gh returns an unexpected/empty payload, when the daemon parses it,
  then it does not treat a blank login as a valid owner — it yields "unresolved."

### Done When
- [ ] With no config and a valid gh session, the gh login is returned as the daemon owner.
- [ ] gh error, gh absent, or blank gh payload each yield "unresolved" (never a crash or empty
      owner).

---

## Story: Gate is inactive when no owner can be resolved

**Requirement:** FR-3

As an operator running headless where identity may be unavailable, I want the daemon to behave
exactly as it does today when it cannot determine an owner, so that a missing identity never
silently halts all builds.

### Acceptance Criteria

#### Happy Path
- Given the daemon owner is unresolved (no config, no gh), when discovery runs over a set of
  content-eligible specs, then every content-eligible spec is returned for build (today's behavior),
  regardless of any owner stamps.
- Given the gate is inactive, when discovery runs, then exactly one warning line is emitted stating
  owner-gating is inactive (identity unresolved), so the operator can tell the gate is off.

#### Negative Paths
- Given the gate is inactive, when a spec carries a stamp for a *different* owner, then it is still
  built (an inactive gate does not skip anything) — fail-open is deliberate.
- Given the gate is inactive across multiple discovery passes, when discovery repeats, then the
  "gate inactive" warning is not spammed once per spec (it is emitted at most once per pass /
  warn-once), so logs stay readable.

### Done When
- [ ] Unresolved owner → all content-eligible specs build (byte-for-byte today's selection).
- [ ] A single, distinct "gate inactive" warning is emitted (not per-spec spam).
- [ ] No spec is skipped on the basis of ownership while the gate is inactive.

---

## Story: A spec records its author's owner at authoring time

**Requirement:** FR-4

As an operator, I want each spec I author to carry my owner identity in its committed artifacts, so
that ownership travels with the spec and the daemon can read it from committed state alone.

### Acceptance Criteria

#### Happy Path
- Given the engineer authoring flow runs as owner `alice`, when it lands a spec, then the spec's
  committed artifacts carry the owner stamp `alice`.
- Given a spec was authored with a stamp, when it is later read from the base branch tree (not the
  working tree, not the PR), then the stamp is present and readable.

#### Negative Paths
- Given authoring runs where the owner cannot be determined, when it lands the spec, then it does
  not write a blank/placeholder owner stamp that would later read as a real owner — it either omits
  the stamp (leaving the spec "un-owned", handled by FR-8/FR-9) or fails loudly, never silently
  records a false owner.
- Given a spec authored on a no-remote / local-commit fallback path, when it lands, then the owner
  stamp is still committed on that path (the stamp is not skipped just because the remote push was
  skipped) — invariant side-effect on the alternate branch.

### Done When
- [ ] A spec authored by owner X carries a committed owner stamp = X.
- [ ] The stamp is readable from the committed base-branch tree.
- [ ] No authoring path (including no-remote fallback) commits a spec while silently omitting a
      determinable owner stamp.

---

## Story: A spec owned by the daemon's owner is built

**Requirement:** FR-5, FR-6

As an operator, I want the daemon to build a merged spec whose owner matches mine, so that my own
work proceeds automatically.

### Acceptance Criteria

#### Happy Path
- Given daemon owner `alice` and a content-eligible merged spec stamped `alice`, when discovery
  runs, then the spec is returned as eligible to build.
- Given a spec stamped `alice` that also fails an existing content filter (e.g. stories not
  Accepted), when discovery runs, then it is still skipped for the content reason — the owner match
  does not bypass existing eligibility filters.

#### Negative Paths
- Given a spec stamped `alice` but already present in the processed set, when discovery runs, then
  it is not re-built (owner match does not defeat idempotency / the processed marker).
- Given daemon owner `alice` and a spec whose stamp is `alice` but whose merge-time cannot be
  determined, when discovery runs, then the owner-match path still builds it (a stamped, matching
  spec does not depend on the cutover comparison, which is only for un-owned specs).

### Done When
- [ ] Matching-owner + content-eligible spec is returned for build.
- [ ] Owner match does NOT bypass existing content filters or the processed-set idempotency.

---

## Story: A spec owned by someone else is skipped and logged

**Requirement:** FR-7

As an operator, I want the daemon to skip a merged spec owned by a different identity and tell me it
did, so that a collaborator's work is left for their daemon and I can see what was passed over.

### Acceptance Criteria

#### Happy Path
- Given daemon owner `alice` and a content-eligible merged spec stamped `bob`, when discovery runs,
  then the spec is NOT returned for build.
- Given the same, when discovery skips it, then a visible log line is emitted naming the spec slug
  and the other owner (`bob`), e.g. "skip <slug>: owned by bob, not alice."

#### Negative Paths
- Given a spec stamped `bob` that would otherwise pass every content filter, when discovery runs,
  then it is still skipped on ownership grounds (the ownership gate is not bypassed by a
  fully-eligible spec).
- Given many other-owner specs in one pass, when discovery runs, then each is skipped and its skip
  is logged (no silent drop of any of them).

### Done When
- [ ] Other-owner content-eligible spec is not built.
- [ ] A skip line naming the slug and the other owner is emitted for it.
- [ ] A fully content-eligible other-owner spec is still gated out.

---

## Story: An un-owned spec merged after the cutover is skipped (strict gate)

**Requirement:** FR-8

As an operator, I want a merged spec with no owner stamp that landed after activation to be treated
as "not mine," so that a collaborator's un-stamped merge is not auto-built.

### Acceptance Criteria

#### Happy Path
- Given daemon owner `alice`, a configured cutover, and a content-eligible spec with NO owner stamp
  whose merge time is on/after the cutover, when discovery runs, then the spec is NOT built and a
  visible skip line is emitted stating it is un-owned and post-cutover.

#### Negative Paths
- Given an un-owned post-cutover spec that passes every content filter, when discovery runs, then it
  is still skipped (strict gate is not bypassed by content-eligibility).
- Given an un-owned spec whose merge time equals the cutover exactly (boundary), when discovery
  runs, then the boundary is resolved deterministically per FR-9's definition (on/after = skip) and
  documented, not left ambiguous.

### Done When
- [ ] Un-owned + post-cutover + content-eligible spec is not built.
- [ ] A distinct "un-owned, post-cutover" skip line is emitted.
- [ ] The exact-boundary case resolves deterministically (on/after → skip).

---

## Story: An un-owned spec merged before the cutover still builds (grandfather)

**Requirement:** FR-9

As an operator adopting this feature, I want work that merged before activation to keep building
without a stamp, so that in-flight work is not disrupted and no backfill is required.

### Acceptance Criteria

#### Happy Path
- Given daemon owner `alice`, a configured cutover, and a content-eligible spec with NO owner stamp
  whose merge time is strictly before the cutover, when discovery runs, then the spec is treated as
  owned by the operator and returned for build.

#### Negative Paths
- Given a grandfathered (pre-cutover, un-owned) spec that fails a content filter, when discovery
  runs, then it is still skipped for the content reason (grandfathering only supplies ownership, not
  a bypass of content eligibility).
- Given a pre-cutover un-owned spec whose merge time cannot be determined at all, when discovery
  runs, then behavior is defined and safe per the merge-time Open Question resolution (it does not
  crash and does not silently flip between build/skip run-to-run for the same spec).

### Done When
- [ ] Un-owned + pre-cutover + content-eligible spec is built.
- [ ] Grandfathering supplies ownership only — content filters still apply.
- [ ] Indeterminate merge time has a defined, stable outcome (no run-to-run flip).

---

## Story: Configure the grandfather cutover

**Requirement:** FR-10

As an operator, I want to set the activation/cutover point, so that I control which pre-existing
work is grandfathered.

### Acceptance Criteria

#### Happy Path
- Given a configured cutover value, when discovery evaluates an un-owned spec, then that value is
  the boundary used for the pre/post decision (FR-8/FR-9).

#### Negative Paths
- Given a malformed or unparseable cutover value, when the daemon loads config, then it rejects the
  value with a clear error (or a documented safe default) rather than silently treating every spec
  as post-cutover or pre-cutover by accident.
- Given no cutover is configured at all, when an un-owned spec is evaluated, then the behavior is
  defined (documented default) — the feature does not depend on an undefined boundary.

### Done When
- [ ] A configured, valid cutover is used as the pre/post boundary.
- [ ] A malformed cutover is rejected with a clear error or falls to a documented default (never a
      silent misclassification).

---

## Story: Ownership skips are logged distinctly from content skips

**Requirement:** FR-11

As an operator scanning daemon logs, I want ownership skips to be visibly different from
content-eligibility skips, so that I can tell "not yours" apart from "stories not accepted."

### Acceptance Criteria

#### Happy Path
- Given an other-owner spec and a stories-not-accepted spec in the same discovery pass, when
  discovery runs, then the two skip lines are distinguishable (the ownership skip clearly states the
  ownership reason; the content skip states the content reason).

#### Negative Paths
- Given repeated discovery passes over the same skipped spec, when discovery repeats, then skip
  logging does not flood the log every pass for the same spec (warn-once semantics consistent with
  existing content-skip logging).

### Done When
- [ ] Ownership-skip and content-skip lines are visually/textually distinguishable.
- [ ] Ownership-skip logging respects warn-once (no per-pass flooding for the same spec).

---

## Story: Owner comparison tolerates cosmetic differences

**Requirement:** FR-12

As an operator, I want owner matching to ignore case and surrounding whitespace, so that I am never
locked out of my own spec by a trivial formatting mismatch.

### Acceptance Criteria

#### Happy Path
- Given daemon owner `Alice` and a spec stamped `alice ` (trailing space, different case), when
  discovery runs, then they are treated as the same owner and the spec is built.

#### Negative Paths
- Given daemon owner `alice` and a spec stamped `alice-bot` (a genuinely different identity that
  merely shares a prefix), when discovery runs, then they are NOT treated as equal — normalization
  is limited to case/whitespace and does not do fuzzy/substring matching that would falsely match a
  distinct owner.
- Given a stamp that is only whitespace, when compared, then it is treated as "no stamp" (un-owned),
  not as a match to any owner.

### Done When
- [ ] Case- and whitespace-only differences match.
- [ ] Distinct identities that merely share a prefix/substring do NOT match.
- [ ] A whitespace-only stamp is treated as un-owned, not a match.

---

## Story: Ownership can be transferred by re-recording the owner

**Requirement:** FR-13

As an operator, I want to transfer a spec's ownership by re-recording its owner, so that work can
move between operators.

### Acceptance Criteria

#### Happy Path
- Given a spec stamped `alice` that is later re-recorded as `bob`, when `bob`'s daemon runs
  discovery, then the spec is eligible for `bob` and is built by `bob`'s daemon.
- Given the same transfer, when `alice`'s daemon runs discovery, then the spec is now skipped by
  `alice` (owned by `bob`).

#### Negative Paths
- Given a spec already present in `alice`'s processed set that is then re-recorded to `bob`, when
  `alice`'s daemon runs, then `alice` does not rebuild it (transfer does not resurrect a
  processed-by-alice spec into alice's backlog) — the mid-flight nuance is bounded by the documented
  Open Question resolution.
- Given a transfer to an empty/whitespace owner, when discovery runs, then the spec becomes
  "un-owned" (handled by FR-8/FR-9), not an ambiguous state.

### Done When
- [ ] Re-recording owner `alice`→`bob` makes the spec build under `bob` and skip under `alice`.
- [ ] Transfer to empty owner degrades to the un-owned path, not an undefined state.

---

## Story: An operator can change their daemon's configured identity

**Requirement:** FR-14

As an operator whose identity changes (rename, new account), I want to update my daemon's configured
owner and have subsequent passes use it, so that gating tracks my current identity.

### Acceptance Criteria

#### Happy Path
- Given a daemon started with configured owner `alice` that is reconfigured to `alice2`, when the
  next discovery pass runs, then gating uses `alice2` (the current configured identity), not the
  value in effect at daemon start.

#### Negative Paths
- Given the configured owner is changed to an empty/invalid value, when the next pass runs, then
  resolution falls through per FR-1/FR-2 (empty → gh fallback → possibly unresolved/gate-inactive),
  rather than gating against a stale or blank identity.
- Given the identity changes mid-run while a discovery pass is already in progress, when that pass
  completes, then the outcome is deterministic (the change takes effect no later than the next pass;
  it does not corrupt the in-progress pass) — consistent with the mid-flight Open Question.

### Done When
- [ ] A reconfigured identity is used on the next discovery pass.
- [ ] An invalid new identity falls through the documented resolution chain, not a stale/blank gate.
- [ ] A mid-run change has a deterministic, non-corrupting effect (no later than next pass).
