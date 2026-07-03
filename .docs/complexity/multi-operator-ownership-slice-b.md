# Complexity: Multi-operator ownership hardening — Slice B (authoring-side)

Tier: M

## Signals

- **Trust boundary, but narrow:** finishes the authoring half of an already-approved
  design (`adr-2026-07-01-machine-scoped-operator-identity`, APPROVED in PR #183). No
  new decisions — the parent ADR governs; this slice re-anchors D3/D4 on the post-#185
  code. The parent spec was Tier L because it carried the design; this slice inherits
  the design and only implements it.
- **Fail-closed negative paths (dominant risk):** B2 flips authoring from
  stamp-un-owned to refuse-to-land; every land entry point (engineer land CLI, loop,
  conduct DECIDE path) needs an adversarial unresolved-identity derivation asserting
  NO branch / marker / artifact is created.
- **Cross-cutting but bounded (~5 files):** `engineer/loop.ts`, `engineer-cli.ts`,
  `engineer/land-spec.ts`, `engineer/authoring.ts` + `intake-marker.ts` call sites,
  plus the conduct DECIDE stamping entry (B1). All within one module family.
- **Test rewrites, not just additions:** two existing tests lock in Slice A's interim
  fall-through behavior and must be rewritten to the final contract.
- **No new integrations, no LLM, no schema/config format change, no new state
  machine** — rules out L. The reversal-of-default risk rules out S.

Story count estimate: 4–5 (happy + negative per entry point). Lightweight
architecture-review (no new ADR expected); conflict-check + architecture diagram apply.
