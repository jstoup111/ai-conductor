# Complexity: satisfied-by-forged-citation-validation

Tier: M

## Rationale

A narrow, surgical fix concentrated in a single branch of one function
(`deriveCompletionInternal`'s `satisfiedByTrailer` handling, `autoheal.ts:619-643`),
reusing an already-approved, already-implemented validation pattern
(`validateCitations`). It is tier-**Medium** rather than Small because it sits on a
false-ship-critical / security-adjacent path, carries adversarial negative-path
requirements (forged / replayed / non-implementing / cross-feature citations must each
be refused), and lands in a file under active concurrent work by the attribution
cluster — so a conflict-check is genuinely needed.

### Signals

| Signal | Present | Notes |
|---|---|---|
| New external models/APIs | No | Pure git-derived checks (`merge-base`, `diff-tree`) |
| New integrations | No | No new services or adapters |
| Auth / permissions | No | — |
| New state machine | No | Same gate/derivation control flow; one branch hardened |
| Story count | ~5-6 | Happy backfill + 4 adversarial negative paths + no-Files pass-through |
| Cross-module blast radius | Partial | Contained to `autoheal.ts`; reuses in-file + sibling helpers |
| Correctness / false-ship risk | **High** | The whole point — a wrong fix either whitewashes forgeries or breaks legitimate backfills |
| Concurrent work in same files | **Yes** | #581 (judged-attribution) touches `deriveCompletionInternal`; #520 touches `validateCitations` → conflict-check required |

### Why not Small

Small skips conflict-check. `autoheal.ts:deriveCompletionInternal` is under active edit
by #581 (sidecar-stamp precedence) and neighbors #520's `validateCitations`; the fix
must be reconciled against that parallel attribution work, so conflict-check is not
optional here.

### Why not Large

No new models, integrations, auth, or state machine. The change is a contained
per-citation validation hardening plus targeted tests — it reuses an existing 5-check
pipeline pattern, not a subsystem redesign.

## Tier-driven DECIDE scope

- `/prd` — SKIPPED (technical track; acceptance criteria live in stories).
- `/architecture-diagram` — SKIPPED. No new component or edge; one existing branch is
  hardened to conform to an existing rule. The architecture is unchanged.
- `/architecture-review` — SATISFIED BY PRECEDENT (design-conformance). The provenance
  rule this fix applies — reachability + ancestry + non-empty + path overlap — is
  already the APPROVED design in
  `adr-2026-07-11-semantic-attribution-verification-lane.md` (the judged lane's
  `validateCitations`). Extending the same approved rule to the mechanical
  `satisfied-by` lane introduces **no new architectural decision**; it closes a lane
  that escaped the approved rule. The plan cites that ADR as governing. No new ADR.
- `/conflict-check` — INCLUDED (Medium) — active concurrent attribution work in the
  same file.
- `/stories` + `/plan` — INCLUDED with mandatory adversarial negative paths.
