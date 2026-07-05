# Conflict Check: CHANGELOG Migration-block enforcement (fix #282)

**Date:** 2026-07-05
**Stories checked:** `.docs/stories/2026-07-05-changelog-migration-block-enforcement.md`
(Stories 1–6) against the existing self-host release gate (`release-gate.ts` TR-7/8/9/10),
the conductor's `/remediate` routing (prd-audit / finish / as-built kickback paths and
`MAX_KICKBACKS_PER_GATE`), the integrity suite §9 (release-artifact checks), `bin/migrate`,
and the VERSION-freeze policy.
**Result:** **No blocking conflicts.** Two overlaps resolved by design; two ordering
constraints recorded.

---

## Overlap (RESOLVED): §9d integrity check × TR-10 gate — double enforcement

**Stories involved:** Story 1 (integrity §9d format-when-present) vs Story 2 (gate h2 + verdict).
**Type:** overlap · **Severity:** benign / intentional.

Both check Migration-block format. This is deliberate defense-in-depth, not a conflict, and the
scopes are disjoint: §9d is **format-when-present** on every change (catches a malformed block at
authoring time, never asserts presence); TR-10 is **presence-when-breaking + format** at the
finish gate (has the git diff, so it can require presence). Because §9d never asserts presence, it
cannot contradict TR-10's "no breaking surface → pass" fast path. Both enforce the same h2 +
`bash migration` contract, so a block that passes §9d also passes TR-10's format arm.

## Overlap (RESOLVED): gate strict (h2) × bin/migrate lenient (h2/h3)

**Stories involved:** Story 2 (gate h2-only) vs Story 4 (`bin/migrate` unchanged h2/h3).
**Type:** state/contract conflict (apparent) · **Severity:** resolved by ADR-2.

Two components applying different heading rules looks like a contradiction. Resolved: the asymmetry
is intentional and one-directional — `h2 ⊂ {h2,h3}`, so *gate-passing ⟹ migrate-executable* holds.
The gate is a go-forward authoring contract; `bin/migrate` must stay lenient for 5 already-shipped
h3 blocks. A parity test (Story 4) and an in-code comment (Story 4 Done-When) lock this so a future
change does not "resolve" the asymmetry by re-syncing the regexes.

## Ordering constraint: remediate routing reuses the existing kickback budget

**Story:** Story 3. The migration-format reroute must use the **existing**
`MAX_KICKBACKS_PER_GATE` accounting, not a new unbounded loop. It shares the finish/prd-audit
budget semantics; the negative path (budget exhausted → HALT) is what prevents an infinite
kickback and preserves the current terminal behavior. No new state machine is introduced.

## Ordering constraint: only the migration sub-gate reroutes

**Story:** Story 3 negative path. TR-7 (VERSION), TR-8 (integrity suite), TR-9 (empty
`[Unreleased]`) MUST keep direct-HALT behavior. Rerouting TR-8 would be circular (the integrity
suite is what §9d lives in); rerouting TR-9/TR-7 is out of scope for #282. The conductor branch
must key the reroute on the failing sub-gate identity + verdict kind, not on "any self-host gate
failure."

## No conflict with VERSION freeze
This feature is behavioral gate/validation plumbing; it does not bump VERSION (frozen at 0.99.19
until 1.0 per operator policy) and adds no version-gated behavior. The self-host VERSION-approval
gate (TR-7) is untouched.

## No conflict with the C1 shared-surface constraint
Story 5 is a guard, not a feature that competes with others — it constrains *where* code may land
(no `skills/**`/`agents/**` CHANGELOG language). It reinforces, and does not contradict, Stories 1–4
(all of which land in `src/conductor/**`, `test/`, `bin/migrate`, or docs).
