# Track: Coverage binding serializes judgments and loses partial progress (#2493)

Track: technical

Scope boundary: coverage_binding judges claims in bounded batches — one fresh provider session per batch, verdicts keyed by engine-stamped claim digest, envelope checkpointed atomically after every batch so a resumed run re-dispatches only unjudged or invalid digests. Amends adr-2026-08-31-coverage-binding-judge-step D5. Excluded: concurrent fan-out of one-claim sessions, changes to the land-time criterion contract, tree-attesting eligibility, and the default-on flip.

Engine execution shape and envelope persistence only; no operator-visible behavior beyond fewer provider sessions and preserved partial progress.
