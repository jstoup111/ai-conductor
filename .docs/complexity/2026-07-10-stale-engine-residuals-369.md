# Complexity: stale-engine auto-restart residuals (#369)

Tier: M

Rationale: boot-path refactor (replace daemon-cli's inline Task 8-10 block with the
extracted initStaleEngineState primitive), a small persisted state machine (suppression
record lifecycle: record → match → clear), and cross-file acceptance evidence (parity
test re-pointed at the real path; real-flow suppression test). No new models,
integrations, or auth — but the state semantics and boot-parity risk push this above S.
Story count ~4. Lightweight architecture review; conflict-check required.
