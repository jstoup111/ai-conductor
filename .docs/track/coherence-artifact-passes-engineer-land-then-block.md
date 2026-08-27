# Track: coherence-artifact-passes-engineer-land-then-block

Track: technical

Scope boundary: Balanced — the daemon's dispatch-time coherence check consumes the shared
`parseCoherenceArtifact` parser (deleting the bespoke `hasCoherenceTableDataRow` triple-scan), and
parse rejections name the specific structural defect (line, and what disagrees with what). Dispatch
stays fail-closed for absent/empty/table-less artifacts on non-S tiers. Excluded: a redundant
land-time dispatch-simulation gate and daemon-status structured-error surfacing (comprehensive
variant declined).

Two independent parsers of one format diverged (land accepted what dispatch rejected); sharing the
single parser makes the acceptance sets equal by construction. Internal machinery, no product
surface — no PRD.
