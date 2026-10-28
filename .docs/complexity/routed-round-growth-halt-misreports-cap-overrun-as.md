# Complexity: A routed round's BUILD cap halt states its real charge, names its work, and reports the enforced growth cap

Tier: S

Rationale: Four existing production files change, and no new module, layer, dependency, or schema
is added. (1) `routing/round-receipt.ts`: `settleRoundAtDispatch`'s internal `exhausted` result
gains a read-only description of the refused round, built from the record and receipt it already
holds under the ledger lease. Its two record-read failure branches return the existing `halted` arm
with a reason that names the record, instead of `exhausted` laps. (2) `conductor.ts`: the BUILD
settlement halt renders the routed result through the existing `withPendingGrowth` projection and
the existing recovery hint. (3) `kickback-budget-cli.ts` and (4) `daemon-observe-cli.ts`: the
config-derived growth cap is read from the main checkout's project config, the config the
dispatching engine loads, instead of the feature worktree's.

Settlement's admission arithmetic, charge order, halting gate, and all-or-nothing commit are
unchanged. The `kickback-cap` class is kept for genuine exhaustion. The `needs-human` class for an
unreadable route record follows `adr-2026-10-12-routed-whole-feature-repair` decision 10 ("as the
ledger does") and `adr-2026-08-31-kickback-ledger-read-fails-closed` decision 1, so no ADR changes.
The flat-repair halt and the routed pending-growth rendering on inspect and daemon status stay as
the accepted stories of `growth-exhausted-build-halt-hides-the-pending-grow` pin them.

The event-spine procedure does not apply: nothing new observes, stamps, or signals, and the change
only renders durable state that settlement already reads. Risk is confined to halt text, one halt
class on a corruption path, and the cap value that two read-only CLIs report.
