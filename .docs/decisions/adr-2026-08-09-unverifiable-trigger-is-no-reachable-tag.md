# ADR: "Unverifiable" is triggered by no reachable tag, not by a missing record

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for #1437

## Context

Issue #1005 established a deliberate behavior, still encoded in `bin/update:146-149`: an
install whose version identity cannot be established reports it as *unverifiable* and offers
no update, rather than guessing. Desired outcome 4 of #1437 explicitly preserves this — "an
install with no determinable identity still declines to guess."

Under the current design, "no determinable identity" means **the config record is absent or
malformed**, because the record is the only fallback once the exact-tag branch misses.
`adr-2026-08-09-checkout-is-sole-version-identity-authority` removes the record from every
decision path, so that trigger ceases to exist and needs redefinition.

The existing test encoding this is `test/test_bin_update.sh:344-355`
(`#1005 i17-unknown-identity`). It builds a checkout "between releases" with no recorded
identity and asserts two things: no update is offered, and the output contains `unverifiable`.

**Verified by reading `make_repo` (`test/test_bin_update.sh:80-123`): that fixture tags the
first commit `v0.3.0`.** So the "between releases" checkout in that test *does* have a
reachable ancestor tag — it is `v0.3.0` plus one commit. The test's name says "unknown
identity", but the identity is not actually unknown; only the *record* is absent. The
assertion tests the old mechanism's limitation, not an intended user-facing behavior.

## Options Considered

### Option A: Preserve the assertions as written
Treat "no recorded identity" as an independent trigger for `unverifiable`, retained alongside
the new checkout-derived resolution.

- **Pros:** No accepted test changes. No contract renegotiation to explain.
- **Cons:** Reintroduces the record as a decision input through the back door, defeating the
  companion ADR's entire guarantee. Produces an absurd result: a checkout one commit past
  `v0.3.0` would be declared unverifiable while the tooling can state its position precisely.
  Preserves a behavior no user ever asked for — it is an artifact of the old resolution order.

### Option B: Redefine the trigger as "no reachable release tag"
`unverifiable` fires when the checkout has **no reachable `v*.*.*` tag at all** — a shallow
clone, a tagless repository, an orphan branch — or when git cannot answer. A checkout with a
reachable tag is always determinable, as either a release or a post-release position.

- **Pros:** The refusal to guess is preserved and becomes *testable against a real condition*
  instead of a bookkeeping accident. The trigger is a property of the checkout, matching the
  companion ADR. Verified reachable: an orphan branch with tags elsewhere in the repo makes
  `git tag --merged HEAD -l 'v*.*.*'` return empty (git exits 128 for `describe` in the same
  state) — a genuine, constructible test case.
- **Cons:** Two accepted assertions are rewritten. The `i17-unknown-identity` fixture no longer
  exercises the condition its name claims and must be rebuilt.

## Decision

**Option B.** The `unverifiable` outcome is retained but its trigger moves from "no recorded
identity" to "no reachable release tag."

Desired outcome 4 is satisfied more faithfully by B than by A. The outcome asks that an install
with **no determinable identity** decline to guess. A checkout sitting one commit past a
reachable `v0.3.0` has a perfectly determinable identity — `v0.3.0+1`. Reporting it as
unverifiable is not caution; it is a false negative that the old two-branch resolution had no
way to avoid. B narrows `unverifiable` to the cases where identity genuinely cannot be
established, and those cases still refuse to guess and still offer nothing.

This is a **contract change, made explicitly rather than incidentally.** It was surfaced to the
operator with the falsifying evidence about `make_repo` before the approach was chosen, and
accepted.

Test changes required:

| Location | Current assertion | Replacement |
| --- | --- | --- |
| `test/test_bin_update.sh:353` | between-releases checkout offers no update | same checkout resolves to `v0.3.0+1` and **does** offer `v0.4.0` |
| `test/test_bin_update.sh:354` | output contains `unverifiable` | output names the post-release identity and its source |
| — | (none) | **new:** a checkout with no reachable `v*.*.*` tag reports `unverifiable` and offers nothing |
| `test/test_bin_update.sh:355` | latest tag is not recorded | retained unchanged — still must not record a guess |

> **Amended 2026-08-09 by #1437 (same DECIDE pass, during `/conflict-check`):** the `:355` row
> above is **corrected — it cannot be retained unchanged.** Verified empirically by rebuilding
> the fixture: the between-releases checkout resolves to baseline `v0.3.0`, distance 1, which is
> *determinable*, so `adr-2026-08-09-checkout-is-sole-version-identity-authority` requires
> persisting the baseline `v0.3.0`. The assertion checks for an **empty** `currentVersion` and
> would therefore fail. Resolution (operator-selected): the emptiness assertion **moves to the
> new no-reachable-tag fixture**, where empty is genuinely correct, and the between-releases
> fixture instead asserts `currentVersion == v0.3.0` and `!= v0.4.0` — which is precisely what
> the assertion's own name, "does not record the latest tag", states. The intent is preserved;
> only the fixture it is attached to changes. See
> `.docs/conflicts/off-tag-checkout-reports-up-to-date-forever-tagged.md`.

The neighbouring `i17-recorded-tag` case (`:357-369`) needs **no** change: its checkout's
highest reachable tag is `v0.3.0`, so the new resolver reports the same `v0.3.0 → v0.4.0`
offer the assertion already expects, now derived from the checkout instead of the record.

## Consequences

### Positive
- The "decline to guess" guarantee becomes testable against a constructible condition rather
  than an absence of config state.
- Removes a false-negative class where a precisely-locatable checkout was declared unknowable.
- The test suite gains genuine coverage of the tagless/shallow case, which nothing currently
  exercises.

### Negative
- Two assertions from an accepted, shipped feature (#1005) are rewritten. Anyone reading git
  history will see a behavioral test change and must find this ADR to understand why.
- A user on a shallow clone now sees `unverifiable` where they may previously have seen an
  offer derived from a recorded value. This is correct but is a visible change.

### Follow-up Actions
- [ ] Rewrite the two `i17-unknown-identity` assertions per the table above.
- [ ] Add a new fixture whose HEAD has no reachable `v*.*.*` tag (orphan branch or tagless clone).
- [ ] Leave `i17-recorded-tag` and `i17-installed-tag` assertions unchanged; confirm both still pass.
- [ ] Cite this ADR in the test file beside the rewritten assertions so the change is self-explaining.
