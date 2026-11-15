# Track: No-op guard refuses a kickback with new review cases after a zero-work build

Track: technical

Scope boundary: the four desired outcomes of jstoup111/ai-conductor#3661 only — the BUILD pre-dispatch no-op refusal (`sameNoOpCycle`) distinguishes build-review remediation cases the previous no-op build never received, a refusal is spent once so clearing its HALT retries BUILD, and a zero-work BUILD followed by a clean review still advances. Excluded: prd_audit pending-repair receipts as a work identity, revalidate-round build skipping (#3474), event-log halt re-raising (#3659), and any change to kickback budgets or the adjudicator.

Engine-internal guard behavior with no operator-facing product surface; acceptance criteria live in stories.
