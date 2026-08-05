# Complexity: build-halts-when-a-branch-inherits-an-older-revisi

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One internal classification result distinguishing the refusal causes; no persisted schema change |
| External integrations | None — read-only `git` invocations only, the same seam the tolerance already uses |
| Auth / permission surface | **Yes, indirectly** — this widens the acceptance criterion of a tamper-detection boundary |
| State machines | None — no step topology, prerequisite, or halt-class change |
| Story count | 4 (inherited-revision tolerance; unweakened tamper refusal; refusal-cause differentiation; fail-closed when inheritance is undeterminable) |
| Files touched | 1 engine file (`protected-artifact-seal.ts`) + tests + `docs/runbooks/stalled-or-stuck-feature.md` |
| New runtime code | ~60-90 lines inside one module, replacing `matchesBaseTip` with a broader provenance predicate |

## Rationale

By file count and line count this is Small. It is classified **Medium** for one reason: the change
relaxes the acceptance test of a security boundary. `matchesBaseTip`
(`protected-artifact-seal.ts:551-563`) is the sole thing standing between "an artifact this feature
does not own changed" and a halt, and its narrowness is what makes the current guard trivially
unforgeable — byte-equality against a ref the build agent cannot write to. Any widening has to
carry an explicit, recorded argument for why unforgeability survives, and which git facts the new
predicate trusts.

That argument is exactly what an ADR exists to capture, so `/architecture-review` runs and the
resulting ADR is a deliverable rather than an optional extra. `/conflict-check` runs for a second
reason: the seal has been amended twice already (#976 base-inheritance tolerance, #1047
self-amendment reporting), so concurrent specs touching the same predicate are a live risk rather
than a hypothetical one.

`/architecture-diagram` has little to add for a single-predicate change but is produced for tier
completeness, scoped to the decision flow inside `inspectSeal`.

→ **Medium.** No step is skipped; PRD is skipped for track reasons (technical), not tier reasons.

## Issue label corroboration

Issue #1315 is filed `size: M`; this independent assessment agrees, though for a different reason
than raw size — the code is small, the blast radius of getting it wrong is not.
