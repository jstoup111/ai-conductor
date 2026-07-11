# Architecture review (lightweight) — port-self-update-flow

Status: APPROVED

Tier M → lightweight review. Scope: relocation of existing update/channel plumbing
from `bin/conduct` to a standalone `bin/update`. No new data models or services.

## Feasibility

Feasible and low-risk. The moved functions are already isolated within
`bin/conduct` (327–470) and communicate only through config read/write and git.
Their only couplings are to a small set of shared bash helpers, which are copied
into the new script (see ADR consequence 1).

## Alignment checks

- **Bootstrap resilience** — Keeping the updater in engine-independent bash upholds
  the principle that a component must not depend on the artifact it repairs. ✔
- **v1.0 cutover ordering** — This is the blocker for #226 (bin/conduct removal)
  under umbrella #228; extracting first means #226 can delete the update block
  without regressing consumers. ✔
- **Docs-track-features** — HARNESS.md 286–307 + READMEs updated in the same PR. ✔
- **Integrity suite** — `bin/update` must pass `bash -n` (integrity check 1) and
  must not break the model-table / SKILL.md checks (it touches neither). ✔

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Behavior drift during the move (prompts, rollback, seeding). | Verbatim extraction + behavioral-equivalence stories; diff the moved functions against the originals. |
| Shared-helper divergence (two copies of `conductor_cfg_get` etc.). | Prefer a single sourced `bin/lib/*.sh`; if copied, note it so #226 removes the `bin/conduct` copy, not this one. |
| Auto-check no longer fires once `bin/conduct` is gone. | `conduct-ts` startup spawns `bin/update --auto`; covered by a story. |
| `exec "$0"` re-launch has no pipeline to re-launch. | Return 0 + advisory message; caller proceeds on the new checkout (ADR consequence 2). |

## Verdict

Approved for stories + plan. One ADR
(`adr-2026-07-05-standalone-bin-update.md`, APPROVED) records the decision.
