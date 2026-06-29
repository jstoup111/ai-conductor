# Implementation Plan: DECIDE pipeline restructure

**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md
**Stories:** .docs/stories/decide-pipeline-restructure.md
**Architecture:** .docs/architecture/decide-pipeline-restructure.md + ADR-015–018
**Tier:** L

## Strategy

Land additively, retire `brainstorm` last. Add `explore`/`prd` alongside `brainstorm` first, wire
everything, migrate state, then remove `brainstorm` and sweep all `/brainstorm` references in one
final pass so the harness-integrity cross-reference check never breaks mid-way.

## Task Dependency Graph

```
Wave A (primitives)        Wave B (flow + skills)         Wave C (track-aware runtime)     Wave D (retire)      Wave E (verify)
T1 parseTrack ───────────► T6 ALL_STEPS reorder ────────► T11 land-spec track-aware ─────► T16 remove ───────► T18 tests
T2 unions(+explore,+prd)─► T7 explore SKILL ────────────► T12 discoverBacklog track ─────►  brainstorm  ─────► T19 docs+CHANGELOG
T3 track marker writer ──► T8 prd SKILL (+#142) ────────► T13 PRESEEDED_DONE swap          + /brainstorm       T20 integrity+suite
T4 STEP_ARTIFACT_GLOBS ──► T9 stories/conflict/arch ────► T14 prd-audit track gate          ref sweep
T5 kickback targets ─────► T10 conduct flow + HARNESS ──► T15 state migration              (T17)
```

## Tasks

### Wave A — primitives (additive, nothing breaks)
- **T1 — `parseTrack()`** in `artifacts.ts` (mirror `parseComplexityTier`): parse `Track: product|technical`; `undefined` when absent/garbled. Covers **S2, S11**. *(unit tests with T18)*
- **T2 — unions** in `types/steps.ts` `StepName` + engineer `DecideStep`: **add** `explore`, `prd` (keep `brainstorm` for now). Covers **S1, S3**.
- **T3 — track marker writer**: write `.docs/track/<slug>.md` in `runAuthoring` + `landSpec` (same spot as the complexity/intake markers), gated on a confirmed track. Covers **S2, S10**.
- **T4 — `STEP_ARTIFACT_GLOBS`**: `explore` → no artifact gate (ephemeral/advisory); `prd` → `.docs/specs/*.md`. Covers **S1, S3**.
- **T5 — kickback targets**: extend the set in `gate-verdicts.ts`/`selector.ts` from `{stories, plan}` to `{prd, architecture, stories, plan}`. Covers **S7, S8**.

### Wave B — flow + skills
- **T6 — `ALL_STEPS` reorder** in `engine/steps.ts`: `explore → prd → architecture-diagram → architecture-review → stories → conflict_check → plan`; tier-skip helpers (`prd` skipped when technical; arch/conflict skipped for Small). Covers **S5**.
- **T7 — `skills/explore/SKILL.md`** (new, `enforcement: advisory`, `phase: decide`): explore + approaches; ephemeral `.pipeline/` notes; decision→`.memory/decisions/`; emit + operator-confirm `Track`; write `.docs/track/<slug>.md`; no `.docs/specs`. Covers **S1, S2**.
- **T8 — `skills/prd/SKILL.md`** (new, `enforcement: gating`): product-only design doc → `.docs/specs/`; product-only audit gate **with the external-constraint carve-out**; absorbs #142. Covers **S3, S4, S12**.
- **T9 — update `stories` / `conflict-check` / `architecture-review` SKILL.md**: stories note technical-vs-product + behavior-only + architecture-induced negatives (**S6, S8**); conflict-check root-routing → prd|architecture|stories (**S7**); architecture-review full-vs-amendment modes + structural-gap bar (**S8**).
- **T10 — `conduct` SKILL.md flow + skip table + `HARNESS.md`**: new order; `explore`/`prd` rows in the model table (remove `brainstorm`); product-only convention (from #142); tier/track skip rules. Covers **S5, S12**.

### Wave C — track-aware runtime + migration
- **T11 — `land-spec.ts` track-aware**: require `.docs/specs` PRD only when `Track: product`; stories+plan always; commit the track marker. Covers **S10**.
- **T12 — `discoverBacklog` track read** in `daemon-backlog.ts`: read `.docs/track/<slug>.md` via `parseTrack`, **default `product`**; stories still required (Model X — unchanged). Covers **S11**.
- **T13 — `PRESEEDED_DONE` swap** in `daemon-cli.ts`: `brainstorm` → `explore` + `prd`. Covers **S11**.
- **T14 — `prd-audit` track gate**: skip on `Track: technical` (log reason); run on product. Covers **S3**.
- **T15 — state migration** in the state loader: `brainstorm:done` ⇒ `explore:done` + `prd:done` (if `.docs/specs` doc) else `prd:skipped`; idempotent; no retroactive reorder. Covers **S11**.

### Wave D — retire brainstorm
- **T16 — remove `skills/brainstorm/`** and drop `brainstorm` from `StepName`/`DecideStep` (keep the `brainstorm→explore` alias only in the T15 migration shim).
- **T17 — `/brainstorm` reference sweep**: update every `/brainstorm` mention across `skills/*/SKILL.md`, `HARNESS.md`, conduct, engineer, plan, bootstrap, assess → `explore`/`prd` as appropriate (integrity check #4). Covers **S12**.

### Wave E — verify
- **T18 — tests**: `parseTrack` (valid/absent/garbled); migration (`brainstorm:done`→explore/prd); `discoverBacklog` track read + default-product; `land-spec` track-aware (product requires PRD, technical doesn't); kickback target extension; arch-review amendment/cap→HALT; `prd-audit` skip-on-technical; `ALL_STEPS` order. Covers **all S\* negative paths**.
- **T19 — docs + CHANGELOG**: `README.md`, `src/conductor/README.md` (DECIDE flow + tracks), `HARNESS.md`; CHANGELOG `[Unreleased]` implementation entry (replaces the docs-only note); close/repurpose #142.
- **T20 — full validation**: `tsc --noEmit` clean, `vitest run` green, `test/test_harness_integrity.sh` pass (model-table ↔ skill-dirs, cross-skill refs, no orphan `brainstorm`).

## Coverage check (story → task)

| Story | Tasks |
|---|---|
| S1 explore ephemeral | T2,T4,T7 |
| S2 track decision | T1,T3,T7 |
| S3 PRD conditional | T2,T4,T6,T8,T14 |
| S4 product-only PRD | T8 |
| S5 ordering | T6,T10 |
| S6 stories always | T9 |
| S7 conflict routing | T5,T9 |
| S8 convergence | T5,T9 |
| S9 plan always | T6 (plan step retained; coverage via T18) |
| S10 track-aware landing | T3,T11 |
| S11 daemon + migration | T1,T12,T13,T15,T18 |
| S12 #142 absorbed | T8,T10,T17 |

Every story maps to ≥1 task. No coverage gaps.

## Risks
- **Integrity cross-ref breakage if brainstorm removed early** → mitigated by retiring it last (Wave D) after explore/prd exist.
- **Spin from new kickback edges** → amendment-mode + cap→HALT (T5,T9) + tests (T18).
- **In-flight feature regression** → migration is additive/idempotent, default-product (T12,T15).
