# Conflict check: Multi-operator ownership hardening

Checked against open specs/PRs touching config, identity, and authoring surfaces.
Result: **NOT clean — one coordination conflict (non-contradictory, sequencing).**

## C1 — engineer-worktree-isolation (PR #168) — SEQUENCING CONFLICT (resource contention)

#168 rewrites the exact functions this spec's D3 (authoring fails closed) and D4
(universal stamping) attach to: `engineer/authoring.ts` (−247 net), `engineer/land-spec.ts`,
`engineer/intake-marker.ts`. Not a contradiction — both want owner stamping to work — but
building D3/D4 against current `main` would be thrown away when #168 lands.

**Resolution:** sequence the authoring-side work (D4 universal stamping, D3 authoring
refusal) to build AFTER #168 merges, on top of its restructured authoring/land/intake-marker
code. The identity + daemon + config work (D1, D2, D3-daemon-side, D5) is independent of
#168 and can proceed immediately. The plan splits tasks along this seam.

## C2 — pluggable-memory-1b (PR #151) — SOFT (same-file, semantically independent)

#151 changes `config.ts` (~116 lines) but NOT `validateConfig`, `loadConfig`,
`loadMergedConfig`, `mergeConfigs`, or `readUserConfig` (verified: no overlap in those
functions). This spec's anti-leak guard (D2) extends `validateConfig` and the identity read
(D1) uses `readUserConfig` — different regions of the same file.

**Resolution:** additive; expect a trivial textual rebase if both land close together. No
design change.

## C3 — background-intake-conduct-loop (PR #173) — NO CONFLICT

#173 adds mechanical origin-routing + human-gated DECIDE on the conduct loop. It routes
intake but does not change owner stamping or identity resolution. D4's universal stamping
complements it (a spec routed via #173 that reaches DECIDE still gets stamped). No overlap.

## C4 — owner-gate (#175, MERGED) — FOUNDATION, no conflict

This spec extends the merged owner-gate (identity.ts, gate.ts, provenance.ts). All base
code is on `main`; no branch contention.

## Summary

No contradictions or state conflicts. One sequencing dependency (C1 on #168) that the plan
honors by splitting identity/daemon/config tasks (independent) from authoring-side tasks
(after #168). Safe to proceed with implementation of the independent slice; gate the
authoring slice on #168.
